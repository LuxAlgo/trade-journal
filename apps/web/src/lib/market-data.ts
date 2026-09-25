/** Provider-neutral candles. Time is the UTC bar-open timestamp in milliseconds. */
export interface MarketBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Candle sizes, smallest first (menus list them in this order). */
export const RESOLUTIONS = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
} as const;
export type Resolution = keyof typeof RESOLUTIONS;
export const isResolution = (value: unknown): value is Resolution =>
  typeof value === "string" && Object.hasOwn(RESOLUTIONS, value);

/**
 * Sizes every source serves directly. The others are built from a finer size by
 * `aggregateBars`, unless an adapter declares them native (Binance).
 */
export const BASE_RESOLUTIONS: readonly Resolution[] = ["1m", "5m", "15m", "1h", "1d"];
export const AGGREGATE_FROM: Partial<Record<Resolution, Resolution>> = {
  "3m": "1m",
  "30m": "15m",
  "2h": "1h",
  "4h": "1h",
  "1w": "1d",
};

/** 1970-01-01 was a Thursday; weeks open on Monday 00:00 UTC, four days later. */
const WEEK_OFFSET = 4 * 86_400_000;

/** Open time of the candle containing `time`: UTC-aligned, weeks from Monday. */
export function bucketStart(time: number, resolution: Resolution): number {
  const step = RESOLUTIONS[resolution];
  const offset = resolution === "1w" ? WEEK_OFFSET : 0;
  return Math.floor((time - offset) / step) * step + offset;
}

/**
 * Combine ascending finer candles into `resolution` candles: first open, highest high,
 * lowest low, last close, summed volume. The newest bucket may still be forming.
 */
export function aggregateBars(bars: readonly MarketBar[], resolution: Resolution): MarketBar[] {
  const out: MarketBar[] = [];
  for (const bar of bars) {
    const time = bucketStart(bar.time, resolution);
    const last = out.at(-1);
    if (last && last.time === time) {
      last.high = Math.max(last.high, bar.high);
      last.low = Math.min(last.low, bar.low);
      last.close = bar.close;
      last.volume += bar.volume;
    } else out.push({ ...bar, time });
  }
  return out;
}

export interface MarketConnection {
  id: string;
  name: string;
  configured: boolean;
  source: "environment" | "saved" | "public" | "uploaded" | null;
}

export interface MarketHistory {
  quoteCurrency?: string;
  datasetId?: string;
  provider: string;
  symbol: string;
  resolution: Resolution;
  bars: MarketBar[];
  fetchedAt: string;
  truncated: boolean;
  warnings: string[];
}

export interface ExcursionEstimate {
  priceBasisMismatch?: boolean;
  mae: number | null;
  mfe: number | null;
  sampledBars: number;
  excludedBars: number;
  warnings: string[];
}

export interface TradeMarketResult extends MarketHistory {
  estimate: ExcursionEstimate;
}
