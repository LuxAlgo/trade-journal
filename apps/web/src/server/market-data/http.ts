import { RESOLUTIONS, type MarketBar, type MarketHistory } from "@/lib/market-data";
import { MarketDataError, type HistoryRequest } from "./provider";
import { marketTransport } from "./transport";

export const MAX_BARS = 20_000;
export const MAX_PAGES = 80;
export const number = (v: unknown) =>
  typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
export function validateBars(bars: MarketBar[]): MarketBar[] {
  const unique = new Map<number, MarketBar>();
  for (const bar of bars) {
    if (
      !Object.values(bar).every(Number.isFinite) ||
      !Number.isSafeInteger(bar.time) ||
      bar.time < 0 ||
      bar.volume < 0 ||
      bar.low > Math.min(bar.open, bar.close) ||
      bar.high < Math.max(bar.open, bar.close) ||
      bar.low > bar.high
    )
      throw new MarketDataError("Invalid OHLCV candle. Estimates were not calculated.");
    const prior = unique.get(bar.time);
    if (prior && JSON.stringify(prior) !== JSON.stringify(bar))
      throw new MarketDataError("Conflicting candles at the same timestamp.");
    unique.set(bar.time, bar);
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}
export const boundedSignal = (signal?: AbortSignal) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000);
export async function readJson(
  url: string,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
  options: { cache?: boolean; timeoutMs?: number } = {},
): Promise<unknown> {
  try {
    return await marketTransport.read(url, headers, signal, options);
  } catch (error) {
    if (error instanceof MarketDataError) throw error;
    throw new MarketDataError("Market data request failed or timed out. Try again.");
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new MarketDataError("Unexpected market data response.");
  return value as Record<string, unknown>;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new MarketDataError("Unexpected market data candle list.");
  return value;
}
export function credentials(key: string): Record<string, string> {
  try {
    return record(JSON.parse(key)) as Record<string, string>;
  } catch {
    throw new MarketDataError("Save this provider's credentials again in Settings.");
  }
}
export function result(
  name: string,
  request: HistoryRequest,
  bars: MarketBar[],
  truncated: boolean,
  warnings: string[],
  quoteCurrency?: string,
): MarketHistory {
  const step = RESOLUTIONS[request.resolution];
  const now = Date.now();
  const rows = validateBars(bars).filter(
    (bar) =>
      bar.time < request.to &&
      bar.time + step > request.from &&
      (request.forming ? bar.time <= now : bar.time + step <= now),
  );
  return {
    provider: name,
    symbol: request.symbol,
    resolution: request.resolution,
    bars: rows.slice(0, MAX_BARS),
    fetchedAt: new Date().toISOString(),
    truncated: truncated || rows.length > MAX_BARS,
    quoteCurrency,
    warnings: [
      ...warnings,
      ...(truncated || rows.length > MAX_BARS
        ? [
            "History reached a request limit. Choose a coarser resolution; incomplete history cannot produce estimates.",
          ]
        : []),
    ],
  };
}

/** Fixed time windows below each API's candle cap, including empty sessions. */
export async function windows(
  request: HistoryRequest,
  size: number,
  read: (from: number, to: number, signal: AbortSignal) => Promise<MarketBar[]>,
) {
  const step = RESOLUTIONS[request.resolution];
  let cursor = Math.floor(request.from / step) * step;
  const end = Math.ceil(request.to / step) * step;
  const bars: MarketBar[] = [];
  const signal = boundedSignal(request.signal);
  let pages = 0;
  while (cursor < end && pages++ < MAX_PAGES && bars.length < MAX_BARS) {
    const to = Math.min(end, cursor + size * step);
    const rows = await read(cursor, to, signal);
    if (rows.some((bar) => bar.time % step !== 0))
      throw new MarketDataError("Provider returned candles at an unexpected resolution.");
    bars.push(...rows.filter((bar) => bar.time >= cursor && bar.time < to));
    cursor = to;
  }
  return { bars, truncated: cursor < end };
}
