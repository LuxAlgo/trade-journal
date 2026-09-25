import type { BarRange, DataProvider, OHLCV } from "@luxalgo/vela";
import { RESOLUTIONS, isResolution, type MarketBar, type Resolution } from "./market-data";
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
}

/**
 * A Vela data provider for one journal market-data connection. Candles come from the
 * journal server, which holds the credentials; the browser never contacts the provider.
 * Live updates poll at `LIVE_POLL_MS`, pause while the tab is hidden or the user pauses,
 * and resume with an immediate refresh.
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

  private latest(bars: OHLCV[], timeframe: string) {
    const bar = bars.at(-1);
    if (bar) this.lastTime.set(timeframe, Math.max(this.lastTime.get(timeframe) ?? 0, bar.time));
    if (bar) this.hooks.onLatest?.({ bar, previousClose: bars.at(-2)?.close ?? null });
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
    if (!paused) this.wakers.forEach((wake) => wake());
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
    const schedule = (ms = LIVE_POLL_MS[resolution]) => {
      if (timer) clearTimeout(timer);
      if (!stopped) timer = setTimeout(() => void poll(), ms);
    };
    const poll = async () => {
      if (stopped || running) return;
      if (this.paused || (typeof document !== "undefined" && document.hidden)) {
        schedule();
        return;
      }
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
          for (const bar of bars) onBar(bar);
          this.latest(bars, timeframe);
          this.onStatus({ state: "live", updatedAt: Date.now() });
        }
      } catch (error) {
        if (!stopped)
          this.onStatus({
            state: "error",
            message: error instanceof Error ? error.message : "Live update failed.",
          });
      } finally {
        running = false;
        schedule();
      }
    };
    const wake = () => schedule(0);
    const onVisible = () => {
      if (!document.hidden) wake();
    };
    this.wakers.add(wake);
    document.addEventListener("visibilitychange", onVisible);
    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
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
