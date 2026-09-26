import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyLive, type FormingBar, type LiveMessage } from "../src/lib/live-market";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-realtime-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db } = await import("../src/db");
const { saveConnection } = await import("../src/server/market-data/connections");
const live = await import("../src/server/market-data/live");
const streamRoute = await import("../src/app/api/market-data/stream/route");

const M = 60_000;
const t0 = Date.parse("2026-09-26T10:00:00Z");
const bar = (time: number, o: number, h: number, l: number, c: number, v = 1) => ({
  time,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: v,
});

describe("streamed trades move the forming candle", () => {
  it("a trade in the forming minute updates its high, low, close and volume", () => {
    const forming: FormingBar = { bar: bar(t0, 100, 101, 99, 100, 5), previousClose: 98 };
    const changed = applyLive(
      forming,
      {
        kind: "trades",
        trades: [
          [t0 + 20_000, 102, 1],
          [t0 + 10_000, 98.5, 2],
        ],
      },
      "1m",
    );
    expect(changed).toEqual([bar(t0, 100, 102, 98.5, 102, 8)]);
    expect(forming.previousClose).toBe(98);
  });

  it("a trade in the next minute starts a new candle at its price", () => {
    const forming: FormingBar = { bar: bar(t0, 100, 101, 99, 100), previousClose: null };
    const changed = applyLive(
      forming,
      {
        kind: "trades",
        trades: [
          [t0 + 50_000, 100.5, 1],
          [t0 + M + 1_000, 103, 2],
        ],
      },
      "1m",
    );
    expect(changed).toEqual([bar(t0, 100, 101, 99, 100.5, 2), bar(t0 + M, 103, 103, 103, 103, 2)]);
    expect(forming.previousClose).toBe(100.5);
  });

  it("larger candles bucket trades the same way history does", () => {
    const forming: FormingBar = { bar: bar(t0 - 2 * 60 * M, 1, 1, 1, 1), previousClose: null };
    // 10:00 UTC is inside the 08:00 4h candle.
    applyLive(forming, { kind: "trades", trades: [[t0, 2, 1]] }, "4h");
    expect(forming.bar).toMatchObject({ time: t0 - 2 * 60 * M, close: 2, high: 2 });
  });

  it("waits for history before building candles, and ignores older trades", () => {
    const empty: FormingBar = { bar: null, previousClose: null };
    expect(applyLive(empty, { kind: "trades", trades: [[t0, 1, 1]] }, "1m")).toEqual([]);
    const forming: FormingBar = { bar: bar(t0, 100, 100, 100, 100), previousClose: null };
    expect(applyLive(forming, { kind: "trades", trades: [[t0 - 1, 50, 1]] }, "1m")).toEqual([]);
    expect(forming.bar!.low).toBe(100);
  });

  it("an exchange candle replaces the forming one, and a new one rolls it over", () => {
    const forming: FormingBar = { bar: bar(t0, 100, 101, 99, 100), previousClose: null };
    const message = (b: ReturnType<typeof bar>): LiveMessage => ({ kind: "bar", bar: b });
    expect(applyLive(forming, message(bar(t0, 100, 104, 99, 103, 9)), "1m")).toHaveLength(1);
    applyLive(forming, message(bar(t0 + M, 103, 103, 103, 103)), "1m");
    expect(forming).toMatchObject({ previousClose: 103, bar: { time: t0 + M } });
    expect(applyLive(forming, message(bar(t0, 1, 1, 1, 1)), "1m")).toEqual([]);
  });
});

describe("exchange messages", () => {
  it("reads Binance klines and aggregate trades", () => {
    expect(
      live.parseBinanceKline({
        e: "kline",
        E: t0 + 5,
        k: { t: t0, o: "1.5", h: "2", l: "1", c: "1.75", v: "10", x: false },
      }),
    ).toEqual({ kind: "bar", bar: bar(t0, 1.5, 2, 1, 1.75, 10) });
    expect(live.parseBinanceTrade({ e: "aggTrade", T: t0, p: "84000.5", q: "0.01" })).toEqual([
      t0,
      84000.5,
      0.01,
    ]);
    expect(live.parseBinanceKline({ e: "kline", k: { t: t0, o: "x" } })).toBeNull();
  });

  it("reads Coinbase matches and skips everything else", () => {
    expect(
      live.parseCoinbaseMatch({
        type: "match",
        time: "2026-09-26T10:00:00.5Z",
        price: "84000",
        size: "0.2",
      }),
    ).toEqual([t0 + 500, 84000, 0.2]);
    expect(live.parseCoinbaseMatch({ type: "subscriptions" })).toBeNull();
  });

  it("only exchanges with a public stream get one", () => {
    expect(live.upstreamFor("oanda", "EUR_USD", "1m")).toBeNull();
    expect(live.upstreamFor("binance", "BTCUSDT", "4h")?.url).toContain(
      "btcusdt@aggTrade/btcusdt@kline_4h",
    );
    expect(() => live.upstreamFor("coinbase", "BTCUSD", "1m")).toThrow(/BTC-USD/);
  });
});

