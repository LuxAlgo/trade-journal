#!/usr/bin/env node
/**
 * Message resource integrity gate (docs/i18n.md §3/§14, T07).
 *
 * Validates apps/web/messages/<locale>/<ns>.json across all seven locales:
 *   - locale directories and per-locale namespace file sets are identical;
 *   - key sets are identical across locales (missing/extra keys reported);
 *   - every message is a non-empty string;
 *   - each file declares exactly one top-level key matching its file name
 *     (same contract enforced at runtime by src/i18n/request.ts);
 *   - raw text is scanned for duplicate JSON keys (JSON.parse silently
 *     collapses them, so this needs its own token walk);
 *   - every message parses with the ICU parser next-intl itself uses
 *     (@formatjs/icu-messageformat-parser) — no regex pretending;
 *   - interpolation parameters of the same key match across locales
 *     (arguments extracted from the AST, plural/select options included);
 *   - ICU plural branches stay inside the language's Intl.PluralRules
 *     categories and always include "other".
 *
 * Exported `checkMessages(dir)` returns a structured problem list for reuse
 * in Vitest; the CLI exits non-zero when any problem is found.
 *
 * Usage: node scripts/check-messages.mjs [--dir <messages-root>]
 */
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Keep in sync with apps/web/src/i18n/config.ts (`locales` + `formatLocale`).
// This script cannot import that TS module: it also runs as a plain CLI.
const LOCALES = ["en", "zh-CN", "ja", "ko", "zh-TW", "es", "fr"];
const FORMAT_TAGS = {
  en: "en-US",
  "zh-CN": "zh-CN",
  ja: "ja",
  ko: "ko",
  "zh-TW": "zh-TW",
  es: "es-ES",
  fr: "fr-FR",
};
/** Locale used as the baseline for file/key/parameter comparisons. */
const BASELINE_LOCALE = "en";

// @formatjs/icu-messageformat-parser is a devDependency of apps/web and pnpm
// does not hoist it to the repo root, so resolve it from apps/web explicitly.
const webRequire = createRequire(
  fileURLToPath(new URL("../apps/web/package.json", import.meta.url)),
);
const { parse, TYPE } = webRequire("@formatjs/icu-messageformat-parser");

const pluralCategories = (locale) =>
  new Intl.PluralRules(FORMAT_TAGS[locale]).resolvedOptions().pluralCategories;

const joinPath = (segments) => segments.join(".");

/** Collect every argument name of an ICU AST into `args` (options included). */
const collectArguments = (nodes, args) => {
  for (const node of nodes) {
    if (
      node.type === TYPE.argument ||
      node.type === TYPE.number ||
      node.type === TYPE.date ||
      node.type === TYPE.time ||
      node.type === TYPE.plural ||
      node.type === TYPE.select
    ) {
      args.add(node.value);
    }
    if (node.type === TYPE.plural || node.type === TYPE.select) {
      for (const option of Object.values(node.options)) {
        collectArguments(option.value, args);
      }
    }
  }
};

/** Validate plural branches against the locale's plural categories. */
const collectPluralProblems = (locale, keyPath, nodes, problems) => {
  const allowed = pluralCategories(locale);
  for (const node of nodes) {
    if (node.type === TYPE.plural) {
      const branches = Object.keys(node.options);
      if (!branches.includes("other")) {
        problems.push({
          locale,
          key: keyPath,
          reason: `ICU plural is missing the mandatory "other" branch (branches: ${branches.join(", ")})`,
        });
      }
      for (const branch of branches) {
        if (branch.startsWith("=")) continue; // exact-match branches (e.g. "=0") are category-independent
        if (!allowed.includes(branch)) {
          problems.push({
            locale,
            key: keyPath,
            reason: `ICU plural branch "${branch}" is not a valid category for ${FORMAT_TAGS[locale]} (allowed: ${allowed.join(", ")})`,
          });
        }
      }
    }
    if (node.type === TYPE.plural || node.type === TYPE.select) {
      for (const option of Object.values(node.options)) {
        collectPluralProblems(locale, keyPath, option.value, problems);
      }
    }
  }
};

/**
 * Decode one JSON string token. `text[start]` must be the opening quote;
 * returns the decoded value and the index just past the closing quote.
 */
const decodeJsonString = (text, start) => {
  let out = "";
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') return { value: out, end: i + 1 };
    if (ch === "\\") {
      const esc = text[i + 1];
      i += 2;
      if (esc === "u") {
        out += String.fromCharCode(Number.parseInt(text.slice(i, i + 4), 16));
        i += 4;
      } else {
        out +=
          { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }[esc] ??
          esc;
      }
    } else {
      out += ch;
      i += 1;
    }
  }
  return { value: out, end: i };
};

