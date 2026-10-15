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
  dayKeyOf,
} from "@luxalgo/journal-core";
import { asc } from "drizzle-orm";
import { accounts, db, playbooks } from "@/db";
import { calendarRunningPnl } from "@/lib/calendar-insights";
import { handler, ok } from "@/server/api";
import { getTimeZone, getCurrencyConversion } from "@/server/settings";
import { currencyProjection } from "@/server/currency-conversion";
import { queryTrades, type TradeFilters } from "@/server/trades-query";

/** The entire dashboard in one request. */
export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const timeZone = getTimeZone();
  const filters: TradeFilters = readFilters(url.searchParams);

  const { trades: originalTrades } = queryTrades(filters);
  const accountRows = db.select().from(accounts).orderBy(asc(accounts.createdAt)).all();
  const selected = filters.accounts
    ? accountRows.filter((a) =>
        filters
          .accounts!.split(",")
          .map((id) => id.trim())
          .includes(a.id),
      )
    : accountRows;
  const {
    trades,
    initialBalance,
    scope: currencyScope,
  } = currencyProjection(originalTrades, selected, getCurrencyConversion());

  const { metrics, days, equity } = computeOverview(trades, { timeZone, initialBalance });
  const accountCurrencies = new Map(accountRows.map((a) => [a.id, a.currency]));

  const today = dayKeyOf(new Date().toISOString(), timeZone);
  const calendarYear = Number(url.searchParams.get("calYear") ?? today.slice(0, 4));
  const calendarMonthNum = Number(url.searchParams.get("calMonth") ?? today.slice(5, 7));
  const calendarPrefix = `${calendarYear}-${String(calendarMonthNum).padStart(2, "0")}`;
  const calendarTrades = trades.filter(
    (trade) =>
      trade.status !== "open" &&
      trade.closedAt &&
      dayKeyOf(trade.closedAt, timeZone).startsWith(calendarPrefix),
  );
  return ok({
    timeZone,
    currencies: currencyScope.monetary
      ? [currencyScope.currency ?? "USD"]
      : currencyScope.sourceCurrencies,
    currencyScope,
    currencyGroups: currencyScope.monetary
      ? []
      : currencyScope.sourceCurrencies.map((currency) => {
          const groupAccounts = selected.filter((account) => account.currency === currency);
          const groupTrades = originalTrades.filter(
            (trade) => accountCurrencies.get(trade.accountId) === currency,
          );
          return {
            currency,
            metrics: computeOverview(groupTrades, {
              timeZone,
              initialBalance: groupAccounts.reduce(
                (sum, account) => sum + account.initialBalance,
                0,
              ),
            }).metrics,
          };
        }),
    accounts: accountRows.map((a) => ({ id: a.id, name: a.name })),
    playbooks: db.select({ id: playbooks.id, name: playbooks.name }).from(playbooks).all(),
    metrics: currencyScope.monetary ? metrics : null,
    edgeScore: currencyScope.monetary ? computeEdgeScore(metrics) : null,
    days,
    dailyCumulative: dailyCumulativeFromDays(days),
    equity,
    calendar: calendarMonthFromDays(days, calendarYear, calendarMonthNum),
    calendarCurrencies: currencyScope.monetary
      ? [currencyScope.currency ?? "USD"]
      : currencyScope.sourceCurrencies,
    runningPnl: currencyScope.monetary ? calendarRunningPnl(calendarTrades, timeZone) : {},
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
    openPositions: originalTrades
      .filter((t) => t.status === "open")
      .map((t) => ({
        key: t.key,
        symbol: t.symbol,
        direction: t.direction,
        openedAt: t.openedAt,
        quantity: t.openQuantity,
        avgEntry: t.avgEntry,
        currency: accountCurrencies.get(t.accountId) ?? "USD",
      })),
    recentTrades: [...(currencyScope.monetary ? trades : originalTrades)]
      .filter((t) => t.status !== "open")
      .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))
      .slice(0, 10)
      .map((t) => ({
        key: t.key,
        symbol: t.symbol,
        closedAt: t.closedAt,
        netPnl: t.netPnl,
        currency: currencyScope.monetary
          ? (currencyScope.currency ?? "USD")
          : (accountCurrencies.get(t.accountId) ?? "USD"),
        status: t.status,
      })),
    initialBalance,
  });
});
