// Gate for next-intl rich messages (T20 regression guard).
//
// A t.rich() handler (function-valued param) only renders when the message
// contains the matching <tag>; passing a function for a plain {param} makes
// React throw "Functions are not valid as a React child" at runtime. This
// bit the dashboard (closedFees / avgWinLoss.footnote) because the message
// gate only compares {params}, not rich tags. This test scans every rich
// call site via the TypeScript AST and asserts, for all seven locales:
//   1. every handler has a matching <tag> in the message;
//   2. the argument/tag name sets match the en baseline;
// and flags functions passed to plain t() (always a bug).
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { TYPE, parse } from "@formatjs/icu-messageformat-parser";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { locales } from "../src/i18n/config";

const webRootCandidates = () => [process.cwd(), join(process.cwd(), "apps", "web")];
const webRoot = webRootCandidates().find((candidate) => existsSync(join(candidate, "src", "app")));
if (!webRoot) throw new Error("Cannot locate apps/web (searched cwd and cwd/apps/web)");

const srcDir = join(webRoot, "src");
const messagesDir = join(webRoot, "messages");

const listFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });

type RichCall = {
  file: string;
  line: number;
  ns: string;
  key: string;
  handlers: string[];
};
type PlainCall = { file: string; line: number; ns: string; key: string; fnParams: string[] };

const richCalls: RichCall[] = [];
const plainViolations: PlainCall[] = [];

for (const file of listFiles(srcDir)) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const translators = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === "useTranslations" &&
      ts.isIdentifier(node.name)
    ) {
      const arg = node.initializer.arguments[0];
      translators.set(node.name.text, arg && ts.isStringLiteral(arg) ? arg.text : "");
    }
    const callMatches = (call: ts.CallExpression): boolean => {
      if (call.expression === undefined) return false;
      if (ts.isIdentifier(call.expression)) return translators.has(call.expression.text);
      if (
        ts.isPropertyAccessExpression(call.expression) &&
        ts.isIdentifier(call.expression.expression)
      ) {
        return translators.has(call.expression.expression.text);
      }
      return false;
    };
    if (ts.isCallExpression(node) && callMatches(node) && node.arguments !== undefined) {
      const expression = node.expression as ts.Expression;
      const translatorId = ts.isIdentifier(expression)
        ? expression
        : (expression as ts.PropertyAccessExpression).expression;
      const ns = translators.get((translatorId as ts.Identifier).text) ?? "";
      const [firstArg, secondArg] = node.arguments;
      if (firstArg && ts.isStringLiteral(firstArg)) {
        const key = firstArg.text;
        const fnParams: string[] = [];
        if (secondArg && ts.isObjectLiteralExpression(secondArg)) {
          for (const prop of secondArg.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer))
            ) {
              fnParams.push(prop.name.text);
            }
          }
        }
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const location = `${file.replace(srcDir, "src").replace(/\\/g, "/")}:${line}`;
        const isRich = ts.isPropertyAccessExpression(expression) && expression.name.text === "rich";
        if (isRich && fnParams.length > 0) {
          richCalls.push({ file: location, line, ns, key, handlers: fnParams });
        } else if (!isRich && fnParams.length > 0) {
          plainViolations.push({ file: location, line, ns, key, fnParams });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const messageCache = new Map<string, Record<string, unknown>>();
const loadLocale = (locale: string): Record<string, unknown> => {
  const cached = messageCache.get(locale);
  if (cached) return cached;
  const dir = join(messagesDir, locale);
  const merged: Record<string, unknown> = {};
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith(".json")) continue;
    Object.assign(merged, JSON.parse(readFileSync(join(dir, entry), "utf8")));
  }
  messageCache.set(locale, merged);
  return merged;
};

