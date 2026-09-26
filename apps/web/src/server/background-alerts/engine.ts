import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { chartAnalyses } from "@/db";
import { RESOLUTIONS, type Resolution } from "@/lib/market-data";
import { LIVE_POLL_MS, STREAMING_PROVIDERS, type LiveMessage } from "@/lib/live-market";
import { ALERT_TYPES, lineCrossings, type AlertLine } from "@/lib/price-alerts";
import { zoneEvents, type SrZone } from "@/lib/sr-zones";
import { drawingName, effectiveLayer, layerOf } from "@/lib/chart-layers";
import { analysisEditPath, drawingLabel } from "@/lib/chart-analysis";
import { lineAlert, zoneAlert, type AlertMessage } from "@/lib/alert-messages";
import { getAnalysis } from "../chart-analyses";
import { listenLive } from "../market-data/live";
import { connectionKey, providerFor } from "../market-data/connections";
import { newId, nowIso } from "../ids";
import { alertEvents, alertWatches, alertsDb } from "./store";
import { deliver, type AlertNotification } from "./delivery";

/**
 * Background alerts: the server keeps watching the line and zone alerts of analyses you
 * switched on, whether or not any page is open, and notifies your browsers. Prices come
 * from the same shared exchange feeds the live chart uses (Binance, Coinbase) or, for
 * other sources, a poll at the chart's own pace. Indicator `alert()` calls run in the
 * browser and are not watched here.
 *
 * It reads analyses as the journal saves them and notices edits on its own (every few
 * seconds), so the journal's save path needs no hooks.
 */
export const MAX_WATCHES = 25;
const COOLDOWN_MS = 60_000;
const CHECK_MS = 5_000;
const KEEP_EVENTS = 200;

export type WatchState = "starting" | "live" | "polling" | "reconnecting" | "error";

interface Rules {
  analysisId: string;
  symbol: string;
  provider: string;
  dataset: string | null;
  resolution: Resolution;
  lines: (AlertLine & { label: string })[];
  zones: SrZone[];
}

interface Watch extends Rules {
  source: string;
  version: string;
  last: { time: number; close: number } | null;
  origins: Map<string, "above" | "below">;
  alertedAt: Map<string, number>;
  state: WatchState;
  error: string | null;
  stop: () => void;
}

export interface AlertEngineDeps {
  listen: typeof listenLive;
  /** The newest candle for a polled source, or null. */
  latest: (rules: Rules, signal: AbortSignal) => Promise<{ time: number; close: number } | null>;
  deliver: (notification: AlertNotification) => Promise<number>;
  now: () => number;
}

const defaultLatest: AlertEngineDeps["latest"] = async (rules, signal) => {
  const step = RESOLUTIONS[rules.resolution];
  const now = Date.now();
  const history = await providerFor(rules.provider).history(
    {
      symbol: rules.symbol,
      dataset: rules.dataset ?? undefined,
      resolution: rules.resolution,
      from: now - 3 * step,
      to: now,
      signal,
    },
    connectionKey(rules.provider),
  );
  const bar = history.bars.at(-1);
  return bar ? { time: bar.time, close: bar.close } : null;
};

// ── Which analyses are watched ──

export const isWatched = (analysisId: string) =>
  Boolean(
    alertsDb().select().from(alertWatches).where(eq(alertWatches.analysisId, analysisId)).get(),
  );

export function setWatched(analysisId: string, watched: boolean) {
  const db = alertsDb();
  if (watched)
    db.insert(alertWatches).values({ analysisId, createdAt: nowIso() }).onConflictDoNothing().run();
  else db.delete(alertWatches).where(eq(alertWatches.analysisId, analysisId)).run();
  runningAlertEngine()?.check();
}

