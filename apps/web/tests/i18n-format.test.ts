import { describe, expect, it } from "vitest";
import {
  fmtDuration,
  fmtDurationLocalized,
  fmtMoney,
  fmtNumber,
  fmtPercent,
  type Translator,
} from "../src/lib/utils";

// Locale output checks use the three scripts/families en, fr and ja; exact
// strings are asserted only where ICU output is stable across versions.
describe("fmtMoney", () => {
  it("keeps the en-US baseline output", () => {
    // signDisplay "exceptZero": positives carry an explicit "+".
    expect(fmtMoney(1234.5, "USD", "en-US")).toBe("+$1,234.50");
    expect(fmtMoney(-1234.5, "EUR", "en-US")).toBe("-€1,234.50");
    expect(fmtMoney(0, "USD", "en-US")).toBe("$0.00");
  });
  it("renders fr-FR grouping and decimal comma", () => {
    expect(fmtMoney(1234.5, "EUR", "fr-FR")).toMatch(
      /^\+1[\s\u00a0\u202f]234,50[\s\u00a0\u202f]€$/,
    );
  });
  it("renders ja-JP yen without decimals", () => {
    expect(fmtMoney(1234, "JPY", "ja-JP")).toBe("+￥1,234");
  });
  it("does not leak formatters across locales", () => {
    expect(fmtMoney(1, "USD", "en-US")).toBe("+$1.00");
    expect(fmtMoney(1, "USD", "fr-FR")).toMatch(/^\+?1,00[\s\u00a0\u202f]\$US$/);
    expect(fmtMoney(2, "USD", "en-US")).toBe("+$2.00");
    expect(fmtMoney(2, "USD", "fr-FR")).toMatch(/^\+?2,00[\s\u00a0\u202f]\$US$/);
  });
});

describe("fmtNumber", () => {
  it("groups and rounds per locale", () => {
    expect(fmtNumber(1234.567, 2, "en-US")).toBe("1,234.57");
    expect(fmtNumber(1234.567, 2, "fr-FR")).toMatch(/^1[\s\u00a0\u202f]234,57$/);
    expect(fmtNumber(1234.567, 2, "ja-JP")).toBe("1,234.57");
  });
});

describe("fmtPercent", () => {
  it("keeps fixed digits and the null dash", () => {
    expect(fmtPercent(0.1234, 1, "en-US")).toBe("12.3%");
    expect(fmtPercent(0.5, 0, "en-US")).toBe("50%");
    expect(fmtPercent(null, 1, "fr-FR")).toBe("–");
  });
  it("localizes the decimal separator", () => {
    expect(fmtPercent(0.1234, 1, "fr-FR")).toMatch(/^12,3[\s\u00a0\u202f]?%$/);
    expect(fmtPercent(0.1234, 1, "ja-JP")).toBe("12.3%");
  });
});

describe("fmtDuration", () => {
  // Compact chart-axis form stays locale-independent by contract.
  it("keeps compact units", () => {
    expect(fmtDuration(null)).toBe("–");
    expect(fmtDuration(undefined)).toBe("–");
    expect(fmtDuration(10_000)).toBe("< 1m");
    expect(fmtDuration(45 * 60_000)).toBe("45m");
    expect(fmtDuration((2 * 60 + 5) * 60_000)).toBe("2h 5m");
    expect(fmtDuration(26 * 60 * 60_000)).toBe("1d 2h");
  });
});

describe("fmtDurationLocalized", () => {
  const recording = (): [
    Translator,
    () => Array<[string, Record<string, string | number> | undefined]>,
  ] => {
    const calls: Array<[string, Record<string, string | number> | undefined]> = [];
    const t: Translator = (key, values) => {
      calls.push([key, values]);
      return key;
    };
    return [t, () => calls];
  };
  it("selects the duration message and passes numeric params", () => {
    const [t, calls] = recording();
    expect(fmtDurationLocalized(null, t)).toBe("–");
    expect(fmtDurationLocalized(10_000, t)).toBe("duration.belowMinute");
    expect(fmtDurationLocalized(45 * 60_000, t)).toBe("duration.minutes");
    expect(fmtDurationLocalized((2 * 60 + 5) * 60_000, t)).toBe("duration.hoursMinutes");
    expect(fmtDurationLocalized(26 * 60 * 60_000, t)).toBe("duration.daysHours");
    expect(calls()).toEqual([
      ["duration.belowMinute", undefined],
      ["duration.minutes", { count: 45 }],
      ["duration.hoursMinutes", { hours: 2, minutes: 5 }],
      ["duration.daysHours", { days: 1, hours: 2 }],
    ]);
  });
  it("reproduces the compact en baseline through the en messages", () => {
    const t: Translator = (key, values) => {
      const v = values ?? {};
      switch (key) {
        case "duration.belowMinute":
          return "< 1m";
        case "duration.minutes":
          return `${v.count}m`;
        case "duration.hoursMinutes":
          return `${v.hours}h ${v.minutes}m`;
        case "duration.daysHours":
          return `${v.days}d ${v.hours}h`;
        default:
          throw new Error(`unexpected key ${key}`);
      }
    };
    for (const ms of [10_000, 45 * 60_000, (2 * 60 + 5) * 60_000, 26 * 60 * 60_000]) {
      expect(fmtDurationLocalized(ms, t)).toBe(fmtDuration(ms));
    }
  });
});
