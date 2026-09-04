import { describe, expect, it } from "vitest";
import {
  buildRoundTrips,
  calendarMonthFromDays,
  dailyStats,
  matchesFilters,
  type AnnotatedTrade,
  type DayStats,
} from "@luxalgo/journal-core";
import { calendarInsights, calendarScope, calendarTradeHref } from "../src/lib/calendar-insights";

const day = (date: string, netPnl: number): DayStats => ({
  date,
  netPnl,
  grossPnl: netPnl + 1,
  fees: 1,
  trades: 2,
  wins: netPnl > 0 ? 1 : 0,
  losses: netPnl > 0 ? 1 : netPnl < 0 ? 2 : 0,
  breakevens: netPnl === 0 ? 2 : 0,
  volume: 10,
});
const days = [100, -40, 0, 60, -20, 10, 20, 30].map((pnl, index) =>
  day(`2026-09-0${index + 1}`, pnl),
);

describe("calendar performance calculations", () => {
  it("reconciles totals with the calendar and distinguishes trade/day denominators", () => {
    const calendar = calendarMonthFromDays(days, 2026, 9);
    const i = calendarInsights(calendar);
    expect(i.netPnl).toBe(calendar.monthNetPnl);
    expect(i.trades).toBe(calendar.monthTrades);
    expect(i.tradingDays).toBe(calendar.tradingDays);
    expect(i).toMatchObject({
      netPnl: 160,
      trades: 16,
      tradingDays: 8,
      wins: 5,
      losses: 9,
      breakevens: 2,
      avgDailyPnl: 20,
      avgGreenDay: 44,
      avgRedDay: -30,
      greenDays: 5,
      redDays: 2,
      flatDays: 1,
      winRate: 5 / 16,
      profitableDayRate: 5 / 8,
    });
    expect(i.bestDay?.date).toBe("2026-09-01");
    expect(i.worstDay?.date).toBe("2026-09-02");
    expect(i.weekdays.reduce((sum, bucket) => sum + bucket.netPnl, 0)).toBe(i.netPnl);
    expect(i.weekdays.reduce((sum, bucket) => sum + bucket.trades, 0)).toBe(i.trades);
    expect(i.mostProfitableWeekday?.label).toBe("Tuesday");
    expect(i.trend.map((d) => d.average)).toEqual([null, null, null, null, 20, 2, 14, 20]);
  });
  it("does not pad trading-day averages with no-trade days or other months", () => {
    const i = calendarInsights(
      calendarMonthFromDays([day("2026-08-31", 10000), day("2026-09-04", 40)], 2026, 9),
    );
    expect(i.tradingDays).toBe(1);
    expect(i.avgDailyPnl).toBe(40);
    expect(i.bestDay).toEqual(i.worstDay);
    expect(i.avgRedDay).toBeNull();
  });
  it("returns null rates and extrema for empty selections", () => {
    const i = calendarInsights(calendarMonthFromDays([], 2026, 9));
    expect(i).toMatchObject({
      trades: 0,
      tradingDays: 0,
      avgDailyPnl: null,
      winRate: null,
      profitableDayRate: null,
      bestDay: null,
      worstDay: null,
      mostProfitableWeekday: null,
    });
  });
  it("handles all losing, all flat, and tied days honestly", () => {
    const loss = calendarInsights(
      calendarMonthFromDays([day("2026-09-01", -10), day("2026-09-02", -10)], 2026, 9),
    );
    expect(loss.mostProfitableWeekday).toBeNull();
    expect(loss.avgGreenDay).toBeNull();
    expect(loss.profitableDayRate).toBe(0);
    expect(loss.bestDay?.date).toBe("2026-09-01");
    const flat = calendarInsights(calendarMonthFromDays([day("2026-09-01", 0)], 2026, 9));
    expect(flat).toMatchObject({
      avgDailyPnl: 0,
      flatDays: 1,
      avgGreenDay: null,
      avgRedDay: null,
      profitableDayRate: 0,
    });
  });
});

describe("calendar scope and drill-down", () => {
  it("intersects month/range, including leap years and non-overlapping selections", () => {
    expect(
      calendarScope({ accounts: "a", from: "2024-02-10", to: "2024-03-10", tag: "plan" }, 2024, 2),
    ).toEqual({ accounts: "a", from: "2024-02-10", to: "2024-02-29", tag: "plan" });
    const empty = calendarScope({ from: "2026-10-01" }, 2026, 9);
    expect(empty.from > empty.to).toBe(true);
    expect(calendarScope({}, 2026, 12)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
  it("preserves account, outcomes and entry-weekday filters when linking a closing day", () => {
    const url = new URL(
      calendarTradeHref(
        "accounts=a&weekdays=1&tag=plan&status=win&range=7d",
        { from: "2026-09-01", to: "2026-09-30" },
        "2026-09-08",
      ),
      "http://localhost",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      accounts: "a",
      from: "2026-09-08",
      to: "2026-09-08",
      tag: "plan",
      status: "win",
      weekdays: "1",
      range: "custom",
    });
    expect(
      new URL(
        calendarTradeHref("", { from: "2026-09-01", to: "2026-09-30" }),
        "http://localhost",
      ).searchParams.get("status"),
    ).toBe("closed");
  });
  it("uses journal timezone and closing weekday across a month boundary, excluding open positions", () => {
    const base = buildRoundTrips([
      {
        id: "entry",
        accountId: "a",
        symbol: "TEST",
        side: "buy",
        quantity: 10,
        price: 10,
        fee: 2,
        executedAt: "2026-08-30T12:00:00Z",
        source: "manual",
      },
      {
        id: "exit",
        accountId: "a",
        symbol: "TEST",
        side: "sell",
        quantity: 10,
        price: 20,
        fee: 2,
        executedAt: "2026-09-01T00:30:00Z",
        source: "manual",
      },
    ])[0]!;
    const trades: AnnotatedTrade[] = [
      base,
      { ...base, key: "other", accountId: "b", netPnl: 500 },
      { ...base, key: "open", status: "open", closedAt: undefined, netPnl: 999 },
    ];
    const filters = calendarScope({ accounts: "a", symbol: "TEST", direction: "long" }, 2026, 8);
    const ny = trades.filter((t) => matchesFilters(t, filters, "America/New_York"));
    const i = calendarInsights(calendarMonthFromDays(dailyStats(ny, "America/New_York"), 2026, 8));
    expect(i).toMatchObject({ trades: 1, netPnl: 96 });
    expect(i.bestDay?.date).toBe("2026-08-31");
    expect(i.mostProfitableWeekday?.label).toBe("Monday");
    expect(
      calendarInsights(
        calendarMonthFromDays(
          dailyStats(
            trades.filter((t) => matchesFilters(t, filters, "UTC")),
            "UTC",
          ),
          2026,
          8,
        ),
      ).trades,
    ).toBe(0);
  });
});
