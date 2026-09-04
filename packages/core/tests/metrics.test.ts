import { describe, expect, it } from "vitest";
import { buildRoundTrips } from "../src/round-trips";
import { computeMetrics, realizedR } from "../src/metrics";
import { EDGE_SCORE_VERSION, computeEdgeScore } from "../src/edge-score";
import { calendarMonth, byWeekday, byDuration } from "../src/aggregate";
import {
  dailyStats,
  drawdown,
  equityCurve,
  intradayCurve,
  relativeDrawdownCurve,
} from "../src/equity";
import { dayKeyOf } from "../src/time";
import type { AnnotatedTrade } from "../src/types";
import { fill } from "./helpers";

/** Two winning days and one losing day across three symbols. */
const sampleTrades = () =>
  buildRoundTrips([
    fill("AAPL", "buy", 10, 100, "2026-01-05T14:30:00Z"),
    fill("AAPL", "sell", 10, 110, "2026-01-05T15:30:00Z"), // +100
    fill("TSLA", "buy", 5, 200, "2026-01-05T16:00:00Z"),
    fill("TSLA", "sell", 5, 190, "2026-01-05T17:00:00Z"), // -50
    fill("SPY", "buy", 20, 500, "2026-01-06T14:30:00Z"),
    fill("SPY", "sell", 20, 505, "2026-01-06T15:30:00Z"), // +100
    fill("AMD", "buy", 10, 150, "2026-01-07T14:30:00Z"),
    fill("AMD", "sell", 10, 140, "2026-01-07T15:30:00Z"), // -100
  ]);

describe("performance metrics tell the trader the truth about their edge", () => {
  it("win rate, profit factor, and net P&L match a hand-computed sample", () => {
    const m = computeMetrics(sampleTrades());
    expect(m.closedTrades).toBe(4);
    expect(m.wins).toBe(2);
    expect(m.losses).toBe(2);
    expect(m.netPnl).toBe(50);
    expect(m.winRate).toBe(0.5);
    expect(m.profitFactor).toBeCloseTo(200 / 150, 6);
    expect(m.avgWin).toBe(100);
    expect(m.avgLoss).toBe(75);
    expect(m.expectancy).toBe(12.5);
  });

  it("day win rate counts winning days, not winning trades", () => {
    const m = computeMetrics(sampleTrades());
    // Jan 5: +50 (win day), Jan 6: +100 (win day), Jan 7: -100 (loss day)
    expect(m.tradingDays).toBe(3);
    expect(m.dayWinRate).toBeCloseTo(2 / 3, 6);
  });

  it("streaks track consecutive wins and losses in close order", () => {
    const m = computeMetrics(sampleTrades());
    // Order: win, loss, win, loss → max streaks of 1 each, ending on a loss.
    expect(m.maxWinStreak).toBe(1);
    expect(m.maxLossStreak).toBe(1);
    expect(m.currentStreak).toBe(-1);
  });

  it("max drawdown is the deepest fall from an equity peak", () => {
    const curve = equityCurve(sampleTrades());
    // Cumulative: 100, 50, 150, 50 → peak 150, trough 50 → drawdown 100.
    const dd = drawdown(curve, 1000);
    expect(dd.maxDrawdown).toBe(100);
    expect(dd.maxDrawdownPct).toBeCloseTo(100 / 1150, 6);
  });

  it("relative drawdown tracks every point below the running equity peak", () => {
    const curve = equityCurve(sampleTrades());
    const relative = relativeDrawdownCurve(curve, 1000);
    expect(relative.map((point) => point.drawdownPct)).toEqual([0, 50 / 1100, 0, 100 / 1150]);
  });

  it("a profitable account with zero losing trades reports an infinite profit factor explicitly", () => {
    const m = computeMetrics(
      buildRoundTrips([
        fill("AAPL", "buy", 1, 10, "2026-01-05T14:30:00Z"),
        fill("AAPL", "sell", 1, 12, "2026-01-05T15:30:00Z"),
      ]),
    );
    expect(m.profitFactor).toBeNull();
    expect(m.profitFactorIsInfinite).toBe(true);
  });

  it("realized R multiple relates profit to the risk the trader planned at entry", () => {
    const trade = sampleTrades()[0]! as AnnotatedTrade;
    // Long from 100, stop 95 → risk $5/share × 10 shares = $50 risk; made $100 → 2R.
    trade.annotations = { stopLoss: 95 };
    expect(realizedR(trade)).toBeCloseTo(2, 6);
  });

  it("a futures trade with a stop loss and a contract multiplier reports its realized R", () => {
    const trade = buildRoundTrips(
      [
        fill("ES", "buy", 2, 5000, "2026-04-01T14:00:00Z", { assetClass: "futures" }),
        fill("ES", "sell", 2, 5010, "2026-04-01T15:00:00Z", { assetClass: "futures" }),
      ],
      { multipliers: { ES: 50 } },
    )[0]! as AnnotatedTrade;
    // Stop 5 points away × 2 contracts × $50 per point = $500 risk; made $1,000 → 2R.
    trade.annotations = { stopLoss: 4995 };
    expect(realizedR(trade)).toBeCloseTo(2, 6);
    expect(computeMetrics([trade]).tradesWithRisk).toBe(1);
  });

  it("a futures trade with no known contract multiplier reports no realized R rather than a wrong one", () => {
    const trade = buildRoundTrips([
      fill("ES", "buy", 2, 5000, "2026-04-01T14:00:00Z", { assetClass: "futures" }),
      fill("ES", "sell", 2, 5010, "2026-04-01T15:00:00Z", { assetClass: "futures" }),
    ])[0]! as AnnotatedTrade;
    trade.annotations = { stopLoss: 4995 };
    expect(realizedR(trade)).toBeNull();
  });

  it("gross profit and gross loss count every closed trade, including ones labeled breakeven", () => {
    const [win, loss] = sampleTrades() as AnnotatedTrade[];
    const nearFlat: AnnotatedTrade = { ...win!, key: "near-flat", netPnl: 3, status: "breakeven" };
    const m = computeMetrics([win!, loss!, nearFlat]);
    expect(m.breakevens).toBe(1);
    expect(m.profitFactor).toBeCloseTo(103 / 50, 6);
  });
});

