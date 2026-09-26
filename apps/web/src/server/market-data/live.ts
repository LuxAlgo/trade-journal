import type { Resolution } from "@/lib/market-data";
import type { LiveMessage, LiveTrade } from "@/lib/live-market";
import { MarketDataError } from "./provider";

/**
 * Real-time prices for an open chart. The server holds one upstream WebSocket per
 * instrument (shared by every open chart on it) and forwards its updates; the browser
 * only talks to the journal. Sources without a public stream keep polling.
 *
 * - Binance: aggregate trades as they happen, plus the kline stream (the forming candle
 *   itself, about every 2 s), which keeps the candle's OHLCV authoritative.
 * - Coinbase: the matches channel, every trade.
 *
 * Trades go out in batches at most 4 times a second.
 */
const BINANCE_WS = "wss://data-stream.binance.vision/stream";
const COINBASE_WS = "wss://ws-feed.exchange.coinbase.com";
const BATCH_MS = 250;
/** Keep an idle upstream open briefly so a reload or candle-size switch reuses it. */
const LINGER_MS = 5_000;
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

interface Upstream {
  url: string;
  /** Sent once connected (Coinbase subscribes by message). */
  hello?: string;
  /**
   * Turn one upstream message into trades or a candle (with the time it reflects trades up
   * to); throws MarketDataError on a fatal reply.
   */
  parse(
    data: unknown,
  ): { trades?: LiveTrade[]; bar?: LiveMessage & { kind: "bar" }; asOf?: number } | null;
}

/** The socket the feeds use; replaced in tests. */
export const liveSockets = {
  connect: (url: string): WebSocket => new WebSocket(url),
};

const num = (value: unknown) => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export function parseBinanceKline(data: unknown): (LiveMessage & { kind: "bar" }) | null {
  const k = (data as { e?: unknown; k?: Record<string, unknown> } | null)?.k;
  if ((data as { e?: unknown } | null)?.e !== "kline" || !k) return null;
  const [time, open, high, low, close, volume] = [k.t, k.o, k.h, k.l, k.c, k.v].map(num);
  if ([time, open, high, low, close, volume].some((v) => v === null)) return null;
  return {
    kind: "bar",
    bar: { time: time!, open: open!, high: high!, low: low!, close: close!, volume: volume! },
  };
}

/** Binance aggTrade: price and quantity of trades filled at one price. */
export function parseBinanceTrade(data: unknown): LiveTrade | null {
  const t = data as Record<string, unknown> | null;
  if (t?.e !== "aggTrade") return null;
  const time = num(t.T);
  const price = num(t.p);
  const size = num(t.q);
  return time === null || price === null || size === null ? null : [time, price, size];
}

export function parseCoinbaseMatch(data: unknown): LiveTrade | null {
  const m = data as Record<string, unknown> | null;
  if (!m || (m.type !== "match" && m.type !== "last_match")) return null;
  const time = Date.parse(typeof m.time === "string" ? m.time : "");
  const price = num(m.price);
  const size = num(m.size);
  if (!Number.isFinite(time) || price === null || size === null) return null;
  return [time, price, size];
}

/** Which upstream serves a chart, or null when the source has no public stream. */
export function upstreamFor(
  provider: string,
  symbol: string,
  resolution: Resolution,
): (Upstream & { key: string }) | null {
  if (provider === "binance") {
    if (!/^[A-Z0-9]{4,30}$/.test(symbol))
      throw new MarketDataError("Use a Binance spot symbol such as BTCUSDT.");
    // Every journal candle size is a native Binance kline interval.
    const name = symbol.toLowerCase();
    return {
      key: `binance|${symbol}|${resolution}`,
      url: `${BINANCE_WS}?streams=${name}@aggTrade/${name}@kline_${resolution}`,
      parse: (wrapped) => {
        // Combined streams wrap each message as { stream, data }.
        const data = (wrapped as { data?: unknown } | null)?.data;
        const trade = parseBinanceTrade(data);
        if (trade) return { trades: [trade] };
        const bar = parseBinanceKline(data);
        const asOf = num((data as { E?: unknown } | null)?.E);
        return bar ? { bar, asOf: asOf ?? undefined } : null;
      },
    };
  }
  if (provider === "coinbase") {
    if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(symbol))
      throw new MarketDataError("Use a Coinbase product such as BTC-USD.");
    // Trades do not depend on the candle size, so every chart of the product shares one feed.
    return {
      key: `coinbase|${symbol}`,
      url: COINBASE_WS,
      hello: JSON.stringify({ type: "subscribe", product_ids: [symbol], channels: ["matches"] }),
      parse: (data) => {
        const m = data as { type?: unknown; message?: unknown } | null;
        if (m?.type === "error")
          throw new MarketDataError(
            `Coinbase refused the live feed${typeof m.message === "string" ? `: ${m.message.slice(0, 120)}` : ""}.`,
          );
        const trade = parseCoinbaseMatch(data);
        return trade ? { trades: [trade] } : null;
      },
    };
  }
  return null;
}

