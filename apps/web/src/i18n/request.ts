import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, resolveRequestedLocale, type Locale } from "./config";

/**
 * Server-side message loading for the App Router (no [locale] segment — the
 * language lives only in the NEXT_LOCALE cookie).
 *
 * Every `messages/<locale>/<ns>.json` file must declare exactly one top-level
 * key that matches its file name (`common.json` → `{ "common": { … } }`), so
 * the merged object has one namespace per file and drift fails loudly.
 */

/**
 * Merge every `<ns>.json` file in a locale directory. `dir` must already be
 * a validated enum-derived path — this function never sanitizes input.
 */
export const mergeLocaleMessages = (dir: string): Record<string, unknown> => {
  const messages: Record<string, unknown> = {};
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith(".json")) continue;
    const path = join(dir, entry);
    const namespace = entry.slice(0, -".json".length);
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const keys =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? Object.keys(parsed)
        : [];
    if (keys.length !== 1 || keys[0] !== namespace) {
      throw new Error(
        `Message file ${path} must contain exactly one top-level key named "${namespace}" (got: ${
          keys.length === 0 ? "none" : keys.join(", ")
        })`,
      );
    }
    Object.assign(messages, parsed);
  }
  return messages;
};

/**
 * Locate the messages root. `next dev`/`next build`/`next start` run with
 * apps/web as the cwd; the standalone bundle runs one level above the traced
 * copy (apps/web/messages). Candidates are fixed paths — never derived from
 * request data.
 */
const messageRootCandidates = (): string[] => [
  join(process.cwd(), "messages"),
  join(process.cwd(), "apps", "web", "messages"),
];

export const loadLocaleMessages = (locale: Locale): Record<string, unknown> => {
  const root = messageRootCandidates().find((candidate) => existsSync(candidate));
  if (!root) {
    throw new Error(
      `Messages directory not found (searched: ${messageRootCandidates().join(", ")})`,
    );
  }
  // `locale` is a validated enum member, so the joined path stays inside root.
  return mergeLocaleMessages(join(root, locale));
};

export default getRequestConfig(async () => {
  const jar = await cookies();
  const locale = resolveRequestedLocale(jar.get(LOCALE_COOKIE)?.value);
  return { locale, messages: loadLocaleMessages(locale) };
});
