import { describe, expect, it } from "vitest";
import {
  buildRoundTrips,
  bySymbol,
  calendarMonth,
  calendarMonthFromDays,
  computeMetrics,
  computeOverview,
  dailyCumulative,
  dailyCumulativeFromDays,
  analyzeAdherence,
  type AnnotatedTrade,
} from "../src";
import { fill } from "./helpers";

const base = buildRoundTrips([
  fill("TEST", "buy", 10, 100, "2026-09-01T23:30:00Z"),
  fill("TEST", "sell", 10, 110, "2026-09-02T00:30:00Z"),
])[0]!;
const sample = (
  key: string,
  netPnl: number,
  status: AnnotatedTrade["status"] = netPnl > 0 ? "win" : "loss",
): AnnotatedTrade => ({
  ...base,
  key,
  netPnl,
  status,
  annotations: { playbook: "plan", stopLoss: 98, profitTarget: 104 },
});

describe("optimized reports retain the original calculations", () => {
  it("keeps open volume and breakevens in the right bucket denominators", () => {
    const trades = [
      sample("win", 100),
      sample("loss", -20),
      sample("near-flat", 3, "breakeven"),
      sample("open", 500, "open"),
    ];
    expect(bySymbol(trades)).toEqual([
      { key: "TEST", trades: 4, netPnl: 83, winRate: 1 / 3, profitFactor: 103 / 20, volume: 40 },
    ]);
    expect(bySymbol([sample("open", 500, "open")])[0]).toMatchObject({
      netPnl: 0,
      winRate: null,
      profitFactor: null,
      volume: 10,
    });
  });

  it("reuses daily totals without changing timezone boundaries or any metric", () => {
    const trades = [sample("win", 100), sample("loss", -20), sample("open", 0, "open")];
    for (const timeZone of ["UTC", "America/New_York", "Pacific/Auckland"]) {
      const overview = computeOverview(trades, { timeZone, initialBalance: 1000 });
      expect(overview.metrics).toEqual(computeMetrics(trades, { timeZone, initialBalance: 1000 }));
      expect(dailyCumulativeFromDays(overview.days)).toEqual(dailyCumulative(trades, timeZone));
      expect(calendarMonthFromDays(overview.days, 2026, 9)).toEqual(
        calendarMonth(trades, 2026, 9, timeZone),
      );
    }
  });
});

describe("rule coverage and performance", () => {
  it("separates fully followed, broken and incomplete assessments", () => {
    const trades = [
      sample("complete", 100),
      sample("broken", -20),
      sample("partial", 50),
      sample("empty", -10),
      sample("open", 200, "open"),
    ];
    const checks = [
      { tradeKey: "complete", rule: "Entry", followed: true },
      { tradeKey: "complete", rule: "Risk", followed: true },
      { tradeKey: "broken", rule: "Risk", followed: false },
      { tradeKey: "partial", rule: "Entry", followed: true },
      { tradeKey: "empty", rule: "Removed rule", followed: false },
      { tradeKey: "open", rule: "Risk", followed: false },
      { tradeKey: "outside-filter", rule: "Risk", followed: false },
    ].map((check) => ({ ...check, playbookId: "plan" }));
    const [report] = analyzeAdherence(
      trades,
      [{ id: "plan", rules: ["Entry", "Risk", "Risk"] }],
      checks,
    );
    expect(report).toMatchObject({
      total: 4,
      evaluated: 4,
      possible: 8,
      rate: 0.75,
      unassessed: 2,
    });
    expect(report?.followed).toMatchObject({ trades: 1, netPnl: 100 });
    expect(report?.broken).toMatchObject({ trades: 1, netPnl: -20 });
    expect(report?.rules[0]).toMatchObject({
      rule: "Entry",
      evaluated: 2,
      rate: 1,
      followed: { netPnl: 150 },
    });
    expect(report?.rules[1]).toMatchObject({ rule: "Risk", evaluated: 2, rate: 0.5 });
  });

  it("does not treat an empty checklist or a different playbook as adherence", () => {
    const [empty, other] = analyzeAdherence(
      [sample("one", 10)],
      [
        { id: "plan", rules: [] },
        { id: "other", rules: ["Entry"] },
      ],
      [{ tradeKey: "one", playbookId: "other", rule: "Entry", followed: true }],
    );
    expect(empty).toMatchObject({
      rate: null,
      possible: 0,
      unassessed: 1,
      followed: { trades: 0 },
    });
    expect(other).toMatchObject({ total: 0, evaluated: 0, rate: null });
  });
});
