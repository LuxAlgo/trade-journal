"use client";

import { useEffect, useRef, useState } from "react";
import type { IndicatorHandle, Vela } from "@luxalgo/vela";
import { ChevronDown, X } from "lucide-react";
import { RESOLUTIONS, type Resolution } from "@/lib/market-data";
import { VELA_TIMEFRAME, type DrawingsDocument } from "@/lib/chart-analysis";
import { INDICATOR_LIBRARY, libraryIndicator } from "@/lib/indicator-library";
import { mergeStyle, tickForDecimals, type StyleDiff } from "@/lib/chart-preferences";
import {
  INITIAL_BARS,
  MAX_CHART_BARS,
  JournalMarketProvider,
  velaProviderName,
  type LatestBar,
} from "@/lib/live-market";
import type { ChartSync } from "@/lib/chart-sync";
import type { CompanionPane } from "@/lib/multiview";
import { cn, fmtNumber } from "@/lib/utils";
import { markLegacyPatterns } from "@/lib/pattern-fixes";
import { applyPatternFixes } from "./vela-pattern-fixes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { HoverHint } from "./ui/tooltip";

const dark = () => document.documentElement.classList.contains("dark");

export interface CompanionLook {
  style: StyleDiff;
  timeZone: string;
  decimals?: number;
  volume: boolean;
}

/**
 * One extra chart in the multiview: live candles for its own symbol and candle size, its
 * own indicators, the main chart's drawings shown read-only, and a crosshair and time
 * window kept in step with the other charts. Nothing here is saved with the analysis.
 */
