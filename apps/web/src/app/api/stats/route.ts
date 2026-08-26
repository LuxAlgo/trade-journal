import {
  byDirection,
  byDuration,
  byHour,
  byMistake,
  byPlaybook,
  bySymbol,
  byTag,
  byWeekday,
  calendarMonth,
  computeEdgeScore,
  computeMetrics,
  dailyCumulative,
  dailyStats,
  equityCurve,
} from "@luxalgo/journal-core";
import { asc } from "drizzle-orm";
import { accounts, db } from "@/db";
import { handler, ok } from "@/server/api";
import { getTimeZone } from "@/server/settings";
import { queryTrades, type TradeFilters } from "@/server/trades-query";

/** The entire dashboard in one request. */
export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const timeZone = url.searchParams.get("tz") ?? getTimeZone();
  const filters: TradeFilters = {
    accountIds: url.searchParams.get("accounts")?.split(",").filter(Boolean),
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  };

  const { trades } = queryTrades(filters);
  const accountRows = db.select().from(accounts).orderBy(asc(accounts.createdAt)).all();
  const selected =
    filters.accountIds && filters.accountIds.length > 0
      ? accountRows.filter((a) => filters.accountIds!.includes(a.id))
      : accountRows;
  const initialBalance = selected.reduce((total, a) => total + a.initialBalance, 0);

  const metrics = computeMetrics(trades, { timeZone, initialBalance });

  const now = new Date();
  const calendarYear = Number(url.searchParams.get("calYear") ?? now.getUTCFullYear());
  const calendarMonthNum = Number(url.searchParams.get("calMonth") ?? now.getUTCMonth() + 1);

  return ok({
    metrics,
    edgeScore: computeEdgeScore(metrics),
    days: dailyStats(trades, timeZone),
    dailyCumulative: dailyCumulative(trades, timeZone),
    equity: equityCurve(trades),
    calendar: calendarMonth(trades, calendarYear, calendarMonthNum, timeZone),
    buckets: {
      symbol: bySymbol(trades).slice(0, 20),
      tag: byTag(trades),
      mistake: byMistake(trades),
      playbook: byPlaybook(trades),
      weekday: byWeekday(trades, timeZone),
      hour: byHour(trades, timeZone),
      duration: byDuration(trades),
      direction: byDirection(trades),
    },
    openPositions: trades
      .filter((t) => t.status === "open")
      .map((t) => ({
        key: t.key,
        symbol: t.symbol,
        direction: t.direction,
        openedAt: t.openedAt,
        quantity: t.openQuantity,
        avgEntry: t.avgEntry,
      })),
    recentTrades: [...trades]
      .filter((t) => t.status !== "open")
      .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))
      .slice(0, 10)
      .map((t) => ({
        key: t.key,
        symbol: t.symbol,
        closedAt: t.closedAt,
        netPnl: t.netPnl,
        status: t.status,
      })),
    initialBalance,
  });
});
