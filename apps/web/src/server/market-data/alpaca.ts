import { RESOLUTIONS } from "@/lib/market-data";
import type { MarketBar } from "@/lib/market-data";
import { MarketDataError, nativeInterval, type MarketDataProvider } from "./provider";
import {
  array,
  boundedSignal,
  credentials,
  MAX_BARS,
  MAX_PAGES,
  number,
  readJson,
  record,
  result,
  validateBars,
} from "./http";
const BASE = "https://data.alpaca.markets";
const headers = (key: string) => {
  const config = credentials(key);
  return { "APCA-API-KEY-ID": config.apiKey!, "APCA-API-SECRET-KEY": config.secretKey! };
};
export const alpaca: MarketDataProvider = {
  id: "alpaca",
  name: "Alpaca",
  environmentKey: "ALPACA_API_KEY",
  async test(key) {
    await readJson(`${BASE}/v2/stocks/AAPL/bars/latest?feed=iex`, headers(key), undefined, {
      cache: false,
    });
  },
  async history(request, key) {
    const crypto = request.dataset === "crypto";
    if (!request.dataset || !["iex", "sip", "crypto"].includes(request.dataset))
      throw new MarketDataError("Choose IEX, SIP or Crypto for Alpaca.");
    if (!(crypto ? /^[A-Z0-9]+\/[A-Z0-9]+$/ : /^[A-Z][A-Z0-9.-]{0,20}$/).test(request.symbol))
      throw new MarketDataError("Use AAPL for stocks, or BTC/USD with the Crypto dataset.");
    const step = RESOLUTIONS[request.resolution];
    const query = new URLSearchParams({
      timeframe: nativeInterval(
        { "1m": "1Min", "5m": "5Min", "15m": "15Min", "1h": "1Hour", "1d": "1Day" },
        request.resolution,
      ),
      start: new Date(Math.max(0, Math.floor(request.from / step) * step - step)).toISOString(),
      end: new Date(request.to).toISOString(),
      limit: "1000",
      sort: "asc",
    });
    if (crypto) query.set("symbols", request.symbol);
    else {
      query.set("feed", request.dataset);
      query.set("adjustment", "raw");
      query.set("asof", "-");
    }
    const path = crypto
      ? "/v1beta3/crypto/us/bars"
      : `/v2/stocks/${encodeURIComponent(request.symbol)}/bars`;
    const bars: MarketBar[] = [];
    let token: string | null = null;
    const seen = new Set<string>();
    const signal = boundedSignal(request.signal);
    for (let page = 0; page < MAX_PAGES && bars.length < MAX_BARS; page++) {
      if (token) query.set("page_token", token);
      const body = record(await readJson(`${BASE}${path}?${query}`, headers(key), signal));
      if (!Object.hasOwn(body, "bars")) throw new MarketDataError("Unexpected Alpaca response.");
      if (!crypto && body.symbol !== undefined && body.symbol !== request.symbol)
        throw new MarketDataError("Alpaca returned a different symbol.");
      const rows = crypto ? (record(body.bars)[request.symbol] ?? []) : (body.bars ?? []);
      bars.push(
        ...validateBars(
          array(rows).map((item) => {
            const row = record(item);
            return {
              time: Date.parse(String(row.t)),
              open: number(row.o),
              high: number(row.h),
              low: number(row.l),
              close: number(row.c),
              volume: number(row.v),
            };
          }),
        ),
      );
      token =
        body.next_page_token == null
          ? null
          : typeof body.next_page_token === "string"
            ? body.next_page_token
            : "";
      if (token === "" || (token && seen.has(token)))
        throw new MarketDataError("Alpaca returned an invalid pagination token.");
      if (!token) break;
      seen.add(token);
    }
    return result(
      this.name,
      request,
      bars,
      token !== null,
      [
        crypto
          ? "Alpaca US crypto candles; prices may differ from your execution venue."
          : `Alpaca ${request.dataset || "iex"} stock feed, unadjusted prices. IEX covers one exchange; feed coverage depends on your subscription.`,
      ],
      crypto ? request.symbol.split("/")[1] : "USD",
    );
  },
};
