import { describe, expect, it } from "vitest";
import { zonedToUtc } from "../src/lib/market-sessions";
import {
  barsOfDay,
  dailyBarAt,
  dailyBarsBefore,
  dayWindow,
  DAY_MS,
  journalDayOf,
} from "../src/lib/day-window";
import type { MarketBar } from "../src/lib/market-data";

const iso = (time: number) => new Date(time).toISOString();
const daily = (day: string, range = 10): MarketBar => {
  const time = Date.parse(`${day}T00:00:00Z`);
  return { time, open: 100, high: 100 + range, low: 100, close: 105, volume: 1 };
};
const days = (first: string, count: number) =>
  Array.from({ length: count }, (_, i) =>
    iso(Date.parse(`${first}T00:00:00Z`) + i * DAY_MS).slice(0, 10),
  );

describe("wall-clock times in a journal time zone", () => {
  it("a midnight skipped by daylight saving starts the day at 01:00 the same day", () => {
    // Santiago springs forward at 00:00 on 2026-09-06; Havana at 00:00 on 2026-03-08.
    expect(iso(zonedToUtc(2026, 9, 6, 0, 0, "America/Santiago"))).toBe("2026-09-06T04:00:00.000Z");
    expect(iso(zonedToUtc(2026, 3, 8, 0, 0, "America/Havana"))).toBe("2026-03-08T05:00:00.000Z");
  });

  it("a time inside a gap moves forward by the gap, and a repeated time is its first occurrence", () => {
    expect(iso(zonedToUtc(2026, 3, 8, 2, 30, "America/New_York"))).toBe("2026-03-08T07:30:00.000Z");
    expect(iso(zonedToUtc(2026, 3, 29, 1, 30, "Europe/London"))).toBe("2026-03-29T01:30:00.000Z");
    // 01:30 happens twice in New York on 2026-11-01: EDT (05:30Z) first.
    expect(iso(zonedToUtc(2026, 11, 1, 1, 30, "America/New_York"))).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });

  it("the day a clock springs forward lasts 23 hours and the day it falls back 25", () => {
    const hours = (day: string, tz: string) => {
      const { from, to } = dayWindow(day, tz);
      return (to - from) / 3_600_000;
    };
    expect(hours("2026-03-08", "America/New_York")).toBe(23);
    expect(hours("2026-11-01", "America/New_York")).toBe(25);
    expect(hours("2026-09-06", "America/Santiago")).toBe(23);
    expect(hours("2026-03-08", "America/Havana")).toBe(23);
    expect(hours("2026-03-10", "Asia/Kolkata")).toBe(24);
  });
});

describe("daily candles against a journal day", () => {
  const bars = days("2026-02-20", 20).map((d) => daily(d));

  it.each(["UTC", "America/New_York", "America/Los_Angeles", "Asia/Kolkata", "Asia/Tokyo"])(
    "a day's average range never includes the day itself (%s)",
    (tz) => {
      const { from } = dayWindow("2026-03-10", tz);
      const before = dailyBarsBefore(bars, from, 14);
      expect(before).toHaveLength(14);
      for (const bar of before) expect(bar.time + DAY_MS).toBeLessThanOrEqual(from);
      expect(before.map((b) => iso(b.time).slice(0, 10))).not.toContain("2026-03-10");
    },
  );

  it("a day's average uses the fourteen days right before it west of UTC", () => {
    const { from } = dayWindow("2026-03-10", "America/New_York");
    const before = dailyBarsBefore(bars, from, 14);
    expect(iso(before.at(-1)!.time).slice(0, 10)).toBe("2026-03-09");
    expect(iso(before[0]!.time).slice(0, 10)).toBe("2026-02-24");
  });

  it.each(["UTC", "America/New_York", "America/Los_Angeles", "Asia/Kolkata", "Europe/London"])(
    "a source with only daily candles describes a day by that day's candle (%s)",
    (tz) => {
      const window = dayWindow("2026-03-10", tz);
      const picked = barsOfDay(bars, "1d", window);
      expect(picked.map((b) => iso(b.time).slice(0, 10))).toEqual(["2026-03-10"]);
    },
  );

  it("an intraday source keeps every candle that opens inside the day, and weekly candles none", () => {
    const window = dayWindow("2026-03-10", "America/New_York");
    const hourly: MarketBar[] = Array.from({ length: 72 }, (_, i) => ({
      ...daily("2026-03-09"),
      time: Date.parse("2026-03-09T00:00:00Z") + i * 3_600_000,
    }));
    const picked = barsOfDay(hourly, "1h", window);
    expect(picked).toHaveLength(24);
    expect(iso(picked[0]!.time)).toBe("2026-03-10T04:00:00.000Z");
    expect(barsOfDay([daily("2026-03-09")], "1w", window)).toEqual([]);
  });
});

describe("trades against daily candles", () => {
  it("a trade counts under the candle it closed in, not under its UTC date", () => {
    // A stock source stamps daily candles at New York midnight (05:00Z in winter).
    const stock = ["2026-03-02", "2026-03-03"].map((d) => ({
      ...daily(d),
      time: Date.parse(`${d}T05:00:00Z`),
    }));
    // 22:00 New York on 03-02 is 03:00Z on 03-03, still inside the 03-02 candle.
    expect(iso(dailyBarAt(stock, Date.parse("2026-03-03T03:00:00Z"))!.time)).toBe(
      "2026-03-02T05:00:00.000Z",
    );
    expect(dailyBarAt(stock, Date.parse("2026-03-02T04:59:00Z"))).toBeUndefined();
  });

  it("a trade on a day without a candle (a weekend on a stock) counts under none", () => {
    const friday = [{ ...daily("2026-03-06"), time: Date.parse("2026-03-06T05:00:00Z") }];
    expect(dailyBarAt(friday, Date.parse("2026-03-07T15:00:00Z"))).toBeUndefined();
    expect(dailyBarAt([], Date.parse("2026-03-07T15:00:00Z"))).toBeUndefined();
  });

  it("a daily candle stands for the journal day holding most of its hours", () => {
    const bar = daily("2026-03-10");
    expect(journalDayOf(bar, "UTC")).toBe("2026-03-10");
    expect(journalDayOf(bar, "America/New_York")).toBe("2026-03-10");
    expect(journalDayOf(bar, "Asia/Kolkata")).toBe("2026-03-10");
    // In Auckland (UTC+13) a UTC candle spends 13 of its 24 hours on the next day.
    expect(journalDayOf(bar, "Pacific/Auckland")).toBe("2026-03-11");
  });
});
