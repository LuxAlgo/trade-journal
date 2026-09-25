import {
  AGGREGATE_FROM,
  RESOLUTIONS,
  aggregateBars,
  bucketStart,
  type Resolution,
} from "@/lib/market-data";
import type { MarketDataProvider } from "./provider";

/**
 * Serve every candle size from any source: sizes the source doesn't offer are built from
 * a finer one it does (4h from 1h, 1w from 1d). `native` lists extra sizes the source
 * serves directly and aligned to UTC multiples, which adapters require.
 */
export function withAggregation(
  provider: MarketDataProvider,
  native: readonly Resolution[] = [],
): MarketDataProvider {
  return {
    ...provider,
    async history(request, apiKey) {
      const base = AGGREGATE_FROM[request.resolution];
      if (!base || native.includes(request.resolution)) return provider.history(request, apiKey);
      const step = RESOLUTIONS[request.resolution];
      // Start at the first bucket's open so its candle is complete.
      const history = await provider.history(
        { ...request, resolution: base, from: bucketStart(request.from, request.resolution) },
        apiKey,
      );
      const bars = aggregateBars(history.bars, request.resolution).filter(
        (bar) => bar.time + step > request.from && bar.time < request.to,
      );
      return {
        ...history,
        resolution: request.resolution,
        bars,
        warnings: [
          ...history.warnings,
          `${request.resolution} candles are built from ${base} candles, aligned to UTC${request.resolution === "1w" ? " weeks from Monday" : ""}.`,
        ],
      };
    },
  };
}
