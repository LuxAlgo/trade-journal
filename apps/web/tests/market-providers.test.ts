import { createMarketTransport, marketTransport } from "../src/server/market-data/transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alpaca } from "../src/server/market-data/alpaca";
import { binance, coinbase } from "../src/server/market-data/public-crypto";
import { oanda } from "../src/server/market-data/oanda";
import { parseMarketCsv } from "../src/lib/market-csv";
import { MAX_PAGES, readJson } from "../src/server/market-data/http";
const from = Date.parse("2025-03-03T14:30:00Z");
const request = { from, to: from + 120000, symbol: "BTC-USD", resolution: "1m" as const };
const candle = { t: new Date(from).toISOString(), o: 100, h: 105, l: 95, c: 102, v: 1000 };
afterEach(() => vi.unstubAllGlobals());

describe("market data adapters", () => {
  it("requires an explicit Alpaca feed before requesting prices", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(alpaca.history({ ...request, symbol: "AAPL" }, "{}")).rejects.toThrow(
      "Choose IEX, SIP or Crypto",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("paginates Alpaca even when a page is short and keeps secrets in headers", async () => {
    const fetcher = vi
      .fn(async () => Response.json({ symbol: "AAPL", bars: [candle], next_page_token: "next" }))
      .mockImplementationOnce(async () =>
        Response.json({ symbol: "AAPL", bars: [candle], next_page_token: "next" }),
      )
      .mockImplementationOnce(async () =>
        Response.json({
          symbol: "AAPL",
          bars: [{ ...candle, t: new Date(from + 60000).toISOString() }],
          next_page_token: null,
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const data = await alpaca.history(
      { ...request, symbol: "AAPL", dataset: "iex" },
      JSON.stringify({ apiKey: "fixture-id", secretKey: "fixture-secret" }),
    );
    expect(data.bars).toHaveLength(2);
    expect(data.truncated).toBe(false);
    expect(data.quoteCurrency).toBe("USD");
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(calls[1]![0]).toContain("page_token=next");
    expect(calls[0]![0]).toContain("adjustment=raw");
    expect(calls[0]![1]).toMatchObject({
      redirect: "error",
      headers: { "APCA-API-SECRET-KEY": "fixture-secret" },
    });
    expect(calls.map((call) => call[0]).join()).not.toContain("fixture");
  });
  it("selects Alpaca crypto bars by exact symbol", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          bars: { "BTC/USD": [candle], "ETH/USD": [{ ...candle, o: 2 }] },
          next_page_token: null,
        }),
      ),
    );
    const data = await alpaca.history(
      { ...request, symbol: "BTC/USD", dataset: "crypto" },
      JSON.stringify({ apiKey: "fixture", secretKey: "secret" }),
    );
    expect(data.bars[0]!.open).toBe(100);
    expect(data.quoteCurrency).toBe("USD");
  });
  it("rejects repeating Alpaca page tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ bars: [], next_page_token: "same" })),
    );
    await expect(
      alpaca.history({ ...request, symbol: "AAPL", dataset: "iex" }, "{}"),
    ).rejects.toThrow("pagination");
  });
  it("normalizes Coinbase reverse order and paginates under 300 candles", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const start = Date.parse(new URL(url).searchParams.get("start")!);
      return Response.json([
        [start / 1000 + 60, 99, 105, 100, 104, 5],
        [start / 1000, 98, 102, 100, 101, 2],
      ]);
    });
    vi.stubGlobal("fetch", fetcher);
    const data = await coinbase.history({ ...request, to: from + 301 * 60000 }, "");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(data.bars).toHaveLength(4);
    expect(data.bars[0]).toMatchObject({ time: from, open: 100, high: 102, low: 98 });
    expect(data.quoteCurrency).toBe("USD");
    expect(data.truncated).toBe(false);
  });
  it("caps long history and marks it truncated instead of estimating from an unfinished request", async () => {
    const fetcher = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetcher);
    const data = await coinbase.history(
      { ...request, to: from + 60_000 * 299 * (MAX_PAGES + 1) },
      "",
    );
    expect(fetcher).toHaveBeenCalledTimes(MAX_PAGES);
    expect(data.truncated).toBe(true);
  });
  it("uses Binance's public data host and preserves the quote asset", async () => {
    const fetcher = vi.fn(async (url: string) =>
      Response.json(
        url.includes("exchangeInfo")
          ? { symbols: [{ symbol: "BTCUSDT", quoteAsset: "USDT" }] }
          : [[from, "100", "105", "95", "102", "4"]],
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const data = await binance.history({ ...request, symbol: "BTCUSDT" }, "");
    expect(data.quoteCurrency).toBe("USDT");
    expect(data.bars[0]!.time).toBe(from);
    expect(
      fetcher.mock.calls.every(([url]) => url.startsWith("https://data-api.binance.vision/")),
    ).toBe(true);
  });
  it("keeps the candle still forming only for a live chart, never for estimates", async () => {
    const now = Date.now();
    const minute = Math.floor(now / 60_000) * 60_000;
    const fetcher = vi.fn(async (url: string) =>
      Response.json(
        url.includes("exchangeInfo")
          ? { symbols: [{ symbol: "BTCUSDT", quoteAsset: "USDT" }] }
          : [
              [minute - 60_000, "100", "105", "95", "102", "4"],
              [minute, "102", "103", "101", "102.5", "1"],
            ],
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const window = { symbol: "BTCUSDT", resolution: "1m" as const, from: minute - 60_000, to: now };
    const finished = await binance.history(window, "");
    expect(finished.bars.map((b) => b.time)).toEqual([minute - 60_000]);
    const live = await binance.history({ ...window, forming: true }, "");
    expect(live.bars.map((b) => b.time)).toEqual([minute - 60_000, minute]);
    expect(live.bars.at(-1)).toMatchObject({ open: 102, close: 102.5, volume: 1 });
  });
  it("uses OANDA practice/live candle endpoints, midpoint prices and completed candles only", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        instrument: "EUR_USD",
        granularity: "M1",
        candles: [
          {
            complete: true,
            time: candle.t,
            mid: { o: "1.1", h: "1.2", l: "1.0", c: "1.15" },
            volume: 30,
          },
          { complete: false, time: new Date(from + 60000).toISOString() },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const data = await oanda.history(
      { ...request, symbol: "EUR_USD" },
      JSON.stringify({ apiKey: "fixture-token", accountId: "001-123", environment: "practice" }),
    );
    expect(data.bars).toHaveLength(1);
    expect(data.quoteCurrency).toBe("USD");
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toContain(
      "api-fxpractice.oanda.com/v3/accounts/001-123/instruments/EUR_USD/candles",
    );
    expect(calls[0]![0]).toContain("alignmentTimezone=UTC");
    expect(calls[0]![1].headers).toMatchObject({ Authorization: "Bearer fixture-token" });
  });
  it("does not relay upstream error bodies or credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("fixture-secret-token", { status: 403 })),
    );
    await expect(readJson("https://data.alpaca.markets/test")).rejects.toThrow("access denied");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fixture-secret-token");
      }),
    );
    await expect(readJson("https://data.alpaca.markets/test")).rejects.toThrow("timed out");
  });
});