const lookup = (messages: Record<string, unknown>, ns: string, key: string): string | undefined => {
  const nsParts = ns.split(".");
  const keyParts = key.split(".");
  const attempts: Array<{ nsSegments: string[]; keySegments: string[] }> = [
    { nsSegments: nsParts, keySegments: keyParts },
    { nsSegments: nsParts.slice(0, -1), keySegments: [...nsParts.slice(-1), ...keyParts] },
    { nsSegments: nsParts, keySegments: keyParts.slice(1) },
  ];
  for (const { nsSegments, keySegments } of attempts) {
    const nsFile = nsSegments[0];
    if (!nsFile) continue;
    const root = messages[nsFile];
    if (typeof root !== "object" || root === null) continue;
    let current: unknown = root;
    let ok = true;
    for (const segment of [...nsSegments.slice(1), ...keySegments]) {
      if (typeof current === "object" && current !== null && segment in (current as object)) {
        current = (current as Record<string, unknown>)[segment];
      } else {
        ok = false;
        break;
      }
    }
    if (ok && typeof current === "string") return current;
  }
  return undefined;
};

type IcuNode = ReturnType<typeof parse>[number];

const astNames = (nodes: readonly IcuNode[]) => {
  const args = new Set<string>();
  const tags = new Set<string>();
  const walk = (list: readonly IcuNode[]): void => {
    for (const node of list) {
      if (
        node.type === TYPE.argument ||
        node.type === TYPE.number ||
        node.type === TYPE.date ||
        node.type === TYPE.time
      ) {
        args.add(node.value);
      } else if (node.type === TYPE.tag) {
        tags.add(node.value);
        walk(node.children);
      } else if (node.type === TYPE.select || node.type === TYPE.plural) {
        for (const option of Object.values(node.options)) walk(option.value);
      }
    }
  };
  walk(nodes);
  return { args, tags };
};

const setDiff = (a: Set<string>, b: Set<string>): string[] => [...a].filter((item) => !b.has(item));

describe("i18n rich message contract (tag handlers vs messages)", () => {
  it("found rich call sites to audit (guards against silent parser drift)", () => {
    expect(richCalls.length).toBeGreaterThan(0);
  });

  it("gives every t.rich handler a matching <tag> in all seven locales", () => {
    const failures: string[] = [];
    for (const call of richCalls) {
      for (const locale of locales) {
        const message = lookup(loadLocale(locale), call.ns, call.key);
        if (message === undefined) {
          failures.push(`${call.file} → "${call.key}" missing in ${locale}`);
          continue;
        }
        for (const handler of call.handlers) {
          if (!message.includes(`<${handler}>`)) {
            failures.push(
              `${call.file} handler "${handler}" has no <${handler}> tag in ${locale}: "${message}"`,
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("keeps argument and tag name sets identical to en across locales", () => {
    const failures: string[] = [];
    for (const call of richCalls) {
      const en = lookup(loadLocale("en"), call.ns, call.key);
      if (en === undefined) {
        failures.push(`${call.file} → "${call.key}" missing in en`);
        continue;
      }
      const baseline = astNames(parse(en));
      for (const locale of locales) {
        if (locale === "en") continue;
        const message = lookup(loadLocale(locale), call.ns, call.key);
        if (message === undefined) continue; // covered by the key-presence gate
        const names = astNames(parse(message));
        for (const missing of setDiff(baseline.args, names.args)) {
          failures.push(`${call.file} "${call.key}" ${locale}: argument {${missing}} missing`);
        }
        for (const extra of setDiff(names.args, baseline.args)) {
          failures.push(`${call.file} "${call.key}" ${locale}: unexpected argument {${extra}}`);
        }
        for (const missing of setDiff(baseline.tags, names.tags)) {
          failures.push(`${call.file} "${call.key}" ${locale}: tag <${missing}> missing`);
        }
        for (const extra of setDiff(names.tags, baseline.tags)) {
          failures.push(`${call.file} "${call.key}" ${locale}: unexpected tag <${extra}>`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("never passes functions to plain t() interpolation", () => {
    expect(
      plainViolations.map(
        (violation) =>
          `${violation.file} "${violation.key}" params: ${violation.fnParams.join(", ")}`,
      ),
    ).toEqual([]);
  });
});
