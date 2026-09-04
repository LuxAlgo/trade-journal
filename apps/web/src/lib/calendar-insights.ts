import {
  readFilters,
  type AnalysisFilters,
  type CalendarMonth,
  type DayStats,
} from "@luxalgo/journal-core";

export function calendarScope(filters: AnalysisFilters, year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${year}-${String(month).padStart(2, "0")}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
  return {
    ...filters,
    from: filters.from && filters.from > start ? filters.from : start,
    to: filters.to && filters.to < end ? filters.to : end,
  };
}

export const closingWeekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Calendar cells already contain filtered, timezone-bucketed CLOSED trades. */
export function calendarInsights(calendar: CalendarMonth) {
  const days = calendar.weeks
    .flatMap((week) => week.days)
    .filter((day): day is DayStats => day !== null && day.trades > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const green = days.filter((d) => d.netPnl > 0);
  const red = days.filter((d) => d.netPnl < 0);
  const trades = days.reduce((sum, d) => sum + d.trades, 0);
  const wins = days.reduce((sum, d) => sum + d.wins, 0);
  const losses = days.reduce((sum, d) => sum + d.losses, 0);
  const breakevens = days.reduce((sum, d) => sum + d.breakevens, 0);
  const netPnl = days.reduce((sum, d) => sum + d.netPnl, 0);
  const weekdays = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ].map((label, index) => {
    const matching = days.filter((day) => closingWeekday(day.date) === index);
    return {
      index,
      label,
      days: matching,
      trades: matching.reduce((sum, d) => sum + d.trades, 0),
      netPnl: matching.reduce((sum, d) => sum + d.netPnl, 0),
    };
  });
  const profitableWeekdays = weekdays
    .filter((d) => d.netPnl > 0)
    .sort((a, b) => b.netPnl - a.netPnl || a.index - b.index);
  return {
    days,
    trades,
    wins,
    losses,
    breakevens,
    netPnl,
    tradingDays: days.length,
    greenDays: green.length,
    redDays: red.length,
    flatDays: days.length - green.length - red.length,
    winRate: trades ? wins / trades : null,
    profitableDayRate: days.length ? green.length / days.length : null,
    avgDailyPnl: days.length ? netPnl / days.length : null,
    avgGreenDay: green.length ? green.reduce((sum, d) => sum + d.netPnl, 0) / green.length : null,
    avgRedDay: red.length ? red.reduce((sum, d) => sum + d.netPnl, 0) / red.length : null,
    // Stable tie rule: first chronological occurrence.
    bestDay: days.reduce<DayStats | null>(
      (best, day) => (!best || day.netPnl > best.netPnl ? day : best),
      null,
    ),
    worstDay: days.reduce<DayStats | null>(
      (worst, day) => (!worst || day.netPnl < worst.netPnl ? day : worst),
      null,
    ),
    weekdays,
    mostProfitableWeekday: profitableWeekdays[0] ?? null,
    trend: days.map((day, index) => ({
      ...day,
      average:
        index < 4
          ? null
          : days.slice(index - 4, index + 1).reduce((sum, d) => sum + d.netPnl, 0) / 5,
    })),
  };
}

export type CalendarInsights = ReturnType<typeof calendarInsights>;
export interface CalendarResponse {
  calendar: CalendarMonth;
  insights: CalendarInsights;
  timeZone: string;
  currencies: string[];
  scope: AnalysisFilters & { from: string; to: string };
}

/** Date drill-downs must not reuse the opening-weekday filter for closing days. */
export function calendarTradeHref(
  query: string,
  scope: { from: string; to: string },
  date?: string,
) {
  const filters = readFilters(new URLSearchParams(query));
  const params = new URLSearchParams({
    ...filters,
    from: date ?? scope.from,
    to: date ?? scope.to,
    range: "custom",
    status: filters.status ?? "closed",
  });
  return `/trades?${params}`;
}
