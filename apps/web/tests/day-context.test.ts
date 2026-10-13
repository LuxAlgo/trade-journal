import { describe, expect, it } from "vitest";
import {
  contextTags,
  dayContext,
  dayTypeStats,
  describeContext,
  trailingRanges,
} from "../src/lib/day-context";

const day = (open: number, high: number, low: number, close: number) => ({
  open,
  high,
  low,
  close,
});

describe("each trading day gets a type from its candle", () => {
  it("closing far from the open is a trend day; near it, a range day", () => {
    expect(dayContext(day(100, 110, 99, 109), null).shape).toBe("trend-up");
    expect(dayContext(day(110, 111, 100, 101), null).shape).toBe("trend-down");
    expect(dayContext(day(100, 105, 95, 101), null).shape).toBe("range");
    expect(dayContext(day(100, 110, 100, 105), null).shape).toBe("mixed");
    expect(dayContext(day(100, 100, 100, 100), null).shape).toBe("range");
  });

  it("volatility compares the range with the days before", () => {
    expect(dayContext(day(100, 103, 100, 102), 10).volatility).toBe("quiet");
    expect(dayContext(day(100, 110, 100, 105), 10).volatility).toBe("normal");
    expect(dayContext(day(100, 120, 100, 110), 10)).toMatchObject({
      volatility: "volatile",
      rangeRatio: 2,
    });
    expect(dayContext(day(100, 120, 100, 110), null).volatility).toBeNull();
    expect(
      trailingRanges(
        [
          { high: 2, low: 1 },
          { high: 4, low: 1 },
          { high: 5, low: 5 },
        ],
        2,
      ),
    ).toEqual([null, 1, 2]);
  });

  it("is described for the AI and tagged for the breakdown", () => {
    const context = dayContext(day(100, 120, 100, 118), 10, ["USD CPI y/y"]);
    expect(describeContext(context)).toBe(
      "Day type: trend day up, volatile (2.00x the average range); high-impact news: USD CPI y/y",
    );
    expect(contextTags(context)).toEqual(["Trend day up", "Volatile", "High-impact news"]);
  });

  it("splits closed trades by the type of the day they closed on", () => {
    const trend = dayContext(day(100, 110, 99, 109), 10);
    const range = dayContext(day(100, 105, 95, 101), 10, ["USD NFP"]);
    const rows = dayTypeStats(
      [
        { symbol: "BTC", day: "d1", netPnl: 50, status: "win" },
        { symbol: "BTC", day: "d1", netPnl: -10, status: "loss" },
        { symbol: "BTC", day: "d2", netPnl: -30, status: "loss" },
        { symbol: "ETH", day: "d2", netPnl: 99, status: "win" },
      ],
      (symbol, d) => (symbol === "BTC" ? (d === "d1" ? trend : range) : undefined),
    );
    expect(rows.map((r) => [r.tag, r.trades, r.wins, r.netPnl])).toEqual([
      ["Trend day up", 2, 1, 40],
      ["Range day", 1, 0, -30],
      ["Normal volatility", 3, 1, 10],
      ["High-impact news", 1, 0, -30],
      ["No high-impact news", 2, 1, 40],
    ]);
  });
});
