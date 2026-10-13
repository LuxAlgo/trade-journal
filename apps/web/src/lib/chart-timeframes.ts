import { RESOLUTIONS, isResolution, type Resolution } from "./market-data";

/** The candle sizes shown on the chart's timeframe bar unless you pick others. */
export const DEFAULT_TIMEFRAMES: Resolution[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
const KEY = "journal-chart-timeframes-v1";

/** Known sizes only, in size order, never empty. */
export function parseTimeframes(raw: string | null): Resolution[] {
  if (!raw) return DEFAULT_TIMEFRAMES;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return DEFAULT_TIMEFRAMES;
    const picked = new Set(value.filter(isResolution));
    const ordered = (Object.keys(RESOLUTIONS) as Resolution[]).filter((r) => picked.has(r));
    return ordered.length ? ordered : DEFAULT_TIMEFRAMES;
  } catch {
    return DEFAULT_TIMEFRAMES;
  }
}

export const timeframePreference = {
  read(): Resolution[] {
    try {
      return parseTimeframes(localStorage.getItem(KEY));
    } catch {
      return DEFAULT_TIMEFRAMES;
    }
  },
  write(value: Resolution[]) {
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      // Per-page only.
    }
  },
};

/** Toggle one size, keeping at least one and the size order. */
export function toggleTimeframe(current: Resolution[], resolution: Resolution): Resolution[] {
  const next = current.includes(resolution)
    ? current.filter((r) => r !== resolution)
    : [...current, resolution];
  return next.length ? parseTimeframes(JSON.stringify(next)) : current;
}