/** What to watch for an analysis, or null when it has nothing to watch. */
export function rulesFor(analysisId: string): Rules | null {
  const analysis = getAnalysis(analysisId);
  if (!analysis) return null;
  const layers = analysis.layers;
  // Hidden drawings and hidden layers never alert, as on the chart.
  const lines = analysis.drawings.drawings
    .filter(
      (d) =>
        ALERT_TYPES.has(d.type) &&
        d.visible !== false &&
        effectiveLayer(layers, layerOf(layers, d.id)).visible,
    )
    .map((d) => ({
      id: d.id,
      type: d.type,
      anchors: d.anchors,
      label:
        drawingName(layers, d.id) ??
        drawingLabel(d.type, (d.text as { value?: string } | undefined)?.value),
    }));
  const zones = analysis.zones.filter((z) => z.visible);
  if (!lines.length && !zones.length) return null;
  return {
    analysisId,
    symbol: analysis.symbol,
    provider: analysis.provider,
    dataset: analysis.dataset,
    resolution: analysis.resolution,
    lines,
    zones,
  };
}

export class AlertEngine {
  private readonly watches = new Map<string, Watch>();
  /** Analyses switched on, with the save stamp last read. */
  private readonly seen = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly deps: AlertEngineDeps;

  constructor(deps: Partial<AlertEngineDeps> = {}) {
    this.deps = { listen: listenLive, latest: defaultLatest, deliver, now: Date.now, ...deps };
  }

  start() {
    this.check();
    this.timer = setInterval(() => this.check(), CHECK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const watch of this.watches.values()) watch.stop();
    this.watches.clear();
    this.seen.clear();
  }

  /**
   * Compare what is switched on, and each analysis's last save, with what is watched;
   * start, update or stop watches that changed.
   */
  check() {
    const db = alertsDb();
    const ids = db
      .select({ id: alertWatches.analysisId })
      .from(alertWatches)
      .orderBy(desc(alertWatches.createdAt))
      .limit(MAX_WATCHES)
      .all()
      .map((r) => r.id);
    const stamps = new Map(
      (ids.length
        ? db
            .select({ id: chartAnalyses.id, updatedAt: chartAnalyses.updatedAt })
            .from(chartAnalyses)
            .where(inArray(chartAnalyses.id, ids))
            .all()
        : []
      ).map((r) => [r.id, r.updatedAt]),
    );
    for (const id of [...this.seen.keys()])
      if (!stamps.has(id)) {
        this.seen.delete(id);
        this.drop(id);
      }
    for (const [id, stamp] of stamps) {
      if (this.seen.get(id) === stamp) continue;
      this.seen.set(id, stamp);
      this.refresh(id, stamp);
    }
  }

  private refresh(id: string, version: string) {
    const rules = rulesFor(id);
    const current = this.watches.get(id);
    if (!rules) return this.drop(id);
    const source = `${rules.provider}|${rules.dataset ?? ""}|${rules.symbol}|${rules.resolution}`;
    if (current && current.source === source) {
      // Same market: keep the connection and the last price, take the new lines and zones.
      Object.assign(current, rules, { version });
      return;
    }
    current?.stop();
    const watch: Watch = {
      ...rules,
      source,
      version,
      last: null,
      origins: new Map(),
      alertedAt: new Map(),
      state: "starting",
      error: null,
      stop: () => {},
    };
    this.watches.set(id, watch);
    watch.stop = STREAMING_PROVIDERS.has(rules.provider) ? this.stream(watch) : this.poll(watch);
  }

  private drop(id: string) {
    this.watches.get(id)?.stop();
    this.watches.delete(id);
  }

  private stream(watch: Watch) {
    try {
      // Same gate as the chart: a public source must be enabled in Settings.
      if (this.deps.listen === listenLive) connectionKey(watch.provider);
      const off = this.deps.listen(
        watch.provider,
        watch.symbol,
        watch.resolution,
        (message: LiveMessage) => {
          if (message.kind === "status") {
            watch.state =
              message.state === "live"
                ? "live"
                : message.state === "error"
                  ? "error"
                  : "reconnecting";
            watch.error =
              message.state === "error" ? (message.message ?? "The live feed failed.") : null;
          } else if (message.kind === "bar") this.price(watch, message.bar.time, message.bar.close);
          else for (const [time, price] of message.trades) this.price(watch, time, price);
        },
      );
      return off ?? (() => {});
    } catch (error) {
      watch.state = "error";
      watch.error = error instanceof Error ? error.message : "Could not watch this symbol.";
      return () => {};
    }
  }