export function CompanionChart({
  source,
  pane,
  symbol,
  resolution,
  mainSymbol,
  live,
  look,
  mirror,
  sync,
  onChange,
  onClose,
}: {
  source: { provider: string; dataset: string | null };
  pane: CompanionPane;
  /** What the pane shows, resolved against the main chart. */
  symbol: string;
  resolution: Resolution;
  mainSymbol: string;
  live: boolean;
  look: CompanionLook;
  /** The main chart's drawings, when this pane shows the same symbol. */
  mirror: DrawingsDocument | null;
  sync: ChartSync;
  onChange: (patch: Partial<CompanionPane>) => void;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<Vela | null>(null);
  const feed = useRef<JournalMarketProvider | null>(null);
  const bases = useRef<{ dark?: unknown; light?: unknown }>({});
  const lookRef = useRef(look);
  lookRef.current = look;
  const mirrorRef = useRef(mirror);
  mirrorRef.current = mirror;
  const indicatorsRef = useRef(pane.indicators);
  indicatorsRef.current = pane.indicators;
  const resolutionRef = useRef(resolution);
  const handles = useRef(new Map<string, IndicatorHandle>());
  const engineReady = useRef<Promise<void> | null>(null);
  const following = useRef(false);
  /** Loaded history, grown by scrolling back (or by following another chart back). */
  const history = useRef({ requested: INITIAL_BARS, oldest: 0, loading: false, genesis: false });
  const [latest, setLatest] = useState<LatestBar | null>(null);
  const [error, setError] = useState("");
  const [symbolDraft, setSymbolDraft] = useState(pane.symbol ?? "");

  // The chart remounts for another source or symbol; candle size and the rest update in place.
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    setError("");
    setLatest(null);
    history.current = { requested: INITIAL_BARS, oldest: 0, loading: false, genesis: false };
    void (async () => {
      const vela = await import("@luxalgo/vela");
      if (disposed || !host.current) return;
      applyPatternFixes(vela);
      const provider = new JournalMarketProvider(source, {
        onStatus: (status) => status.state === "error" && setError(status.message ?? "No data."),
        onLatest: (update) => setLatest(update),
      });
      provider.setPaused(!live);
      feed.current = provider;
      const name = velaProviderName(source.provider);
      const theme = dark() ? "dark" : "light";
      const instance = new vela.Vela(host.current, {
        symbol: `${name}:${symbol}`,
        timeframe: VELA_TIMEFRAME[resolutionRef.current],
        bars: INITIAL_BARS,
        live: true,
        theme,
        priceStyle: "candles",
        volume: lookRef.current.volume,
        drawings: { toolbar: false },
      });
      instance.data.registerProvider(name, provider);
      chart.current = instance;
      const other = theme === "dark" ? "light" : "dark";
      bases.current[theme] = instance.renderer.getConfig();
      instance.setTheme(other);
      bases.current[other] = instance.renderer.getConfig();
      instance.setTheme(theme);
      applyLook(instance);
      applyMirror(instance);
      void syncIndicators(instance);

      const offs = [
        instance.renderer.onCrosshairMove((e) => sync.crosshair(pane.id, e.time)),
        instance.on("viewport:changed", ({ from, to }) => {
          if (!following.current) sync.range(pane.id, { from, to });
          // Near the oldest candle, load more, as on the main chart.
          const h = history.current;
          if (!h.oldest || h.loading || h.genesis || from > h.oldest + (to - from) * 0.15) return;
          const target = Math.min(MAX_CHART_BARS, h.requested * 2);
          if (target <= h.requested) return;
          h.requested = target;
          h.loading = true;
          void instance.setMarket({ bars: target });
        }),
        instance.on("history:complete", ({ reason, oldestTime }) => {
          const h = history.current;
          h.loading = false;
          h.genesis = reason === "genesis" || reason === "aborted";
          if (oldestTime) h.oldest = oldestTime;
        }),
        instance.on("load:end", () =>
          setTimeout(() => applyPrecision(instance, lookRef.current.decimals), 0),
        ),
        sync.subscribe(pane.id, {
          crosshair: (time) => instance.renderer.setExternalCrosshair(time, null),
          range: (range) => {
            following.current = true;
            instance.setVisibleRange(range);
            setTimeout(() => (following.current = false), 50);
          },
        }),
      ];
      const observer = new MutationObserver(() => {
        instance.setTheme(dark() ? "dark" : "light");
        applyLook(instance);
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      const resize = new ResizeObserver(() => instance.resize());
      resize.observe(host.current);
      cleanup = () => {
        offs.forEach((off) => off());
        observer.disconnect();
        resize.disconnect();
        handles.current.clear();
        engineReady.current = null;
        instance.destroy();
        if (chart.current === instance) chart.current = null;
        if (feed.current === provider) feed.current = null;
      };
    })().catch(() => {
      if (!disposed) setError("This chart could not be rendered.");
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [source.provider, source.dataset, symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (resolutionRef.current === resolution) return;
    resolutionRef.current = resolution;
    history.current = { requested: INITIAL_BARS, oldest: 0, loading: false, genesis: false };
    void chart.current?.setMarket({ timeframe: VELA_TIMEFRAME[resolution], bars: INITIAL_BARS });
  }, [resolution]);

  useEffect(() => feed.current?.setPaused(!live), [live]);
  useEffect(() => {
    if (chart.current) applyLook(chart.current);
  }, [look]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (chart.current) applyMirror(chart.current);
  }, [mirror]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (chart.current) void syncIndicators(chart.current);
  }, [pane.indicators.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The theme defaults with the saved look over them, as on the main chart. */
  function applyLook(instance: Vela) {
    const base = bases.current[dark() ? "dark" : "light"];
    if (!base) return;
    const current = lookRef.current;
    instance.renderer.applyConfig(
      mergeStyle(base as StyleDiff, {
        ...current.style,
        timeScale: { timezone: current.timeZone },
      }),
    );
    const type = (current.style.series as { style?: unknown } | undefined)?.style;
    const wanted = typeof type === "string" ? type : "candles";
    if (instance.renderer.get("priceStyle") !== wanted || type === "heikinashi")
      instance.renderer.set("priceStyle", wanted);
    applyPrecision(instance, current.decimals);
  }

  /** The main chart's drawings, locked; hidden ones (by layer or by hand) stay hidden. */
  function applyMirror(instance: Vela) {
    const doc = mirrorRef.current;
    instance.drawings.fromJSON(
      markLegacyPatterns({
        version: 1,
        drawings: (doc?.drawings ?? [])
          .filter((d) => d.visible !== false)
          .map((d) => ({ ...d, locked: true })),
      } as DrawingsDocument),
    );
  }

  /** Add and remove built-in indicators to match the pane's list. */
  async function syncIndicators(instance: Vela) {
    const wanted = indicatorsRef.current;
    for (const [key, handle] of handles.current)
      if (!wanted.includes(key)) {
        handle.remove();
        handles.current.delete(key);
      }
    const missing = wanted.filter((key) => !handles.current.has(key));
    if (!missing.length) return;
    // The Pine engine (a Web Worker) starts only once a pane shows an indicator.
    engineReady.current ??= import("@luxalgo/vela-pinets").then(({ PineWorkerEngine }) => {
      if (chart.current === instance)
        instance.registerEngine("pine", new PineWorkerEngine({ props: "strategy" }));
    });
    await engineReady.current;
    if (chart.current !== instance) return;
    for (const key of missing) {
      const indicator = libraryIndicator(key);
      if (!indicator || handles.current.has(key)) continue;
      handles.current.set(key, instance.addIndicator(indicator.source));
    }
  }

  const change =
    latest && latest.previousClose !== null ? latest.bar.close - latest.previousClose : null;
  const follows = pane.symbol === null;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1 text-xs">
        <form
          className="flex min-w-0 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            const next = symbolDraft.trim();
            onChange({ symbol: next && next !== mainSymbol ? next : null });
          }}
        >
          <input
            value={symbolDraft}
            onChange={(e) => setSymbolDraft(e.target.value)}
            onBlur={() => {
              const next = symbolDraft.trim();
              if ((next || null) !== pane.symbol)
                onChange({ symbol: next && next !== mainSymbol ? next : null });
            }}
            placeholder={mainSymbol}
            aria-label="Symbol for this chart"
            title={
              follows ? `Follows the main chart (${mainSymbol}). Type another symbol.` : undefined
            }
            className={cn(
              "h-7 w-28 rounded border bg-background px-1.5 font-medium",
              follows && "placeholder:text-foreground",
            )}
          />
          {follows && <span className="ml-1 text-[10px] text-muted-foreground">main</span>}
        </form>
        <select
          aria-label="Candle size for this chart"
          value={pane.resolution ?? ""}
          onChange={(e) => onChange({ resolution: (e.target.value || null) as Resolution | null })}
          className="h-7 rounded border bg-background px-1"
        >
          <option value="">Same ({resolution})</option>
          {(Object.keys(RESOLUTIONS) as Resolution[]).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded border px-1.5 hover:bg-accent"
              aria-label="Indicators on this chart"
            >
              {pane.indicators.length
                ? pane.indicators
                    .map((k) => libraryIndicator(k)?.name.split(" (")[0] ?? k)
                    .join(", ")
                : "Indicators"}
              <ChevronDown className="size-3 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {INDICATOR_LIBRARY.map((indicator) => {
              const on = pane.indicators.includes(indicator.key);
              return (
                <DropdownMenuItem
                  key={indicator.key}
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onSelect={(event) => {
                    event.preventDefault();
                    onChange({
                      indicators: on
                        ? pane.indicators.filter((k) => k !== indicator.key)
                        : [...pane.indicators, indicator.key].slice(-5),
                    });
                  }}
                >
                  <input type="checkbox" readOnly checked={on} className="pointer-events-none" />
                  <span className="min-w-0 flex-1 truncate">{indicator.name}</span>
                  <span className="text-[10px] text-muted-foreground">{indicator.category}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="ml-auto flex items-center gap-2">
          {latest && (
            <span className="tnum">
              {fmtNumber(latest.bar.close)}
              {change !== null && (
                <span className="ml-1 text-muted-foreground">
                  {change >= 0 ? "+" : "−"}
                  {fmtNumber(Math.abs(change))}
                </span>
              )}
            </span>
          )}
          <HoverHint content="Hide this chart">
            <button
              type="button"
              aria-label="Hide this chart"
              className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={onClose}
            >
              <X className="size-3.5" />
            </button>
          </HoverHint>
        </span>
      </div>
      {error && (
        <p role="alert" className="px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
      <div ref={host} className="journal-companion-chart min-h-0 flex-1" />
    </div>
  );
}

function applyPrecision(instance: Vela, decimals: number | undefined) {
  const port = (
    instance.renderer as unknown as {
      renderer?: { setPricePrecision?: (tick: number | undefined) => void };
    }
  ).renderer;
  port?.setPricePrecision?.(tickForDecimals(decimals));
}
