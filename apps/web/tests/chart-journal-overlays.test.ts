import { describe, expect, it, vi } from "vitest";
import { aggregateBars, bucketStart, type MarketBar } from "../src/lib/market-data";
import { withAggregation } from "../src/server/market-data/aggregate";
import type { MarketDataProvider } from "../src/server/market-data/provider";
import { DEFAULT_TIMEFRAMES, parseTimeframes, toggleTimeframe } from "../src/lib/chart-timeframes";
import { matchKeys, matchingSymbols, symbolKey } from "../src/lib/symbol-match";
import { sessionEvents, zonedToUtc } from "../src/lib/market-sessions";
import {
  parseZones,
  zoneEvents,
  zoneFromClicks,
  zoneStats,
  zonesProblem,
  type SrZone,
} from "../src/lib/sr-zones";
import {
  DEFAULT_OVERLAYS,
  parseOverlayOptions,
  visibleTrades,
  type ChartTrade,
} from "../src/lib/chart-overlays";
import { currenciesFor } from "../src/lib/economic-calendar";
import { parseFeed } from "../src/server/economic-calendar";

const H = 3_600_000;
const bar = (time: number, o: number, h: number, l: number, c: number, v = 1): MarketBar => ({
  time,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: v,
});

describe("larger candle sizes are built from finer candles", () => {
  it("four 1h candles make one 4h candle aligned to UTC", () => {
    const start = Date.parse("2026-09-01T00:00:00Z");
    const hours = [
      bar(start, 10, 12, 9, 11),
      bar(start + H, 11, 15, 10, 14),
      bar(start + 2 * H, 14, 14, 8, 9),
      bar(start + 3 * H, 9, 10, 9, 10),
      bar(start + 4 * H, 10, 11, 10, 11),
    ];
    expect(aggregateBars(hours, "4h")).toEqual([
      bar(start, 10, 15, 8, 10, 4),
      bar(start + 4 * H, 10, 11, 10, 11, 1),
    ]);
  });

  it("weeks start on Monday 00:00 UTC", () => {
    const wednesday = Date.parse("2026-09-02T15:00:00Z");
    expect(new Date(bucketStart(wednesday, "1w")).toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(new Date(bucketStart(wednesday, "4h")).toISOString()).toBe("2026-09-02T12:00:00.000Z");
  });

  it("a source without 4h candles serves them from its 1h candles", async () => {
    const start = Date.parse("2026-09-01T00:00:00Z");
    const history = vi.fn<MarketDataProvider["history"]>(async (request) => ({
      provider: "test",
      symbol: request.symbol,
      resolution: request.resolution,
      bars: Array.from({ length: 12 }, (_, i) => bar(start + i * H, i, i + 1, i - 1, i + 0.5)),
      fetchedAt: "2026-09-01T00:00:00Z",
      truncated: false,
      warnings: [],
    }));
    const provider = withAggregation({
      id: "test",
      name: "Test",
      environmentKey: "",
      history,
      test: async () => {},
    });
    const result = await provider.history(
      { symbol: "X", resolution: "4h", from: start + 5 * H, to: start + 12 * H },
      "",
    );
    // The request starts at the 4h bucket's open so the first candle is complete.
    expect(history.mock.calls[0]![0]).toMatchObject({ resolution: "1h", from: start + 4 * H });
    expect(result.resolution).toBe("4h");
    expect(result.bars.map((b) => b.time)).toEqual([start + 4 * H, start + 8 * H]);
    expect(result.bars[0]).toMatchObject({ open: 4, high: 8, low: 3, close: 7.5, volume: 4 });
    expect(result.warnings.at(-1)).toMatch(/built from 1h/);
  });

  it("sizes the source serves natively pass straight through", async () => {
    const history = vi.fn<MarketDataProvider["history"]>(async (request) => ({
      provider: "test",
      symbol: request.symbol,
      resolution: request.resolution,
      bars: [],
      fetchedAt: "2026-09-01T00:00:00Z",
      truncated: false,
      warnings: [],
    }));
    const provider = withAggregation(
      { id: "t", name: "T", environmentKey: "", history, test: async () => {} },
      ["4h"],
    );
    await provider.history({ symbol: "X", resolution: "4h", from: 0, to: H }, "");
    expect(history.mock.calls[0]![0].resolution).toBe("4h");
  });
});

describe("the timeframe bar shows the sizes you pick", () => {
  it("includes 4h by default", () => {
    expect(DEFAULT_TIMEFRAMES).toContain("4h");
    expect(parseTimeframes(null)).toEqual(DEFAULT_TIMEFRAMES);
  });

  it("keeps known sizes in size order and never ends up empty", () => {
    expect(parseTimeframes(JSON.stringify(["1d", "bogus", "3m"]))).toEqual(["3m", "1d"]);
    expect(parseTimeframes("not json")).toEqual(DEFAULT_TIMEFRAMES);
    expect(parseTimeframes("[]")).toEqual(DEFAULT_TIMEFRAMES);
    expect(toggleTimeframe(["1h"], "1h")).toEqual(["1h"]);
    expect(toggleTimeframe(["1h"], "2h")).toEqual(["1h", "2h"]);
  });
});

describe("chart symbols find the journal trades on the same instrument", () => {
  it("ignores exchange prefixes and separators", () => {
    expect(symbolKey("NASDAQ:AAPL")).toBe("AAPL");
    expect(symbolKey("eur_usd")).toBe("EURUSD");
  });

  it("treats dollar stablecoins as USD", () => {
    expect([...matchKeys("BTCUSDT")]).toEqual(
      expect.arrayContaining(["BTCUSDT", "BTCUSD", "BTCUSDC"]),
    );
    expect(matchingSymbols(["BTC/USD", "ETHUSD", "BTC-USDC"], "BTCUSDT")).toEqual([
      "BTC/USD",
      "BTC-USDC",
    ]);
  });

  it("adds symbols the user names by hand", () => {
    expect(matchingSymbols(["MESZ6", "ESZ6"], "ES1!", ["MESZ6"])).toEqual(["MESZ6"]);
  });
});

describe("market sessions open at local exchange time", () => {
  it("New York opens at 09:30 local across daylight saving", () => {
    expect(new Date(zonedToUtc(2026, 7, 1, 9, 30, "America/New_York")).toISOString()).toBe(
      "2026-07-01T13:30:00.000Z",
    );
    expect(new Date(zonedToUtc(2026, 12, 1, 9, 30, "America/New_York")).toISOString()).toBe(
      "2026-12-01T14:30:00.000Z",
    );
  });

  it("lists weekday opens and closes only", () => {
    // Saturday and Sunday 2026-09-05/06 in every zone.
    const weekend = sessionEvents(
      Date.parse("2026-09-05T12:00:00Z"),
      Date.parse("2026-09-06T12:00:00Z"),
    );
    expect(weekend).toEqual([]);
    const monday = sessionEvents(
      Date.parse("2026-09-07T00:00:00Z"),
      Date.parse("2026-09-07T23:59:00Z"),
    );
    const london = monday.find((e) => e.session === "london" && e.kind === "open");
    expect(new Date(london!.time).toISOString()).toBe("2026-09-07T07:00:00.000Z");
    expect(monday.map((e) => e.time)).toEqual([...monday.map((e) => e.time)].sort((a, b) => a - b));
  });
});

const zone = (patch: Partial<SrZone> = {}): SrZone => ({
  id: "z1",
  low: 100,
  high: 102,
  kind: "auto",
  label: "",
  start: 0,
  visible: true,
  ...patch,
});
const hl = (time: number, high: number, low: number, close: number) => ({
  time,
  high,
  low,
  close,
});

describe("support and resistance zones behave as price ranges", () => {
  it("price above the zone makes it support; wicks in and out count as touches", () => {
    const stats = zoneStats(zone(), [
      hl(1, 106, 104, 105),
      hl(2, 105, 101, 104), // wick into the zone, close above: a rejection
      hl(3, 106, 103, 105),
      hl(4, 105, 101.5, 103), // another rejection
    ]);
    expect(stats).toMatchObject({ role: "support", position: "above", touches: 2, breaks: 0 });
    expect(stats.status).toBe("holding");
  });

  it("a close through the zone breaks it and flips its role", () => {
    const stats = zoneStats(zone(), [
      hl(1, 106, 104, 105),
      hl(2, 105, 101, 101.5), // closes inside
      hl(3, 101, 97, 98), // leaves below: broken support, now resistance
    ]);
    expect(stats).toMatchObject({ role: "resistance", position: "below", breaks: 1 });
    expect(stats.status).toBe("broken");
  });

  it("a close inside the zone is a test, and a fixed role is kept", () => {
    const stats = zoneStats(zone({ kind: "resistance" }), [
      hl(1, 106, 104, 105),
      hl(2, 105, 100, 101),
    ]);
    expect(stats).toMatchObject({ role: "resistance", status: "testing", position: "inside" });
  });

  it("ignores candles before the zone was drawn", () => {
    expect(zoneStats(zone({ start: 3 }), [hl(1, 101, 97, 98), hl(3, 106, 104, 105)]).breaks).toBe(
      0,
    );
  });

  it("alerts on entering and on breaking, not on a rejection", () => {
    const origins = new Map<string, "above" | "below">();
    const zones = [zone()];
    expect(zoneEvents(zones, 105, 101, origins)).toEqual([
      { zoneId: "z1", kind: "enter", direction: "down" },
    ]);
    // Leaving the side it came from is a rejection: no alert.
    expect(zoneEvents(zones, 101, 104, origins)).toEqual([]);
    expect(zoneEvents(zones, 104, 101, origins)).toHaveLength(1);
    expect(zoneEvents(zones, 101, 98, origins)).toEqual([
      { zoneId: "z1", kind: "break", direction: "down" },
    ]);
    // A single candle straight through breaks it too.
    expect(zoneEvents(zones, 98, 105, origins)).toEqual([
      { zoneId: "z1", kind: "break", direction: "up" },
    ]);
    expect(zoneEvents([zone({ visible: false })], 105, 98, new Map())).toEqual([]);
  });

  it("two clicks make a band between them from the earlier click", () => {
    expect(zoneFromClicks("z", { time: 20, price: 110 }, { time: 10, price: 100 })).toMatchObject({
      low: 100,
      high: 110,
      start: 10,
      kind: "auto",
      visible: true,
    });
    const thin = zoneFromClicks("z", { time: 1, price: 100 }, { time: 2, price: 100 });
    expect(thin.high).toBeGreaterThan(thin.low);
  });

  it("stored zones are validated and bad documents load as none", () => {
    expect(zonesProblem([zone()])).toBeNull();
    expect(zonesProblem([zone({ low: 5, high: 4 })])).toMatch(/low below/);
    expect(zonesProblem([zone(), zone()])).toMatch(/invalid id/);
    expect(zonesProblem([zone({ kind: "box" as never })])).toMatch(/kind/);
    expect(parseZones("{")).toEqual([]);
    expect(parseZones(JSON.stringify([zone()]))).toEqual([zone()]);
  });
});

const trade = (key: string, status: ChartTrade["status"]): ChartTrade => ({
  key,
  account: "A",
  symbol: "X",
  direction: "long",
  status,
  openedAt: "2026-09-01T10:00:00Z",
  closedAt: status === "open" ? null : "2026-09-01T11:00:00Z",
  quantity: 1,
  openQuantity: status === "open" ? 1 : 0,
  avgEntry: 1,
  avgExit: null,
  netPnl: 0,
  currency: "USD",
  stopLoss: null,
  profitTarget: null,
  fills: [],
});

describe("chart overlay switches", () => {
  it("hides every trade, or only the closed ones", () => {
    const trades = [trade("open", "open"), trade("won", "win"), trade("lost", "loss")];
    expect(visibleTrades(trades, DEFAULT_OVERLAYS)).toHaveLength(3);
    expect(
      visibleTrades(trades, { ...DEFAULT_OVERLAYS, closedTrades: false }).map((t) => t.key),
    ).toEqual(["open"]);
    expect(visibleTrades(trades, { ...DEFAULT_OVERLAYS, trades: false })).toEqual([]);
  });

  it("restores saved switches and drops unknown values", () => {
    expect(parseOverlayOptions(null)).toEqual(DEFAULT_OVERLAYS);
    expect(
      parseOverlayOptions(
        JSON.stringify({
          missed: false,
          economicImpact: ["High", "Extreme"],
          economicCurrencies: ["USD", "usd", 3],
        }),
      ),
    ).toEqual({
      ...DEFAULT_OVERLAYS,
      missed: false,
      economicImpact: ["High"],
      economicCurrencies: ["USD"],
    });
  });
});

describe("economic calendar", () => {
  it("reads the weekly feed and skips malformed rows", () => {
    expect(
      parseFeed([
        {
          title: "Non-Farm Employment Change",
          country: "USD",
          date: "2026-09-04T08:30:00-04:00",
          impact: "High",
          forecast: "150K",
          previous: "142K",
        },
        {
          title: "Bank Holiday",
          country: "JPY",
          date: "2026-09-21T00:00:00+09:00",
          impact: "Holiday",
        },
        { title: "No date", country: "USD", date: "soon", impact: "High" },
        { title: "Bad impact", country: "USD", date: "2026-09-04T08:30:00-04:00", impact: "Huge" },
        null,
      ]),
    ).toEqual([
      {
        title: "Non-Farm Employment Change",
        currency: "USD",
        time: Date.parse("2026-09-04T12:30:00Z"),
        impact: "High",
        forecast: "150K",
        previous: "142K",
      },
      {
        title: "Bank Holiday",
        currency: "JPY",
        time: Date.parse("2026-09-20T15:00:00Z"),
        impact: "Holiday",
        forecast: "",
        previous: "",
      },
    ]);
    expect(() => parseFeed({ error: "rate limited" })).toThrow(/unexpected response/);
  });

  it("suggests the currencies that move a symbol", () => {
    expect(currenciesFor("EUR_USD")).toEqual(["EUR", "USD"]);
    expect(currenciesFor("BTCUSDT")).toEqual(["USD"]);
    expect(currenciesFor("AAPL")).toEqual(["USD"]);
  });
});
