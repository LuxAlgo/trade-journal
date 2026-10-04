import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { locales } from "../src/i18n/config";
import { label as propLabel } from "../src/lib/prop-firms";
import { calendarInsights, weekdayLabel } from "../src/lib/calendar-insights";
import { describeFilters } from "../src/lib/filter-description";

const MESSAGES_ROOT = fileURLToPath(new URL("../messages/", import.meta.url));
const OWN_NAMESPACES = ["shell", "filters", "enums", "controls"] as const;

const load = (locale: string, ns: string): Record<string, unknown> =>
  JSON.parse(readFileSync(`${MESSAGES_ROOT}${locale}/${ns}.json`, "utf8"))[ns] as Record<
    string,
    unknown
  >;

const keyPaths = (node: unknown, prefix = ""): string[] => {
  if (typeof node !== "object" || node === null || Array.isArray(node)) return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    keyPaths(value, prefix ? `${prefix}.${key}` : key),
  );
};

const leafValues = (node: unknown): string[] => {
  if (typeof node === "string") return [node];
  if (typeof node !== "object" || node === null) throw new Error("non-string leaf");
  return Object.values(node as Record<string, unknown>).flatMap(leafValues);
};

/** Collects plural/select category names from a parsed ICU AST. */
const pluralCategories = (nodes: MessageFormatElement[]): string[] =>
  nodes.flatMap((node) => {
    if (node.type === TYPE.plural || node.type === TYPE.select) {
      return [
        ...Object.keys(node.options),
        ...pluralCategories(Object.values(node.options).flatMap((option) => option.value)),
      ];
    }
    if (node.type === TYPE.tag) return pluralCategories(node.children);
    return [];
  });

/** Walks a dotted path through a namespace object. */
const at = (node: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((current, part) => {
    if (typeof current !== "object" || current === null) throw new Error(`missing ${path}`);
    return (current as Record<string, unknown>)[part];
  }, node);

/** Minimal ICU-style translator for lib helpers (params replaced verbatim). */
const translatorOf =
  (namespace: Record<string, unknown>) =>
  (key: string, values?: Record<string, string | number>): string => {
    const raw = at(namespace, key);
    if (typeof raw !== "string") throw new Error(`missing message ${key}`);
    return Object.entries(values ?? {}).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      raw,
    );
  };

describe("shared-layer message catalogues", () => {
  it("has identical key sets across all seven languages", () => {
    for (const ns of OWN_NAMESPACES) {
      const enKeys = keyPaths(load("en", ns)).sort();
      for (const locale of locales) {
        expect(keyPaths(load(locale, ns)).sort(), `${locale}/${ns}`).toEqual(enKeys);
      }
    }
  });

  it("has non-empty string values everywhere", () => {
    for (const locale of locales) {
      for (const ns of OWN_NAMESPACES) {
        for (const value of leafValues(load(locale, ns))) {
          expect(typeof value, `${locale}/${ns}`).toBe("string");
          expect(value.trim().length, `${locale}/${ns}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("parses every value as ICU MessageFormat", () => {
    for (const locale of locales) {
      for (const ns of OWN_NAMESPACES) {
        for (const value of leafValues(load(locale, ns))) {
          expect(() => parse(value), `${locale}/${ns}: ${value}`).not.toThrow();
        }
      }
    }
  });

  it("keeps CJK plurals on the other branch only", () => {
    for (const locale of ["zh-CN", "zh-TW", "ja", "ko"]) {
      for (const ns of OWN_NAMESPACES) {
        for (const value of leafValues(load(locale, ns))) {
          if (!value.includes("plural")) continue;
          const categories = pluralCategories(parse(value));
          expect(
            categories.filter((c) => c !== "other"),
            `${locale}/${ns}: ${value}`,
          ).toEqual([]);
        }
      }
    }
  });
});

describe("enum catalogue coverage", () => {
  const GROUPS: Record<string, string[]> = {
    direction: ["long", "short"],
    status: ["closed", "open", "win", "loss", "breakeven"],
    reviewed: ["yes", "no"],
    assetClass: ["equity", "futures", "forex", "option", "crypto", "cfd", "other"],
    costBasis: ["fifo", "lifo", "wavg"],
    priceBasis: ["raw", "split", "adjusted", "midpoint", "bid", "ask"],
    "prop.values": [
      "evaluation",
      "verification",
      "funded",
      "instantFunded",
      "live",
      "active",
      "passed",
      "breached",
      "closed",
      "requested",
      "approved",
      "completed",
      "rejected",
      "cancelled",
      "reset",
      "activation",
      "subscription",
      "platform",
      "marketData",
      "transfer",
      "other",
      "expense",
      "refund",
      "payout",
    ],
  };

  it("maps every product-owned enum value in all seven languages", () => {
    for (const locale of locales) {
      const enums = load(locale, "enums");
      for (const [path, values] of Object.entries(GROUPS)) {
        const node = at(enums, path) as Record<string, unknown>;
        for (const value of values) {
          expect(typeof node[value], `${locale}/${path}.${value}`).toBe("string");
          expect(
            (node[value] as string).trim().length,
            `${locale}/${path}.${value}`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("localized lib helpers", () => {
  it("keeps the prop-firm label() en baseline and resolves other languages", () => {
    expect(propLabel("instant_funded")).toBe("Instant funded");
    expect(propLabel("market_data")).toBe("Market data");
    expect(propLabel("custom_extra")).toBe("Custom extra");
    const t = translatorOf(load("en", "enums"));
    expect(propLabel("instant_funded", t)).toBe("Instant funded");
    expect(propLabel("breached", t)).toBe("Breached");
    const tZh = translatorOf(load("zh-CN", "enums"));
    expect(propLabel("breached", tZh)).toBe("已违规");
    expect(propLabel("custom_extra", tZh)).toBe("Custom extra");
  });

  it("localizes calendar weekday labels through calendarInsights", () => {
    expect(weekdayLabel(0, "en")).toBe("Sunday");
    expect(weekdayLabel(2, "ja")).toBe("火曜日");
    const emptyCalendar = {
      year: 2026,
      month: 9,
      weeks: [],
      monthNetPnl: 0,
      monthTrades: 0,
      tradingDays: 0,
      winningDays: 0,
    };
    const insights = calendarInsights(emptyCalendar, "ja");
    expect(insights.weekdays.map((week) => week.label)).toEqual([
      "日曜日",
      "月曜日",
      "火曜日",
      "水曜日",
      "木曜日",
      "金曜日",
      "土曜日",
    ]);
    expect(calendarInsights(emptyCalendar).weekdays[0]!.label).toBe("Sunday");
  });

  it("resolves filter descriptions through the filters catalogue", () => {
    expect(describeFilters({}, [], [], false)).toBe("All trades");
    expect(describeFilters({}, [], [], false, translatorOf(load("zh-CN", "filters")))).toBe(
      "全部交易",
    );
    expect(describeFilters({ direction: "long", weekdays: "1,2" }, [], [], false)).toBe(
      "Direction: long · Entry weekdays: Mon, Tue",
    );
    expect(
      describeFilters(
        { direction: "long", weekdays: "1,2" },
        [],
        [],
        false,
        translatorOf(load("zh-CN", "filters")),
      ),
    ).toBe("方向：long · 入场星期：周一, 周二");
    // Values like account/strategy names stay user content in every language.
    const accounts = [{ id: "a", name: "My Fund" }];
    expect(
      describeFilters(
        { accounts: "a,x" },
        accounts,
        [],
        false,
        translatorOf(load("zh-CN", "filters")),
      ),
    ).toBe("账户：My Fund, 所选账户");
  });
});