/**
 * Report duplicate object keys as dotted paths. Precondition: JSON.parse
 * already succeeded, so the token stream is well-formed. JSON.parse itself
 * silently keeps only the last value of a duplicated key.
 */
const findDuplicateKeys = (text) => {
  const duplicates = [];
  const isWhitespace = (ch) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
  const stack = [{ keys: new Set(), path: "", object: true }];
  let pendingKey = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const { value, end } = decodeJsonString(text, i);
      i = end;
      let j = i;
      while (j < text.length && isWhitespace(text[j])) j += 1;
      const top = stack[stack.length - 1];
      if (text[j] === ":" && top.object) {
        if (top.keys.has(value)) {
          duplicates.push(top.path ? `${top.path}.${value}` : value);
        }
        top.keys.add(value);
        pendingKey = value;
      }
    } else if (ch === "{") {
      const top = stack[stack.length - 1];
      const path = top.object
        ? top.path
          ? `${top.path}.${pendingKey}`
          : pendingKey
        : `${top.path}[]`;
      stack.push({ keys: new Set(), path, object: true });
      i += 1;
    } else if (ch === "}") {
      stack.pop();
      i += 1;
    } else if (ch === "[") {
      const top = stack[stack.length - 1];
      const path = top.object
        ? top.path
          ? `${top.path}.${pendingKey}`
          : pendingKey
        : `${top.path}[]`;
      stack.push({ keys: new Set(), path, object: false });
      i += 1;
    } else if (ch === "]") {
      stack.pop();
      i += 1;
    } else {
      i += 1;
    }
  }
  return duplicates;
};

/** Walk a parsed namespace object, invoking `onLeaf(keyPath, value)` for strings. */
const walkLeaves = (locale, value, path, onLeaf, onProblem) => {
  if (typeof value === "string") {
    onLeaf(path, value);
    return;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    onProblem({
      locale,
      key: joinPath(path), // path already starts with the namespace top-level key
      reason: `message must be a non-empty string (got ${value === null ? "null" : Array.isArray(value) ? "array" : typeof value})`,
    });
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    walkLeaves(locale, child, [...path, key], onLeaf, onProblem);
  }
};

/**
 * Check a messages root directory. Returns a list of problems
 * `{ locale, key, reason }`; `locale` is null for root/cross-locale issues.
 */
