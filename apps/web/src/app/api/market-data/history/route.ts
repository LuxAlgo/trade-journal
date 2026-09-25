import { bad, handler, ok, requireValue } from "@/server/api";
import { connectionKey, providerFor } from "@/server/market-data/connections";
import { csvDatasets } from "@/server/market-data/csv";
import { MarketDataError, type MarketDataProvider } from "@/server/market-data/provider";
import { RESOLUTIONS, isResolution, type MarketHistory, type Resolution } from "@/lib/market-data";
import { maxSpanMs } from "@/lib/chart-analysis";

const MAX_LIMIT = 5_000;
/** Closed sessions (nights, weekends, holidays) hold no candles: widen by this much, a few times. */
const WIDEN = 4;
const MAX_ATTEMPTS = 4;

type Source = {
  provider: MarketDataProvider;
  symbol: string;
  dataset?: string;
  resolution: Resolution;
  signal: AbortSignal;
};

const fetchWindow = (r: Source, from: number, to: number) =>
  r.provider.history(
    {
      symbol: r.symbol,
      dataset: r.dataset,
      resolution: r.resolution,
      from,
      to,
      signal: r.signal,
    },
    connectionKey(r.provider.id),
  );

/**
 * The latest `limit` candles at or before `to`. The first window assumes continuous
 * trading; when it comes back short, it widens so a Monday-morning or after-hours chart
 * still shows the last sessions. A candle file ends where its data ends, so it is read
 * back from its own last candle.
 */
async function latestCandles(r: Source, to: number, limit: number): Promise<MarketHistory> {
  const step = RESOLUTIONS[r.resolution];
  if (r.provider.id === "market-csv") {
    const files = csvDatasets().filter(
      (d) =>
        d.symbol === r.symbol &&
        d.resolution === r.resolution &&
        (!r.dataset || d.id === r.dataset),
    );
    const end = Math.max(...files.map((d) => Date.parse(d.to)));
    if (Number.isFinite(end)) to = Math.min(to, end);
  }
  let span = limit * step;
  let history: MarketHistory | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    span = Math.min(span, maxSpanMs(r.resolution));
    history = await fetchWindow(r, to - span, to);
    if (history.bars.length >= limit || span >= maxSpanMs(r.resolution)) break;
    span *= WIDEN;
  }
  const bars = history!.bars.filter((b) => b.time <= to).slice(-limit);
  return { ...history!, bars };
}

/**
 * Candles for a symbol, independent of any trade: an explicit `from`/`to` window, or the
 * latest `limit` candles up to `to`. Only an open chart asks; results are not stored.
 */
export const POST = handler(async (request: Request) => {
  const body = await request.json();
  requireValue(body && typeof body.provider === "string", "Choose a market data provider.");
  let provider: MarketDataProvider;
  try {
    provider = providerFor(body.provider);
  } catch {
    return bad("Choose an available market data provider.");
  }
  requireValue(
    typeof body.symbol === "string" &&
      body.symbol.trim().length > 0 &&
      body.symbol.length <= 100 &&
      !/[\x00-\x1f]/.test(body.symbol),
    "Enter the provider's exact instrument symbol.",
  );
  requireValue(
    body.dataset === undefined ||
      body.dataset === null ||
      (typeof body.dataset === "string" && /^[a-zA-Z0-9_-]{0,80}$/.test(body.dataset)),
    "Invalid dataset.",
  );
  requireValue(isResolution(body.resolution), "Choose a supported candle resolution.");
  const resolution = body.resolution as Resolution;
  const { from, to, limit } = body as { from: unknown; to: unknown; limit: unknown };
  requireValue(Number.isSafeInteger(to), "Choose the end of the history window.");
  const end = Math.min(to as number, Date.now());
  const r: Source = {
    provider,
    symbol: body.symbol.trim(),
    dataset: body.dataset || undefined,
    resolution,
    signal: request.signal,
  };
  try {
    if (limit !== undefined) {
      requireValue(
        Number.isSafeInteger(limit) && (limit as number) > 0 && (limit as number) <= MAX_LIMIT,
        `Request between 1 and ${MAX_LIMIT} candles.`,
      );
      return ok(await latestCandles(r, end, limit as number));
    }
    requireValue(
      Number.isSafeInteger(from) && (from as number) < (to as number),
      "Choose a start date before the end date.",
    );
    requireValue((from as number) < Date.now(), "Choose a start date in the past.");
    requireValue(
      (to as number) - (from as number) <= maxSpanMs(resolution),
      "That range holds more than 20,000 candles. Shorten it or choose a coarser resolution.",
    );
    return ok(await fetchWindow(r, from as number, end));
  } catch (error) {
    if (error instanceof MarketDataError) return bad(error.message, 502);
    throw error;
  }
});
