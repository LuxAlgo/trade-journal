import { calendarMonthFromDays, dailyStats, dayKeyOf, readFilters } from "@luxalgo/journal-core";
import { accounts, db } from "@/db";
import { handler, ok, requireValue } from "@/server/api";
import { getTimeZone, getCurrencyConversion } from "@/server/settings";
import { currencyProjection } from "@/server/currency-conversion";
import { queryTrades } from "@/server/trades-query";
import { calendarInsights, calendarRunningPnl, calendarScope } from "@/lib/calendar-insights";

/** Only compute the visible month, not every dashboard/report breakdown. */
export const GET = handler(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const timeZone = getTimeZone();
  const today = dayKeyOf(new Date().toISOString(), timeZone);
  const year = Number(params.get("calYear") ?? today.slice(0, 4));
  const month = Number(params.get("calMonth") ?? today.slice(5, 7));
  requireValue(
    Number.isInteger(year) &&
      year >= 1900 &&
      year <= 9999 &&
      Number.isInteger(month) &&
      month >= 1 &&
      month <= 12,
    "Choose a valid calendar month.",
  );
  const scope = calendarScope(readFilters(params), year, month);
  const { trades: originalTrades } = queryTrades(scope);
  const selectedIds = scope.accounts?.split(",").map((id) => id.trim());
  const accountRows = db
    .select()
    .from(accounts)
    .all()
    .filter((account) => !selectedIds || selectedIds.includes(account.id));
  const { trades, scope: currencyScope } = currencyProjection(
    originalTrades,
    accountRows,
    getCurrencyConversion(),
  );
  const calendar = calendarMonthFromDays(dailyStats(trades, timeZone), year, month);
  const currencies = currencyScope.monetary
    ? [currencyScope.currency ?? "USD"]
    : currencyScope.sourceCurrencies;
  const currencyGroups = currencyScope.monetary
    ? []
    : currencyScope.sourceCurrencies.map((currency) => {
        const ids = new Set(
          accountRows
            .filter((account) => account.currency === currency)
            .map((account) => account.id),
        );
        const groupCalendar = calendarMonthFromDays(
          dailyStats(
            originalTrades.filter((trade) => ids.has(trade.accountId)),
            timeZone,
          ),
          year,
          month,
        );
        return { currency, calendar: groupCalendar };
      });
  return ok({
    calendar,
    currencyScope,
    currencyGroups,
    insights: calendarInsights(calendar),
    runningPnl: currencyScope.monetary ? calendarRunningPnl(trades, timeZone) : {},
    timeZone,
    currencies,
    scope,
  });
});
