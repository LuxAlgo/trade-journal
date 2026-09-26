import type { BarRange, DataProvider, OHLCV } from "@luxalgo/vela";
import {
  RESOLUTIONS,
  bucketStart,
  isResolution,
  type MarketBar,
  type Resolution,
} from "./market-data";
import { VELA_TIMEFRAME } from "./chart-analysis";

/**
 * How often a live chart asks for new candles. Slower than Vela's 3-second default: every
 * poll is a request to the user's provider plan, so the pace follows the candle size.
 */
export const LIVE_POLL_MS: Record<Resolution, number> = {
  "1m": 15_000,
  "3m": 20_000,
  "5m": 30_000,
  "15m": 60_000,
  "30m": 60_000,
  "1h": 120_000,
  "2h": 120_000,
  "4h": 180_000,
  "1d": 300_000,
  "1w": 600_000,
};

/** Sources the server streams in real time (`/api/market-data/stream`); others poll. */
export const STREAMING_PROVIDERS: ReadonlySet<string> = new Set(["binance", "coinbase"]);
/** With a stream open, polling only reconciles finished candles, so it can be slow. */
export const RECONCILE_POLL_MS = 60_000;
/** Price header and alerts follow the stream at most this often (the chart itself every update). */
export const LIVE_PUBLISH_MS = 500;

/** One trade: time (epoch ms), price, size. */
export type LiveTrade = [time: number, price: number, size: number];

/** What the stream route sends: its connection state, a forming candle, or trades. */
export type LiveMessage =
  | { kind: "status"; state: "connecting" | "live" | "reconnecting" | "error"; message?: string }
  | { kind: "bar"; bar: OHLCV }
  | { kind: "trades"; trades: LiveTrade[] };

/** The candle being formed and the close before it. */
export interface FormingBar {
  bar: OHLCV | null;
  previousClose: number | null;
}

/**
 * Apply a streamed update to the forming candle; returns the candles that changed, in
 * time order, for the chart. A new bucket starts a new candle at the trade's price.
 * Trades are ignored until the forming candle is known (its open comes from history),
 * and anything older than it is left to polling, which reconciles finished candles.
 */
export function applyLive(
  forming: FormingBar,
  message: LiveMessage,
  resolution: Resolution,
): OHLCV[] {
  if (message.kind === "bar") {
    const bar = message.bar;
    if (forming.bar && bar.time < forming.bar.time) return [];
    if (forming.bar && bar.time > forming.bar.time) forming.previousClose = forming.bar.close;
    forming.bar = { ...bar };
    return [{ ...bar }];
  }
  if (message.kind !== "trades" || !forming.bar) return [];
  // The last state of each candle a trade touched, in time order.
  const changed = new Map<number, OHLCV>();
  for (const [time, price, size] of [...message.trades].sort((a, b) => a[0] - b[0])) {
    const current: OHLCV = forming.bar;
    const bucket = bucketStart(time, resolution);
    if (bucket < current.time) continue;
    if (bucket > current.time) {
      forming.previousClose = current.close;
      forming.bar = {
        time: bucket,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: size,
      };
    } else {
      current.high = Math.max(current.high, price);
      current.low = Math.min(current.low, price);
      current.close = price;
      current.volume = (current.volume ?? 0) + size;
    }
    changed.set(forming.bar.time, { ...forming.bar });
  }
  return [...changed.values()];
}

export const INITIAL_BARS = 500;
/** Deepest history a chart grows to by scrolling back, matching the adapters' cap. */
export const MAX_CHART_BARS = 20_000;
/** One request never asks for more than this; Vela pages deeper history in chunks. */
export const MAX_REQUEST_BARS = 5_000;

export const resolutionForTimeframe = (timeframe: string): Resolution | null =>
  (Object.entries(VELA_TIMEFRAME).find(([, tf]) => tf === timeframe)?.[0] as Resolution) ?? null;

/** Vela routes `name:TICKER`; names allow letters, digits, `_` and `.` only. */
export const velaProviderName = (id: string) => id.toLowerCase().replace(/[^a-z0-9_.]/g, "_");

export type HistoryWindow = { from: number; to: number } | { to: number; limit: number };

/**
 * Translate a Vela bar request into the journal's history request: an explicit window
 * when Vela names one, otherwise "the latest `limit` candles up to `to`".
 */
export function historyWindow(range: BarRange, now = Date.now()): HistoryWindow {
  const to = Math.min(range.to ?? now, now);
  if (range.from != null) return { from: Math.min(range.from, to - 1), to };
  return { to, limit: Math.max(1, Math.min(range.limit ?? INITIAL_BARS, MAX_REQUEST_BARS)) };
}

