import {
  readFilters,
  byDirection,
  byDuration,
  byHour,
  byMistake,
  byPlaybook,
  bySymbol,
  byTag,
  byWeekday,
  calendarMonthFromDays,
  computeEdgeScore,
  computeOverview,
  dailyCumulativeFromDays,
} from "@luxalgo/journal-core";
import { asc } from "drizzle-orm";
import { accounts, db, playbooks } from "@/db";
import { handler, ok } from "@/server/api";
import { getTimeZone } from "@/server/settings";
import { queryTrades, type TradeFilters } from "@/server/trades-query";

/** The entire dashboard in one request. */
export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const timeZone = getTimeZone();
  const filters: TradeFilters = readFilters(url.searchParams);

  const { trades } = queryTrades(filters);
  const accountRows = db.select().from(accounts).orderBy(asc(accounts.createdAt)).all();
  const selected = filters.accounts
    ? accountRows.filter((a) => filters.accounts!.split(",").includes(a.id))
    : accountRows;
  const initialBalance = selected.reduce((total, a) => total + a.initialBalance, 0);

  const { metrics, days, equity } = computeOverview(trades, { timeZone, initialBalance });
  const accountCurrencies = new Map(accountRows.map((a) => [a.id, a.currency]));

  const now = new Date();
  const calendarYear = Number(url.searchParams.get("calYear") ?? now.getUTCFullYear());
  const calendarMonthNum = Number(url.searchParams.get("calMonth") ?? now.getUTCMonth() + 1);

  return ok({
    timeZone,
    currencies: [...new Set(trades.map((t) => accountCurrencies.get(t.accountId) ?? "USD"))],
    accounts: accountRows.map((a) => ({ id: a.id, name: a.name })),
    playbooks: db.select({ id: playbooks.id, name: playbooks.name }).from(playbooks).all(),
    metrics,
    edgeScore: computeEdgeScore(metrics),
    days,
    dailyCumulative: dailyCumulativeFromDays(days),
    equity,
    calendar: calendarMonthFromDays(days, calendarYear, calendarMonthNum),
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
