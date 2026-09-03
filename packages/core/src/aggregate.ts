import type { AnnotatedTrade } from "./types";
import { dailyStats, type DayStats } from "./equity";
import { WEEKDAYS, dayKeyOf, hourOf, weekdayOf } from "./time";

export interface BucketStats {
  key: string;
  trades: number;
  netPnl: number;
  winRate: number | null;
  profitFactor: number | null;
  volume: number;
}

const bucketStats = (key: string, trades: AnnotatedTrade[]): BucketStats => {
  // A bucket needs totals, not an equity curve, timezone conversion or streaks.
  let closed = 0,
    wins = 0,
    netPnl = 0,
    profit = 0,
    loss = 0,
    volume = 0;
  for (const trade of trades) {
    volume += trade.quantity;
    if (trade.status === "open") continue;
    closed++;
    if (trade.status === "win") wins++;
    netPnl += trade.netPnl;
    profit += Math.max(0, trade.netPnl);
    loss -= Math.min(0, trade.netPnl);
  }
  return {
    key,
    trades: trades.length,
    netPnl,
    winRate: closed ? wins / closed : null,
    profitFactor: loss > 0 ? profit / loss : null,
    volume,
  };
};

const groupInto = (
  trades: AnnotatedTrade[],
  keysOf: (trade: AnnotatedTrade) => string[],
): BucketStats[] => {
  const groups = new Map<string, AnnotatedTrade[]>();
  for (const trade of trades) {
    for (const key of keysOf(trade)) {
      const group = groups.get(key);
      if (group) group.push(trade);
      else groups.set(key, [trade]);
    }
  }
  return [...groups.entries()]
    .map(([key, group]) => bucketStats(key, group))
    .sort((a, b) => b.netPnl - a.netPnl);
};

export const bySymbol = (trades: AnnotatedTrade[]): BucketStats[] =>
  groupInto(trades, (t) => [t.symbol]);

export const byTag = (trades: AnnotatedTrade[]): BucketStats[] =>
  groupInto(trades, (t) => t.annotations?.tags ?? []);

export const byMistake = (trades: AnnotatedTrade[]): BucketStats[] =>
  groupInto(trades, (t) => t.annotations?.mistakes ?? []);

export const byPlaybook = (trades: AnnotatedTrade[]): BucketStats[] =>
  groupInto(trades, (t) => (t.annotations?.playbook ? [t.annotations.playbook] : []));

export const byAssetClass = (trades: AnnotatedTrade[]): BucketStats[] =>
  groupInto(trades, (t) => [t.assetClass ?? "other"]);

export const byDirection = (trades: AnnotatedTrade[]): BucketStats[] =>
  groupInto(trades, (t) => [t.direction]);

/** Performance by weekday of trade open, ordered Sun→Sat. */
export const byWeekday = (trades: AnnotatedTrade[], timeZone = "UTC"): BucketStats[] => {
  const buckets = groupInto(trades, (t) => [weekdayOf(t.openedAt, timeZone)]);
  return [...buckets].sort(
    (a, b) =>
      WEEKDAYS.indexOf(a.key as (typeof WEEKDAYS)[number]) -
      WEEKDAYS.indexOf(b.key as (typeof WEEKDAYS)[number]),
  );
};

/** Performance by hour of trade open ("09", "10", …), ordered by hour. */
export const byHour = (trades: AnnotatedTrade[], timeZone = "UTC"): BucketStats[] =>
  groupInto(trades, (t) => [String(hourOf(t.openedAt, timeZone)).padStart(2, "0")]).sort((a, b) =>
    a.key.localeCompare(b.key),
  );

export const DURATION_BUCKETS = [
  { key: "< 1m", maxMs: 60_000 },
  { key: "1-5m", maxMs: 300_000 },
  { key: "5-15m", maxMs: 900_000 },
  { key: "15-60m", maxMs: 3_600_000 },
  { key: "1-4h", maxMs: 14_400_000 },
  { key: "4-24h", maxMs: 86_400_000 },
  { key: "> 1d", maxMs: Number.POSITIVE_INFINITY },
] as const;

/** Performance by holding time, in the fixed bucket order. */
export const byDuration = (trades: AnnotatedTrade[]): BucketStats[] => {
  const buckets = groupInto(
    trades.filter((t) => t.durationMs !== undefined),
    (t) => [DURATION_BUCKETS.find((b) => t.durationMs! < b.maxMs)!.key],
  );
  return [...buckets].sort(
    (a, b) =>
      DURATION_BUCKETS.findIndex((d) => d.key === a.key) -
      DURATION_BUCKETS.findIndex((d) => d.key === b.key),
  );
};

export const byMonth = (trades: AnnotatedTrade[], timeZone = "UTC"): BucketStats[] =>
  groupInto(
    trades.filter((t) => t.closedAt),
    (t) => [dayKeyOf(t.closedAt!, timeZone).slice(0, 7)],
  ).sort((a, b) => a.key.localeCompare(b.key));

export interface CalendarWeek {
  /** Seven cells Sun→Sat; null = day outside the month or no trading. */
  days: (DayStats | null)[];
  weekNetPnl: number;
  weekTrades: number;
}

export interface CalendarMonth {
  year: number;
  /** 1-12. */
  month: number;
  weeks: CalendarWeek[];
  monthNetPnl: number;
  monthTrades: number;
  tradingDays: number;
  winningDays: number;
}

/** The P&L calendar: month grid with weekly and monthly totals. */
export const calendarMonth = (
  trades: AnnotatedTrade[],
  year: number,
  month: number,
  timeZone = "UTC",
): CalendarMonth => calendarMonthFromDays(dailyStats(trades, timeZone), year, month);

/** Reuse already-computed daily totals when rendering an overview. */
export const calendarMonthFromDays = (
  dayStats: DayStats[],
  year: number,
  month: number,
): CalendarMonth => {
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  const days = new Map(
    dayStats.filter((d) => d.date.startsWith(monthPrefix)).map((d) => [d.date, d]),
  );

  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leadingBlanks = first.getUTCDay();

  const cells: (DayStats | null)[] = Array.from({ length: leadingBlanks }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${monthPrefix}-${String(day).padStart(2, "0")}`;
    cells.push(
      days.get(date) ?? {
        date,
        netPnl: 0,
        grossPnl: 0,
        fees: 0,
        trades: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        volume: 0,
      },
    );
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: CalendarWeek[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const weekDays = cells.slice(i, i + 7);
    weeks.push({
      days: weekDays,
      weekNetPnl: weekDays.reduce((total, d) => total + (d?.netPnl ?? 0), 0),
      weekTrades: weekDays.reduce((total, d) => total + (d?.trades ?? 0), 0),
    });
  }

  const traded = [...days.values()];
  return {
    year,
    month,
    weeks,
    monthNetPnl: traded.reduce((total, d) => total + d.netPnl, 0),
    monthTrades: traded.reduce((total, d) => total + d.trades, 0),
    tradingDays: traded.filter((d) => d.trades > 0).length,
    winningDays: traded.filter((d) => d.netPnl > 0).length,
  };
};
