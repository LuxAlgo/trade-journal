import { describe, expect, it } from "vitest";
import { matchesFilters, type AnnotatedTrade } from "@luxalgo/journal-core";
import { performanceTrends } from "../src/lib/performance-trends";

const trade = (
  index: number,
  netPnl: number,
  patch: Partial<AnnotatedTrade> = {},
): AnnotatedTrade => ({
  key: `trade-${String(index).padStart(3, "0")}`,
  accountId: "a",
  symbol: "AAPL",
  direction: "long",
  status: netPnl > 0 ? "win" : netPnl < 0 ? "loss" : "breakeven",
  openedAt: new Date(Date.UTC(2026, 7, index + 1, 12)).toISOString(),
  closedAt: new Date(Date.UTC(2026, 7, index + 1, 13)).toISOString(),
  quantity: 1,
  openQuantity: 0,
  avgEntry: 100,
  avgExit: 100 + netPnl + 2,
  grossPnl: netPnl + 2,
  fees: 2,
  netPnl,
  executionCount: 2,
  executionIds: [],
  exits: [],
  ...patch,
});

describe("performance trends", () => {
  it("has honest empty and sparse states without partial windows", () => {
    expect(performanceTrends([])).toMatchObject({
      count: 0,
      points: [],
      overallWinRate: null,
      overallAvgNetPnl: null,
      largestWin: null,
      largestLoss: null,
    });
    const result = performanceTrends(Array.from({ length: 19 }, (_, i) => trade(i, 10)));
    expect(result.points).toEqual([]);
    expect(result.overallAvgNetPnl).toBe(10);
    expect(result.overallWinRate).toBe(1);
  });
  it("computes full trailing windows after fees including breakevens in win-rate denominator", () => {
    const values = Array.from({ length: 32 }, (_, i) => [10, -4, 0, 6][i % 4]!);
    const trades = values.map((value, i) => trade(i, value));
    const result = performanceTrends(trades);
    expect(result.points).toHaveLength(13);
    result.points.forEach((point, index) => {
      const window = values.slice(index, index + 20);
      expect(point.sequence).toBe(index + 20);
      expect(point.winRate).toBe(window.filter((value) => value > 0).length / 20);
      expect(point.avgNetPnl).toBeCloseTo(window.reduce((a, b) => a + b, 0) / 20);
      expect(point.key).toBe(trades[index + 19]!.key);
    });
    expect(result.overallWinRate).toBe(0.5);
    expect(result.overallAvgNetPnl).toBe(3);
  });
  it("sorts by closing time deterministically, excludes open trades, and does not mutate input", () => {
    const input = [trade(2, -7), trade(0, 5), trade(1, 4, { closedAt: undefined, status: "open" })];
    const before = structuredClone(input);
    expect(performanceTrends(input)).toMatchObject({
      count: 2,
      overallAvgNetPnl: -1,
      overallWinRate: 0.5,
    });
    expect(input).toEqual(before);
    const tied = [trade(2, 8, { closedAt: input[1]!.closedAt }), input[1]!];
    expect(performanceTrends(tied).largestWin?.key).toBe("trade-002");
  });
  it("links extrema to actual trades and resolves equal amounts to earliest close", () => {
    const input = [trade(5, -10), trade(3, 12), trade(2, 12), trade(1, -10)];
    expect(performanceTrends(input)).toMatchObject({
      largestWin: { key: "trade-002", netPnl: 12 },
      largestLoss: { key: "trade-001", netPnl: -10 },
    });
    expect(performanceTrends([trade(0, 0)])).toMatchObject({
      largestWin: null,
      largestLoss: null,
      overallWinRate: 0,
    });
    expect(performanceTrends([trade(0, 12)]).largestLoss).toBeNull();
    expect(performanceTrends([trade(0, -12)]).largestWin).toBeNull();
  });
  it("honors configured outcome classification rather than deriving wins from the sign", () => {
    const input = Array.from({ length: 20 }, (_, i) => trade(i, 1, { status: "breakeven" }));
    expect(performanceTrends(input)).toMatchObject({
      overallWinRate: 0,
      largestWin: null,
      points: [{ sequence: 20, winRate: 0, avgNetPnl: 1 }],
    });
  });
  it("does not borrow trades outside account, date, annotation, and timezone scope", () => {
    const input = Array.from({ length: 25 }, (_, i) =>
      trade(i, 10, { annotations: { tags: ["setup"] } }),
    );
    input.push(trade(25, 999, { accountId: "b" }));
    input.push(trade(26, 999));
    input.push(
      trade(27, 5, { closedAt: "2026-09-01T00:30:00Z", annotations: { tags: ["setup"] } }),
    );
    const filters = { accounts: "a", tag: "setup", from: "2026-08-01", to: "2026-08-31" };
    const scoped = performanceTrends(
      input.filter((t) => matchesFilters(t, filters, "America/New_York")),
    );
    expect(scoped.count).toBe(26);
    expect(scoped.points.at(-1)?.avgNetPnl).toBe(9.75);
    expect(performanceTrends(input.filter((t) => matchesFilters(t, filters, "UTC"))).count).toBe(
      25,
    );
    expect(
      performanceTrends(
        input.filter((t) => matchesFilters(t, { ...filters, from: "2026-08-20" }, "UTC")),
      ).points,
    ).toEqual([]);
  });
});