describe("market CSV parser", () => {
  const header = "time,open,high,low,close,volume\n";
  it("normalizes timezone and epoch stamps, sorting without inventing bars", () => {
    const bars = parseMarketCsv(
      header + `1741012260,100,104,98,102,0\n2025-03-03T09:30:00-05:00,100,105,95,102,0`,
      "AAPL",
      "1m",
    );
    expect(bars).toHaveLength(2);
    expect(bars[0]!.time).toBe(from);
    expect(bars[1]!.time).toBe(from + 60000);
  });
  it("accepts missing volume and quoted numeric fields", () => {
    expect(
      parseMarketCsv(
        'timestamp,open,high,low,close\n1741012200000,"100",105,95,102',
        "AAPL",
        "1m",
      )[0]!.volume,
    ).toBe(0);
  });
  it.each([
    ["2025-03-03 14:30:00,100,105,95,102,0", "timezone"],
    ["2025-02-30T14:30:00Z,100,105,95,102,0", "calendar date"],
    ["1741012200,100,90,95,102,0", "OHLC"],
    ["1741012200,100,105,95,102,-1", "negative volume"],
    ["1741012200,100,105,95,102,0\n1741012200,100,105,95,102,0", "Duplicate"],
    ["1741012200,100,105,95,102,0\n1741012261,100,105,95,102,0", "resolution"],
  ])("rejects invalid CSV data (%s)", (rows, message) =>
    expect(() => parseMarketCsv(header + rows, "AAPL", "1m")).toThrow(message),
  );
  it("rejects mixed symbols and trade statements", () => {
    expect(() =>
      parseMarketCsv("symbol," + header + "MSFT,1741012200,100,105,95,102,0", "AAPL", "1m"),
    ).toThrow("symbol");
    expect(() =>
      parseMarketCsv("symbol,side,quantity,price,time\nAAPL,buy,10,100,1741012200", "AAPL", "1m"),
    ).toThrow("open");
  });
});

afterEach(() => marketTransport.clear());

beforeEach(() => Object.assign(marketTransport, createMarketTransport({ minIntervalMs: 0 })));