export type LiveListener = (message: LiveMessage) => void;

class Feed {
  private readonly listeners = new Set<LiveListener>();
  private socket: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;
  private batch: LiveTrade[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private state: LiveMessage = { kind: "status", state: "connecting" };
  private closed = false;

  constructor(
    private readonly upstream: Upstream,
    private readonly onEmpty: () => void,
  ) {}

  add(listener: LiveListener) {
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
    this.listeners.add(listener);
    listener(this.state);
    if (!this.socket && !this.retryTimer && !this.closed) this.connect();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.lingerTimer = setTimeout(() => this.close(), LINGER_MS);
    };
  }

  private send(message: LiveMessage) {
    if (message.kind === "status") this.state = message;
    for (const listener of this.listeners) listener(message);
  }

  private flush = () => {
    this.batchTimer = null;
    if (!this.batch.length) return;
    const trades = this.batch;
    this.batch = [];
    this.send({ kind: "trades", trades });
  };

  private connect() {
    let socket: WebSocket;
    try {
      socket = liveSockets.connect(this.upstream.url);
    } catch {
      this.retry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.upstream.hello) socket.send(this.upstream.hello);
      this.attempt = 0;
      this.send({ kind: "status", state: "live" });
    };
    socket.onmessage = (event) => {
      let data: unknown;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }
      try {
        const parsed = this.upstream.parse(data);
        if (parsed?.bar) {
          // The candle already includes trades up to its event time; drop those still
          // waiting in the batch so they are not counted twice, and send the rest after it.
          const asOf = parsed.asOf ?? Infinity;
          this.batch = this.batch.filter(([time]) => time > asOf);
          this.send(parsed.bar);
        }
        if (parsed?.trades?.length) {
          this.batch.push(...parsed.trades);
          this.batchTimer ??= setTimeout(this.flush, BATCH_MS);
        }
      } catch (error) {
        // A refused subscription (unknown product) will not heal by reconnecting.
        this.send({
          kind: "status",
          state: "error",
          message: error instanceof MarketDataError ? error.message : "The live feed failed.",
        });
        this.closed = true;
        socket.close();
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.flush();
      if (!this.closed && this.listeners.size) this.retry();
    };
    socket.onerror = () => {
      // onclose follows and schedules the reconnect.
    };
  }

  private retry() {
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!;
    this.attempt += 1;
    this.send({ kind: "status", state: "reconnecting" });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.closed && this.listeners.size) this.connect();
    }, delay);
  }

  close() {
    this.closed = true;
    for (const timer of [this.retryTimer, this.lingerTimer, this.batchTimer])
      if (timer) clearTimeout(timer);
    this.socket?.close();
    this.socket = null;
    this.onEmpty();
  }
}

const feeds = new Map<string, Feed>();

/**
 * Listen to an instrument's live updates; returns the unsubscribe function, or null when
 * the source has no stream (the chart keeps polling).
 */
export function listenLive(
  provider: string,
  symbol: string,
  resolution: Resolution,
  listener: LiveListener,
): (() => void) | null {
  const upstream = upstreamFor(provider, symbol, resolution);
  if (!upstream) return null;
  let feed = feeds.get(upstream.key);
  if (!feed) {
    const created = new Feed(upstream, () => {
      if (feeds.get(upstream.key) === created) feeds.delete(upstream.key);
    });
    feeds.set(upstream.key, created);
    feed = created;
  }
  return feed.add(listener);
}

/** Open upstream connections, for tests. */
export const liveFeedCount = () => feeds.size;
