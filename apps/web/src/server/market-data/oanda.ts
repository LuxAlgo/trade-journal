import { MarketDataError, nativeInterval, type MarketDataProvider } from "./provider";
import {
  array,
  credentials,
  number,
  readJson,
  record,
  result,
  validateBars,
  windows,
} from "./http";
const configFor = (key: string) => {
  const config = credentials(key);
  if (
    !["practice", "live"].includes(config.environment ?? "") ||
    !/^[0-9-]{3,80}$/.test(config.accountId ?? "")
  )
    throw new MarketDataError("Check your OANDA v20 account ID and environment.");
  return {
    base:
      config.environment === "live"
        ? "https://api-fxtrade.oanda.com"
        : "https://api-fxpractice.oanda.com",
    path: `/v3/accounts/${encodeURIComponent(config.accountId!)}/instruments`,
    headers: { Authorization: `Bearer ${config.apiKey}`, "Accept-Datetime-Format": "RFC3339" },
  };
};
export const oanda: MarketDataProvider = {
  id: "oanda",
  name: "OANDA",
  environmentKey: "OANDA_API_TOKEN",
  async test(key) {
    const c = configFor(key);
    await readJson(
      `${c.base}${c.path}/EUR_USD/candles?count=1&granularity=M1&price=M`,
      c.headers,
      undefined,
      { cache: false },
    );
  },
  async history(request, key) {
    if (!/^[A-Z0-9]+_[A-Z0-9]+$/.test(request.symbol))
      throw new MarketDataError("Use an OANDA instrument such as EUR_USD.");
    if (request.dataset)
      throw new MarketDataError("OANDA uses midpoint candles; leave the dataset blank.");
    const c = configFor(key);
    const granularity = nativeInterval(
      { "1m": "M1", "5m": "M5", "15m": "M15", "1h": "H1", "1d": "D" },
      request.resolution,
    );
    const history = await windows(request, 4999, async (from, to, signal) => {
      const query = new URLSearchParams({
        from: new Date(from).toISOString(),
        to: new Date(Math.min(to, Date.now())).toISOString(),
        granularity,
        price: "M",
        smooth: "false",
        includeFirst: "true",
        dailyAlignment: "0",
        alignmentTimezone: "UTC",
      });
      const body = record(
        await readJson(
          `${c.base}${c.path}/${encodeURIComponent(request.symbol)}/candles?${query}`,
          c.headers,
          signal,
        ),
      );
      if (body.instrument !== request.symbol || body.granularity !== granularity)
        throw new MarketDataError("OANDA returned a different instrument or resolution.");
      return validateBars(
        array(body.candles)
          .map(record)
          .filter((row) => row.complete === true)
          .map((row) => {
            const mid = record(row.mid);
            return {
              time: Date.parse(String(row.time)),
              open: number(mid.o),
              high: number(mid.h),
              low: number(mid.l),
              close: number(mid.c),
              volume: number(row.volume),
            };
          }),
      );
    });
    return result(
      this.name,
      request,
      history.bars,
      history.truncated,
      [
        "OANDA midpoint candles, aligned to UTC. Volume counts price updates, not traded units. Spread and currency conversion are excluded; set the multiplier to match your imported units.",
      ],
      request.symbol.split("_")[1],
    );
  },
};