describe("the Edge Score is transparent and refuses to score tiny samples", () => {
  it("every score is stamped with formula version 2", () => {
    expect(EDGE_SCORE_VERSION).toBe(2);
    expect(computeEdgeScore(computeMetrics(sampleTrades())).version).toBe(2);
  });

  it("returns no score below five closed trades but still exposes components", () => {
    const m = computeMetrics(sampleTrades());
    const edge = computeEdgeScore(m);
    expect(edge.score).toBeNull();
    expect(edge.components.winRate).toBeGreaterThan(0);
  });

  it("scores a strong sample within 0-100 with every component bounded", () => {
    const executions = Array.from({ length: 10 }, (_, i) => [
      fill("SPY", "buy" as const, 10, 100, `2026-01-${String(i + 5).padStart(2, "0")}T14:30:00Z`),
      fill(
        "SPY",
        "sell" as const,
        10,
        i % 4 === 3 ? 99 : 102, // 3 small losses, 7 wins ≈ 70% win rate
        `2026-01-${String(i + 5).padStart(2, "0")}T15:30:00Z`,
      ),
    ]).flat();
    const edge = computeEdgeScore(
      computeMetrics(buildRoundTrips(executions), { initialBalance: 10_000 }),
    );
    expect(edge.score).not.toBeNull();
    expect(edge.score!).toBeGreaterThan(0);
    expect(edge.score!).toBeLessThanOrEqual(100);
    for (const value of Object.values(edge.components)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe("calendar and buckets group trading days the way a trader reads them", () => {
  it("the monthly calendar sums weeks and the month to the same total", () => {
    const cal = calendarMonth(sampleTrades(), 2026, 1);
    expect(cal.monthNetPnl).toBe(50);
    expect(cal.monthTrades).toBe(4);
    expect(cal.tradingDays).toBe(3);
    expect(cal.winningDays).toBe(2);
    const weeksTotal = cal.weeks.reduce((total, week) => total + week.weekNetPnl, 0);
    expect(weeksTotal).toBeCloseTo(cal.monthNetPnl, 6);
    for (const week of cal.weeks) expect(week.days).toHaveLength(7);
  });

  it("a late-evening New York fill lands on the trader's local day, not the UTC day", () => {
    // 2026-01-05T23:30 ET is 2026-01-06T04:30Z.
    expect(dayKeyOf("2026-01-06T04:30:00Z", "America/New_York")).toBe("2026-01-05");
    const days = dailyStats(
      buildRoundTrips([
        fill("AAPL", "buy", 1, 10, "2026-01-06T04:00:00Z"),
        fill("AAPL", "sell", 1, 12, "2026-01-06T04:30:00Z"),
      ]),
      "America/New_York",
    );
    expect(days[0]!.date).toBe("2026-01-05");
  });

  it("weekday buckets come back in calendar order regardless of P&L", () => {
    const buckets = byWeekday(sampleTrades());
    const order = buckets.map((b) => b.key);
    expect(order).toEqual(
      [...order].sort(
        (a, b) =>
          "Sun Mon Tue Wed Thu Fri Sat".indexOf(a) - "Sun Mon Tue Wed Thu Fri Sat".indexOf(b),
      ),
    );
  });

  it("duration buckets classify scalps and swings separately", () => {
    // Sample holds are exactly 60m; bucket edges are half-open so they land in 1-4h.
    const buckets = byDuration(sampleTrades());
    expect(buckets.some((b) => b.key === "1-4h")).toBe(true);
    expect(buckets.some((b) => b.key === "> 1d")).toBe(false);
  });

  it("the intraday curve ends at exactly the day's net P&L", () => {
    const executions = [
      fill("AAPL", "buy", 10, 100, "2026-01-05T14:30:00Z", { fee: 1 }),
      fill("AAPL", "sell", 10, 110, "2026-01-05T15:30:00Z", { fee: 1 }),
      fill("TSLA", "buy", 5, 200, "2026-01-05T16:00:00Z"),
      fill("TSLA", "sell", 5, 190, "2026-01-05T17:00:00Z"),
    ];
    const trades = buildRoundTrips(executions);
    const times = new Map(executions.map((e) => [e.id, e.executedAt]));
    const curve = intradayCurve(trades, times, "2026-01-05");
    expect(curve.at(-1)!.cumNetPnl).toBeCloseTo(98 - 50, 6);
  });
});
