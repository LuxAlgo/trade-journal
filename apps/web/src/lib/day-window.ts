import { RESOLUTIONS, type MarketBar, type Resolution } from "./market-data";
import { zonedToUtc } from "./market-sessions";

/**
 * A journal day in UTC, and which daily candles belong to it or come before it. Daily
 * candles are stamped at their own midnight (UTC for most sources, the exchange's for some),
 * not at the journal's, so they are matched by the time they cover, never by their stamp
 * alone.
 */

export const DAY_MS = 86_400_000;

/** A journal day's start and end in UTC, in the journal's time zone. */
export function dayWindow(day: string, timeZone: string) {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const from = zonedToUtc(year, month, date, 0, 0, timeZone);
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  const to = zonedToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    0,
    0,
    timeZone,
  );
  return { from, to };
}

/**
 * The candles of `resolution` that describe the window: every intraday candle that opens in
 * it, or for daily candles the one whose middle falls in it (a UTC-midnight candle is the
 * journal day with most of its hours in common). Nothing for weekly candles, which cannot
 * describe a single day.
 */
export function barsOfDay(
  bars: readonly MarketBar[],
  resolution: Resolution,
  window: { from: number; to: number },
): MarketBar[] {
  const step = RESOLUTIONS[resolution];
  if (step > DAY_MS) return [];
  const at = step === DAY_MS ? DAY_MS / 2 : 0;
  return bars.filter((bar) => bar.time + at >= window.from && bar.time + at < window.to);
}

/**
 * The last `count` daily candles that had closed by `from`, so an average of earlier days
 * never includes the day itself (for a journal west of UTC, the day's own UTC candle opens
 * before its local midnight).
 */
export function dailyBarsBefore(
  bars: readonly MarketBar[],
  from: number,
  count: number,
): MarketBar[] {
  return bars.filter((bar) => bar.time + DAY_MS <= from).slice(-count);
}