  private poll(watch: Watch) {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const every = Math.max(LIVE_POLL_MS[watch.resolution], 20_000);
    const tick = async () => {
      if (stopped) return;
      try {
        const latest = await this.deps.latest(watch, controller.signal);
        if (latest) this.price(watch, latest.time, latest.close);
        watch.state = "polling";
        watch.error = null;
      } catch (error) {
        watch.state = "error";
        watch.error = error instanceof Error ? error.message : "Could not read prices.";
      }
      if (!stopped) timer = setTimeout(() => void tick(), every);
    };
    void tick();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }

  /** A new price: check lines and zones against the previous one. */
  private price(watch: Watch, time: number, close: number) {
    const previous = watch.last;
    watch.last = { time, close };
    if (!previous || time < previous.time) return;
    const now = this.deps.now();
    const ready = (key: string) => now - (watch.alertedAt.get(key) ?? 0) > COOLDOWN_MS;
    const fired: AlertMessage[] = [];
    for (const event of zoneEvents(watch.zones, previous.close, close, watch.origins)) {
      const zone = watch.zones.find((z) => z.id === event.zoneId);
      const key = `zone-${event.zoneId}-${event.kind}`;
      if (!zone || !ready(key)) continue;
      watch.alertedAt.set(key, now);
      fired.push(zoneAlert(watch.analysisId, watch.symbol, event, zone));
    }
    for (const hit of lineCrossings(watch.lines, previous, { time, close })) {
      if (!ready(hit.drawingId)) continue;
      watch.alertedAt.set(hit.drawingId, now);
      const line = watch.lines.find((l) => l.id === hit.drawingId);
      fired.push(
        lineAlert(watch.analysisId, watch.symbol, hit, line?.label ?? drawingLabel(hit.type)),
      );
    }
    for (const message of fired) void this.emit(watch, message);
  }

  private async emit(watch: Watch, message: AlertMessage) {
    const db = alertsDb();
    const id = newId();
    db.insert(alertEvents)
      .values({
        id,
        analysisId: watch.analysisId,
        symbol: watch.symbol,
        title: message.title,
        message: message.body,
        at: nowIso(),
      })
      .run();
    // Keep the log bounded per analysis.
    const cutoff = db
      .select({ at: alertEvents.at })
      .from(alertEvents)
      .where(eq(alertEvents.analysisId, watch.analysisId))
      .orderBy(desc(alertEvents.at))
      .limit(1)
      .offset(KEEP_EVENTS)
      .get();
    if (cutoff)
      db.delete(alertEvents)
        .where(and(eq(alertEvents.analysisId, watch.analysisId), lt(alertEvents.at, cutoff.at)))
        .run();
    try {
      const delivered = await this.deps.deliver({
        title: message.title,
        body: message.body,
        tag: message.tag,
        url: analysisEditPath(watch.analysisId),
      });
      db.update(alertEvents).set({ delivered }).where(eq(alertEvents.id, id)).run();
    } catch {
      // The event stays in the log as not delivered.
    }
  }

  status() {
    return [...this.watches.values()].map((w) => ({
      analysisId: w.analysisId,
      symbol: w.symbol,
      state: w.state,
      error: w.error,
      lines: w.lines.length,
      zones: w.zones.length,
      lastPrice: w.last?.close ?? null,
    }));
  }
}

// Kept on globalThis: Next.js loads the startup hook and the API routes as separate module
// graphs, and both must reach the one running watcher.
const globalForEngine = globalThis as unknown as { __journalAlertEngine?: AlertEngine };

/** Start the watcher once per server process (dev reloads reuse it). */
export function startAlertEngine(): AlertEngine {
  if (!globalForEngine.__journalAlertEngine) {
    const engine = new AlertEngine();
    engine.start();
    globalForEngine.__journalAlertEngine = engine;
  }
  return globalForEngine.__journalAlertEngine;
}

export const runningAlertEngine = () => globalForEngine.__journalAlertEngine ?? null;

export const recentAlertEvents = (analysisId: string | null, limit = 30) =>
  alertsDb()
    .select()
    .from(alertEvents)
    .where(analysisId ? eq(alertEvents.analysisId, analysisId) : sql`1 = 1`)
    .orderBy(desc(alertEvents.at))
    .limit(limit)
    .all();