/** A WebSocket stand-in the feed drives like the real one. */
class FakeSocket {
  static opened: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.opened.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
  open() {
    this.onopen?.();
  }
  push(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

const binanceTrade = (T: number, p: number) => ({
  data: { e: "aggTrade", T, p: String(p), q: "1" },
});
const binanceKline = (E: number, c: number) => ({
  data: { e: "kline", E, k: { t: t0, o: "1", h: "9", l: "1", c: String(c), v: "3" } },
});

describe("one upstream feed serves every chart on an instrument", () => {
  const original = live.liveSockets.connect;
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.opened = [];
    live.liveSockets.connect = (url) => new FakeSocket(url) as unknown as WebSocket;
  });
  afterEach(() => {
    vi.useRealTimers();
    live.liveSockets.connect = original;
  });

  it("shares the connection, batches trades and closes after the last chart leaves", () => {
    const a: LiveMessage[] = [];
    const b: LiveMessage[] = [];
    const offA = live.listenLive("coinbase", "BTC-USD", "1m", (m) => a.push(m))!;
    const offB = live.listenLive("coinbase", "BTC-USD", "5m", (m) => b.push(m))!;
    expect(FakeSocket.opened).toHaveLength(1);
    const socket = FakeSocket.opened[0]!;
    socket.open();
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ product_ids: ["BTC-USD"] });
    for (const price of [1, 2, 3])
      socket.push({ type: "match", time: new Date(t0).toISOString(), price, size: "1" });
    vi.advanceTimersByTime(300);
    expect(a.filter((m) => m.kind === "trades")).toEqual([
      {
        kind: "trades",
        trades: [
          [t0, 1, 1],
          [t0, 2, 1],
          [t0, 3, 1],
        ],
      },
    ]);
    expect(b.at(-1)).toEqual(a.at(-1));
    offA();
    offB();
    vi.advanceTimersByTime(6_000);
    expect(socket.closed).toBe(true);
    expect(live.liveFeedCount()).toBe(0);
  });

  it("reconnects with backoff after a drop", () => {
    const got: LiveMessage[] = [];
    const off = live.listenLive("binance", "BTCUSDT", "1m", (m) => got.push(m))!;
    FakeSocket.opened[0]!.open();
    FakeSocket.opened[0]!.onclose?.();
    expect(got.at(-1)).toEqual({ kind: "status", state: "reconnecting" });
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.opened).toHaveLength(2);
    FakeSocket.opened[1]!.open();
    expect(got.at(-1)).toEqual({ kind: "status", state: "live" });
    off();
    vi.advanceTimersByTime(6_000);
  });

  it("a Binance candle absorbs the trades it already counts", () => {
    const got: LiveMessage[] = [];
    const off = live.listenLive("binance", "ETHUSDT", "1m", (m) => got.push(m))!;
    const socket = FakeSocket.opened[0]!;
    socket.open();
    socket.push(binanceTrade(t0 + 1_000, 5));
    socket.push(binanceTrade(t0 + 3_000, 6));
    socket.push(binanceKline(t0 + 2_000, 5));
    vi.advanceTimersByTime(300);
    const data = got.filter((m) => m.kind !== "status");
    expect(data.map((m) => m.kind)).toEqual(["bar", "trades"]);
    expect(data[1]).toEqual({ kind: "trades", trades: [[t0 + 3_000, 6, 1]] });
    off();
    vi.advanceTimersByTime(6_000);
  });

  it("stops for good when the exchange refuses the product", () => {
    const got: LiveMessage[] = [];
    const off = live.listenLive("coinbase", "NOPE-USD", "1m", (m) => got.push(m))!;
    FakeSocket.opened[0]!.open();
    FakeSocket.opened[0]!.push({ type: "error", message: "Failed to subscribe" });
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.opened).toHaveLength(1);
    expect(got.at(-1)).toMatchObject({ kind: "status", state: "error" });
    off();
    vi.advanceTimersByTime(6_000);
  });
});

describe("the stream route", () => {
  const original = live.liveSockets.connect;
  const get = (query: string, signal?: AbortSignal) =>
    streamRoute.GET(new Request(`http://journal.test/api/market-data/stream?${query}`, { signal }));
  beforeEach(() => {
    vi.stubEnv("JOURNAL_PASSWORD", "");
    FakeSocket.opened = [];
    live.liveSockets.connect = (url) => new FakeSocket(url) as unknown as WebSocket;
  });
  afterEach(() => {
    live.liveSockets.connect = original;
    vi.unstubAllEnvs();
  });

  it("answers 204 for sources that only poll, so the browser does not retry", async () => {
    expect((await get("provider=market-csv&symbol=TEST&resolution=1m")).status).toBe(204);
  });

  it("requires the public source to be enabled", async () => {
    saveConnection("binance", null);
    const response = await get("provider=binance&symbol=BTCUSDT&resolution=1m");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Enable/);
    expect(FakeSocket.opened).toHaveLength(0);
  });

  it("streams the feed as server-sent events until the chart goes away", async () => {
    saveConnection("binance", "enabled");
    const abort = new AbortController();
    const response = await get("provider=binance&symbol=SOLUSDT&resolution=1m", abort.signal);
    expect(response.headers.get("Content-Type")).toMatch(/text\/event-stream/);
    expect(response.headers.get("Cache-Control")).toMatch(/no-transform/);
    const socket = FakeSocket.opened[0]!;
    socket.open();
    socket.push(binanceKline(t0, 7));
    const reader = response.body!.getReader();
    let text = "";
    while (!text.includes('"kind":"bar"'))
      text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain("retry: 3000");
    expect(text).toContain('"state":"live"');
    abort.abort();
    expect((await reader.read()).done).toBe(true);
  });
});

afterAll(() => {
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});