/** The newest candle and the close before it (for the price header and line alerts). */
export interface LatestBar {
  bar: OHLCV;
  previousClose: number | null;
}

export interface LiveStatus {
  state: "loading" | "live" | "paused" | "idle" | "error";
  message?: string;
  updatedAt?: number;
  /** Prices arrive over the live stream rather than by polling. */
  realtime?: boolean;
}

/**
 * A Vela data provider for one journal market-data connection. Candles come from the
 * journal server, which holds the credentials; the browser never contacts the provider.
 * Streaming sources update in real time over `/api/market-data/stream`; the rest poll at
 * `LIVE_POLL_MS`. Both pause while the tab is hidden or the user pauses, and resume with an
 * immediate refresh.
 */
export class JournalMarketProvider implements DataProvider {
  private paused = false;
  private readonly wakers = new Set<() => void>();

  constructor(
    private readonly source: { provider: string; dataset?: string | null },
    private readonly hooks: {
      onStatus: (status: LiveStatus) => void;
      onLatest?: (latest: LatestBar) => void;
    },
  ) {}

  private onStatus(status: LiveStatus) {
    this.hooks.onStatus(status);
  }

  /** Newest candle time seen per timeframe, so a resumed poll fills the gap. */
  private readonly lastTime = new Map<string, number>();
  /** Newest candle and the close before it per timeframe, to seed the live stream. */
  private readonly recent = new Map<string, LatestBar>();

  private latest(bars: OHLCV[], timeframe: string) {
    const bar = bars.at(-1);
    if (!bar || bar.time < (this.recent.get(timeframe)?.bar.time ?? 0)) return;
    this.lastTime.set(timeframe, Math.max(this.lastTime.get(timeframe) ?? 0, bar.time));
    const latest = { bar, previousClose: bars.at(-2)?.close ?? null };
    this.recent.set(timeframe, latest);
    this.hooks.onLatest?.(latest);
  }

  info() {
    return {
      name: velaProviderName(this.source.provider),
      capabilities: { enumerate: false, stream: true, symbolInfo: false },
    };
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.onStatus({ state: paused ? "paused" : "live" });
    // Pausing closes the stream; resuming reopens it and polls for what was missed.
    this.wakers.forEach((wake) => wake());
  }

  isPaused() {
    return this.paused;
  }

  private async request(ticker: string, resolution: Resolution, window: HistoryWindow) {
    const response = await fetch("/api/market-data/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: this.source.provider,
        symbol: ticker,
        dataset: this.source.dataset || undefined,
        resolution,
        ...window,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      bars?: MarketBar[];
      error?: string;
    };
    if (!response.ok || !Array.isArray(body.bars))
      throw new HistoryError(
        body.error ?? `History request failed (${response.status}).`,
        response.ok ? 502 : response.status,
      );
    return body.bars as OHLCV[];
  }

  async getBars(ticker: string, timeframe: string, range: BarRange): Promise<OHLCV[]> {
    const resolution = resolutionForTimeframe(timeframe);
    if (!resolution) throw new Error(`Unsupported timeframe ${timeframe}.`);
    try {
      // Vela treats a failed load as "no candles" and would leave the chart blank, so a
      // brief upstream hiccup is retried before it is reported.
      const bars = await retry(() => this.request(ticker, resolution, historyWindow(range)));
      // A request with no end is "up to now": its last candle is the current price.
      if (range.to == null) this.latest(bars, timeframe);
      this.onStatus({ state: this.paused ? "paused" : "live", updatedAt: Date.now() });
      return bars;
    } catch (error) {
      this.onStatus({
        state: "error",
        message: error instanceof Error ? error.message : "History request failed.",
      });
      throw error;
    }
  }

