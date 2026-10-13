/**
 * What kind of day a trading day was, from its candle: trending (closing far from its open)
 * or ranging, quiet or volatile against the days before it, and whether high-impact news
 * was scheduled. Computed, never typed in, so results can be split by day type honestly.
 */

export type DayShape = "trend-up" | "trend-down" | "range" | "mixed";
export type Volatility = "quiet" | "normal" | "volatile";

export interface DayContext {
  shape: DayShape;
  /** Null when there are no earlier days to compare with. */
  volatility: Volatility | null;
  /** Range as a multiple of the average range of the days before. */
  rangeRatio: number | null;
  /** High-impact events that day on the symbol's currencies. */
  news: string[];
}

export const SHAPE_LABELS: Record<DayShape, string> = {
  "trend-up": "Trend day up",
  "trend-down": "Trend day down",
  range: "Range day",
  mixed: "Mixed day",
};
export const VOLATILITY_LABELS: Record<Volatility, string> = {
  quiet: "Quiet",
  normal: "Normal volatility",
  volatile: "Volatile",
};

/** Close within this share of the range from the open reads as a range day; beyond, a trend. */
const RANGE_BODY = 0.3;
const TREND_BODY = 0.6;
const QUIET = 0.7;
const VOLATILE = 1.4;

export function dayContext(
  day: { open: number; high: number; low: number; close: number },
  averageRange: number | null,
  news: string[] = [],
): DayContext {
  const range = day.high - day.low;
  const body = day.close - day.open;
  const share = range > 0 ? Math.abs(body) / range : 0;
  const shape: DayShape =
    share >= TREND_BODY
      ? body > 0
        ? "trend-up"
        : "trend-down"
      : share <= RANGE_BODY
        ? "range"
        : "mixed";
  const rangeRatio = averageRange && averageRange > 0 ? range / averageRange : null;
  const volatility: Volatility | null =
    rangeRatio === null
      ? null
      : rangeRatio < QUIET
        ? "quiet"
        : rangeRatio > VOLATILE
          ? "volatile"
          : "normal";
  return { shape, volatility, rangeRatio, news };
}

/** The labels a day counts under in the day-type breakdown. */
export function contextTags(context: DayContext): string[] {
  return [
    SHAPE_LABELS[context.shape],
    ...(context.volatility ? [VOLATILITY_LABELS[context.volatility]] : []),
    context.news.length ? "High-impact news" : "No high-impact news",
  ];
}

export function describeContext(context: DayContext): string {
  const volatility = context.volatility
    ? `, ${VOLATILITY_LABELS[context.volatility].toLowerCase()} (${context.rangeRatio!.toFixed(2)}x the average range)`
    : "";
  const news = context.news.length
    ? `; high-impact news: ${context.news.join(", ")}`
    : "; no high-impact news scheduled";
  return `Day type: ${SHAPE_LABELS[context.shape].toLowerCase()}${volatility}${news}`;
}

/** Each day's average range: the mean range of the `window` days before it. */
export function trailingRanges(
  bars: readonly { high: number; low: number }[],
  window = 14,
): (number | null)[] {
  return bars.map((_, i) => {
    const earlier = bars.slice(Math.max(0, i - window), i);
    return earlier.length
      ? earlier.reduce((sum, b) => sum + (b.high - b.low), 0) / earlier.length
      : null;
  });
}

export interface DayTypeRow {
  tag: string;
  trades: number;
  wins: number;
  netPnl: number;
}

/**
 * Closed trades counted under each tag of the day they closed on. A trade whose day has no
 * context (no candles for its symbol) is left out.
 */
export function dayTypeStats(
  trades: { symbol: string; day: string; netPnl: number; status: string }[],
  contextOf: (symbol: string, day: string) => DayContext | undefined,
): DayTypeRow[] {
  const rows = new Map<string, DayTypeRow>();
  for (const trade of trades) {
    const context = contextOf(trade.symbol, trade.day);
    if (!context) continue;
    for (const tag of contextTags(context)) {
      const row = rows.get(tag) ?? { tag, trades: 0, wins: 0, netPnl: 0 };
      row.trades += 1;
      if (trade.status === "win") row.wins += 1;
      row.netPnl += trade.netPnl;
      rows.set(tag, row);
    }
  }
  const order = [
    ...Object.values(SHAPE_LABELS),
    ...Object.values(VOLATILITY_LABELS),
    "High-impact news",
    "No high-impact news",
  ];
  return [...rows.values()].sort((a, b) => order.indexOf(a.tag) - order.indexOf(b.tag));
}
