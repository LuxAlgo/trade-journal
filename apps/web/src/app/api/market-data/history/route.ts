import { bad, handler, ok, requireValue } from "@/server/api";
import { connectionKey, providerFor } from "@/server/market-data/connections";
import { MarketDataError } from "@/server/market-data/provider";
import { isResolution } from "@/lib/market-data";
import { maxSpanMs } from "@/lib/chart-analysis";

/**
 * Candles for a symbol, independent of any trade. Only an explicit user action calls
 * this; the result is returned to the chart and never stored.
 */
export const POST = handler(async (request: Request) => {
  const body = await request.json();
  requireValue(body && typeof body.provider === "string", "Choose a market data provider.");
  let provider;
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
  const { from, to } = body as { from: unknown; to: unknown };
  requireValue(
    Number.isSafeInteger(from) && Number.isSafeInteger(to) && (from as number) < (to as number),
    "Choose a start date before the end date.",
  );
  requireValue((from as number) < Date.now(), "Choose a start date in the past.");
  requireValue(
    (to as number) - (from as number) <= maxSpanMs(body.resolution),
    "That range holds more than 20,000 candles. Shorten it or choose a coarser resolution.",
  );
  try {
    const history = await provider.history(
      {
        symbol: body.symbol.trim(),
        dataset: body.dataset || undefined,
        resolution: body.resolution,
        from: from as number,
        to: Math.min(to as number, Date.now()),
        signal: request.signal,
      },
      connectionKey(provider.id),
    );
    return ok(history);
  } catch (error) {
    if (error instanceof MarketDataError) return bad(error.message, 502);
    throw error;
  }
});