  subscribe(ticker: string, timeframe: string, onBar: (bar: OHLCV) => void) {
    const resolution = resolutionForTimeframe(timeframe);
    if (!resolution || !isResolution(resolution)) return () => {};
    const step = RESOLUTIONS[resolution];
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    const hidden = () => typeof document !== "undefined" && document.hidden;

    // ── Real-time stream (Binance, Coinbase): the server relays the exchange's feed ──
    const forming: FormingBar = { bar: null, previousClose: null };
    let source: EventSource | null = null;
    let streaming = false;
    let publishTimer: ReturnType<typeof setTimeout> | null = null;
    let publishedAt = 0;
    const seed = () => {
      const recent = this.recent.get(timeframe);
      if (recent && (!forming.bar || recent.bar.time > forming.bar.time)) {
        forming.bar = { ...recent.bar };
        forming.previousClose = recent.previousClose;
      }
    };
    // React state (price header, alerts) follows at a bounded pace; the chart gets every update.
    const publish = () => {
      if (publishTimer || stopped) return;
      publishTimer = setTimeout(
        () => {
          publishTimer = null;
          publishedAt = Date.now();
          if (stopped || !forming.bar) return;
          const latest = { bar: { ...forming.bar }, previousClose: forming.previousClose };
          this.recent.set(timeframe, latest);
          this.hooks.onLatest?.(latest);
          this.onStatus({ state: "live", realtime: true, updatedAt: Date.now() });
        },
        Math.max(0, LIVE_PUBLISH_MS - (Date.now() - publishedAt)),
      );
    };
    const openStream = () => {
      if (source || stopped || typeof EventSource === "undefined") return;
      if (!STREAMING_PROVIDERS.has(this.source.provider)) return;
      const query = new URLSearchParams({
        provider: this.source.provider,
        symbol: ticker,
        resolution,
        ...(this.source.dataset ? { dataset: this.source.dataset } : {}),
      });
      const opened = new EventSource(`/api/market-data/stream?${query}`);
      source = opened;
      opened.onmessage = (event) => {
        let message: LiveMessage;
        try {
          message = JSON.parse(String(event.data)) as LiveMessage;
        } catch {
          return;
        }
        if (message.kind === "status") {
          const was = streaming;
          streaming = message.state === "live";
          if (was && !streaming) {
            // Dropped: poll now so nothing is missed while it reconnects.
            this.onStatus({ state: "live", updatedAt: Date.now() });
            schedule(0);
          }
          return;
        }
        seed();
        const bars = applyLive(forming, message, resolution);
        if (!bars.length) return;
        for (const bar of bars) onBar(bar);
        this.lastTime.set(
          timeframe,
          Math.max(this.lastTime.get(timeframe) ?? 0, bars.at(-1)!.time),
        );
        publish();
      };
      opened.onerror = () => {
        // A 204 (no stream) or an error response closes it for good; otherwise it retries.
        if (opened.readyState === EventSource.CLOSED && source === opened) source = null;
        if (streaming) schedule(0);
        streaming = false;
      };
    };
    const closeStream = () => {
      source?.close();
      source = null;
      streaming = false;
    };

    // ── Polling: the only source without a stream, and the reconciler with one ──
    const schedule = (ms = streaming ? RECONCILE_POLL_MS : LIVE_POLL_MS[resolution]) => {
      if (timer) clearTimeout(timer);
      if (!stopped) timer = setTimeout(() => void poll(), ms);
    };
    const poll = async () => {
      if (stopped || running) return;
      if (this.paused || hidden()) {
        closeStream();
        schedule(LIVE_POLL_MS[resolution]);
        return;
      }
      openStream();
      running = true;
      try {
        const now = Date.now();
        // From the last candle seen (covering a hidden tab or a pause), at least the forming
        // candle and the one before it, and never more than one request can hold.
        const from = Math.max(
          now - MAX_REQUEST_BARS * step,
          Math.min(this.lastTime.get(timeframe) ?? now, now - 2 * step),
        );
        const bars = await this.request(ticker, resolution, { from, to: now });
        if (!stopped) {
          // Polled candles can lag the stream (the server caches recent data briefly), so
          // while streaming they only settle candles that are already finished.
          const cutoff = streaming && forming.bar ? forming.bar.time : Infinity;
          for (const bar of bars) if (bar.time < cutoff) onBar(bar);
          if (!streaming) {
            this.latest(bars, timeframe);
            seed();
            this.onStatus({ state: "live", updatedAt: Date.now() });
          }
        }
      } catch (error) {
        if (!stopped && !streaming)
          this.onStatus({
            state: "error",
            message: error instanceof Error ? error.message : "Live update failed.",
          });
      } finally {
        running = false;
        schedule();
      }
    };
    const wake = () => {
      if (this.paused) closeStream();
      schedule(0);
    };
    const onVisible = () => {
      if (document.hidden) closeStream();
      else wake();
    };
    this.wakers.add(wake);
    document.addEventListener("visibilitychange", onVisible);
    openStream();
    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (publishTimer) clearTimeout(publishTimer);
      closeStream();
      this.wakers.delete(wake);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }
}

const RETRY_DELAYS_MS = [800, 2500];

async function retry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      // Request errors (4xx: a bad symbol, a missing connection) will not heal by waiting.
      if (delay === undefined || (error instanceof HistoryError && error.status < 500)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

class HistoryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