export const checkMessages = (messagesDir) => {
  const problems = [];

  // 1. Locale directories must exist and no unexpected entries may sit beside them.
  const entries = new Set(readdirSync(messagesDir));
  const localeDirs = {};
  for (const locale of LOCALES) {
    if (!entries.has(locale)) {
      problems.push({ locale, key: locale, reason: "locale directory is missing" });
      continue;
    }
    const dir = join(messagesDir, locale);
    if (!statSync(dir).isDirectory()) {
      problems.push({ locale, key: locale, reason: "locale entry is not a directory" });
      continue;
    }
    localeDirs[locale] = dir;
  }
  for (const entry of entries) {
    if (!LOCALES.includes(entry)) {
      problems.push({
        locale: null,
        key: entry,
        reason: `unexpected entry under messages root (expected only: ${LOCALES.join(", ")})`,
      });
    }
  }

  // 2. Namespace file sets must match the baseline locale's set.
  const baselineFiles = existsSync(localeDirs[BASELINE_LOCALE])
    ? readdirSync(localeDirs[BASELINE_LOCALE])
        .filter((name) => name.endsWith(".json"))
        .sort()
    : [];
  for (const locale of Object.keys(localeDirs)) {
    const files = readdirSync(localeDirs[locale])
      .filter((name) => name.endsWith(".json"))
      .sort();
    for (const name of baselineFiles) {
      if (!files.includes(name)) {
        problems.push({
          locale,
          key: name,
          reason: `namespace file missing (present in ${BASELINE_LOCALE})`,
        });
      }
    }
    for (const name of files) {
      if (!baselineFiles.includes(name)) {
        problems.push({
          locale,
          key: name,
          reason: `namespace file is not present in ${BASELINE_LOCALE} (namespace sets must be identical)`,
        });
      }
    }
  }

  // 3. Per-file validation: syntax, duplicate keys, top-level key, values, ICU.
  // messages[locale][<ns>.<keyPath>] = { args: Set<string>, ast: nodes|null }
  const messagesByLocale = Object.fromEntries(LOCALES.map((locale) => [locale, new Map()]));
  for (const locale of Object.keys(localeDirs)) {
    for (const name of readdirSync(localeDirs[locale])
      .filter((f) => f.endsWith(".json"))
      .sort()) {
      const ns = name.slice(0, -".json".length);
      const file = join(localeDirs[locale], name);
      const text = readFileSync(file, "utf8");
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        problems.push({ locale, key: `${ns}.json`, reason: `invalid JSON: ${error.message}` });
        continue;
      }
      for (const keyPath of findDuplicateKeys(text)) {
        problems.push({
          locale,
          key: `${ns}.${keyPath}`,
          reason: "duplicate JSON key (JSON.parse silently keeps the last value)",
        });
      }
      const topKeys = Object.keys(parsed);
      if (topKeys.length !== 1 || topKeys[0] !== ns) {
        problems.push({
          locale,
          key: `${ns}.json`,
          reason: `file must contain exactly one top-level key named "${ns}" (got: ${topKeys.length === 0 ? "none" : topKeys.join(", ")})`,
        });
      }
      walkLeaves(
        locale,
        parsed,
        [],
        (path, value) => {
          const keyPath = joinPath(path); // path already starts with the namespace top-level key
          if (value.trim() === "") {
            problems.push({ locale, key: keyPath, reason: "message is empty" });
          }
          let ast;
          try {
            ast = parse(value);
          } catch (error) {
            problems.push({
              locale,
              key: keyPath,
              reason: `ICU parse error: ${error.message}`,
            });
            ast = null;
          }
          const args = new Set();
          if (ast) {
            collectArguments(ast, args);
            collectPluralProblems(locale, keyPath, ast, problems);
          }
          messagesByLocale[locale].set(keyPath, { args, ast });
        },
        (problem) => problems.push(problem),
      );
    }
  }

  // 4. Cross-locale key sets must match the baseline locale's key set.
  const baselineKeys = messagesByLocale[BASELINE_LOCALE];
  for (const locale of Object.keys(messagesByLocale)) {
    if (locale === BASELINE_LOCALE) continue;
    const keys = messagesByLocale[locale];
    for (const keyPath of baselineKeys.keys()) {
      if (!keys.has(keyPath)) {
        problems.push({
          locale,
          key: keyPath,
          reason: `key missing (present in ${BASELINE_LOCALE})`,
        });
      }
    }
    for (const keyPath of keys.keys()) {
      if (!baselineKeys.has(keyPath)) {
        problems.push({
          locale,
          key: keyPath,
          reason: `key is not present in ${BASELINE_LOCALE} (key sets must be identical)`,
        });
      }
    }
  }

  // 5. Same key must carry the same interpolation parameters across locales.
  for (const locale of Object.keys(messagesByLocale)) {
    if (locale === BASELINE_LOCALE) continue;
    for (const [keyPath, { args, ast }] of messagesByLocale[locale]) {
      const baseline = baselineKeys.get(keyPath);
      if (!baseline || !baseline.ast || !ast) continue; // set mismatch or parse error already reported
      const missing = [...baseline.args].filter((arg) => !args.has(arg));
      const extra = [...args].filter((arg) => !baseline.args.has(arg));
      if (missing.length > 0 || extra.length > 0) {
        const detail = [
          missing.length > 0 ? `missing ${missing.map((a) => `{${a}}`).join(", ")}` : null,
          extra.length > 0 ? `extra ${extra.map((a) => `{${a}}`).join(", ")}` : null,
        ]
          .filter(Boolean)
          .join("; ");
        problems.push({
          locale,
          key: keyPath,
          reason: `interpolation parameters differ from ${BASELINE_LOCALE}: ${detail}`,
        });
      }
    }
  }

  return problems;
};

const formatProblem = (problem) =>
  `  - [${problem.locale ?? "gate"}] ${problem.key}: ${problem.reason}`;

export const main = (argv = process.argv.slice(2)) => {
  let dir = fileURLToPath(new URL("../apps/web/messages", import.meta.url));
  const dirFlag = argv.indexOf("--dir");
  if (dirFlag !== -1) {
    const value = argv[dirFlag + 1];
    if (!value || value.startsWith("--")) {
      console.error("Usage: node scripts/check-messages.mjs [--dir <messages-root>]");
      return 2;
    }
    dir = resolve(value);
  }
  let problems;
  try {
    problems = checkMessages(dir);
  } catch (error) {
    console.error(`check-messages: cannot inspect "${dir}": ${error.message}`);
    return 1;
  }
  if (problems.length > 0) {
    console.error(
      `Message resource problems (${problems.length}):\n${problems.map(formatProblem).join("\n")}`,
    );
    console.error(
      `\nFix apps/web/messages or update docs/i18n.md; every locale must stay complete.`,
    );
    return 1;
  }
  console.log(`Message resources OK (${LOCALES.length} locales).`);
  return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
