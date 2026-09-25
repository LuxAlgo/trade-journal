"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { DrawingTypeKey, SerializedDrawing, Vela } from "@luxalgo/vela";
import {
  ArrowUpRight,
  Eraser,
  Hand,
  Highlighter,
  Maximize2,
  Minimize2,
  Minus,
  MoveUpRight,
  Pen,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { RESOLUTIONS, type Resolution } from "@/lib/market-data";
import { VELA_TIMEFRAME, type DrawingsDocument } from "@/lib/chart-analysis";
import { drawingStates, type LayersDocument } from "@/lib/chart-layers";
import {
  INITIAL_BARS,
  JournalMarketProvider,
  MAX_CHART_BARS,
  velaProviderName,
  type LatestBar,
  type LiveStatus,
} from "@/lib/live-market";
import { STYLUS_COLORS, STYLUS_WIDTHS, isBrush, stylusPreference } from "@/lib/stylus";
import { cn } from "@/lib/utils";
import { attachStylus } from "./chart-stylus";
import { Button } from "./ui/button";
import { HoverHint } from "./ui/tooltip";

export interface ChartDrawing {
  id: string;
  type: string;
  anchors: { time: number; price: number }[];
  visible: boolean;
  locked: boolean;
  text?: string;
}

export interface AnalysisChartHandle {
  drawings(): DrawingsDocument;
  /** PNG data URL of candles plus visible drawings, or null when it can't be exported. */
  screenshot(): string | null;
  visibleRange(): { from: number; to: number } | null;
  /** Oldest and newest loaded candle times. */
  loadedRange(): { from: number; to: number } | null;
  select(id: string): void;
  remove(ids: string[]): void;
  /** Scroll (loading older history if needed) so these drawings are in view. */
  reveal(ids: string[]): void;
}

const TOOLS: {
  type: DrawingTypeKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { type: "freehand", label: "Pen", icon: Pen },
  { type: "highlighter", label: "Highlighter", icon: Highlighter },
  { type: "trendline", label: "Trend line", icon: MoveUpRight },
  { type: "hline", label: "Horizontal line", icon: Minus },
  { type: "box", label: "Rectangle", icon: Square },
  { type: "arrow", label: "Arrow", icon: ArrowUpRight },
  { type: "text", label: "Text", icon: Type },
];
const QUICK_TOOLS = new Set<DrawingTypeKey>(TOOLS.map((entry) => entry.type));

type DrawingsInternals = {
  ctrl?: {
    lastStyle?: unknown;
    store?: { setVisible?: unknown; setLocked?: unknown };
  };
};

const toChartDrawing = (d: SerializedDrawing): ChartDrawing => ({
  id: d.id,
  type: d.type,
  anchors: d.anchors.map((a) => ({ time: a.time, price: a.price })),
  visible: d.visible,
  locked: d.locked,
  text: d.text?.value,
});

const freshHistory = (requested: number) => ({
  requested,
  loading: true,
  genesis: false,
  oldest: 0,
  newest: 0,
});

/**
 * A live market chart on Vela with drawing tools tuned for a stylus. Candles stream from
 * the journal's market-data connection: the latest history loads on open, scrolling back
 * loads older candles, and new candles arrive while the tab is visible. Drawings are time
 * and price anchored; their layer decides whether they show and whether they are locked.
 * The page remounts this component for another source or symbol.
 */
export function AnalysisChart({
  source,
  symbol,
  resolution,
  live,
  initialDrawings,
  initialVisible,
  layers,
  onDrawingCreated,
  onDrawingsChange,
  onEdit,
  onStatus,
  onLatest,
  onSelect,
  chartRef,
}: {
  source: { provider: string; dataset: string | null };
  symbol: string;
  resolution: Resolution;
  live: boolean;
  initialDrawings: DrawingsDocument;
  initialVisible?: { from: number; to: number } | null;
  layers: LayersDocument;
  onDrawingCreated: (id: string) => void;
  /** Every drawing on the chart, after any change (for the layers panel and alerts). */
  onDrawingsChange: (drawings: ChartDrawing[]) => void;
  /** A user edit worth saving (not panning or zooming). */
  onEdit: () => void;
  onStatus: (status: LiveStatus) => void;
  onLatest: (latest: LatestBar) => void;
  onSelect: (id: string | null) => void;
  chartRef?: Ref<AnalysisChartHandle>;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<Vela | null>(null);
  const provider = useRef<JournalMarketProvider | null>(null);
  const seed = useRef({ drawings: initialDrawings, visible: initialVisible });
  const callbacks = useRef({
    onDrawingCreated,
    onDrawingsChange,
    onEdit,
    onStatus,
    onLatest,
    onSelect,
  });
  callbacks.current = { onDrawingCreated, onDrawingsChange, onEdit, onStatus, onLatest, onSelect };
  const layersRef = useRef(layers);
  const resolutionRef = useRef(resolution);
  const liveRef = useRef(live);
  const history = useRef(freshHistory(INITIAL_BARS));
  const pendingReveal = useRef<string[] | null>(null);
  const [preference, setPreference] = useState(stylusPreference.read);
  const prefs = useRef(preference);
  prefs.current = preference;
  const [tool, setTool] = useState<DrawingTypeKey | null>(null);
  const [erasing, setErasing] = useState(false);
  const [undoState, setUndoState] = useState({ undo: false, redo: false });
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState("");
  const [penSeen, setPenSeen] = useState(false);
  const armedByPen = useRef(false);

  useImperativeHandle(chartRef, () => ({
    drawings: () =>
      (chart.current?.drawings.toJSON() as unknown as DrawingsDocument | undefined) ??
      seed.current.drawings,
    screenshot: () => chart.current?.renderer.screenshot() ?? null,
    visibleRange: () => chart.current?.getVisibleRange() ?? null,
    loadedRange: () =>
      history.current.oldest ? { from: history.current.oldest, to: history.current.newest } : null,
    select: (id) => chart.current?.drawings.select(id),
    remove: (ids) => {
      if (ids.length) chart.current?.drawings.removeMany(ids);
    },
    reveal: (ids) => {
      if (chart.current) revealNow(chart.current, ids);
    },
  }));

  const arm = (type: DrawingTypeKey | null) => {
    const instance = chart.current;
    if (!instance) return;
    if (instance.drawings.getMode()) instance.drawings.setMode(null);
    instance.drawings.setTool(type);
    armedByPen.current = false;
  };

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let cleanup = () => {};
    setError("");
    void (async () => {
      const { Vela } = await import("@luxalgo/vela");
      if (disposed || !host.current) return;
      const dark = () => document.documentElement.classList.contains("dark");
      const { drawings, visible } = seed.current;
      const step = RESOLUTIONS[resolutionRef.current];
      // Enough history to show a saved view, within the chart's depth cap.
      const bars = visible
        ? Math.min(
            MAX_CHART_BARS,
            Math.max(INITIAL_BARS, Math.ceil((Date.now() - visible.from) / step) + 50),
          )
        : INITIAL_BARS;
      history.current = freshHistory(bars);
      const feed = new JournalMarketProvider(source, {
        onStatus: (status) => callbacks.current.onStatus(status),
        onLatest: (latest) => {
          history.current.newest = Math.max(history.current.newest, latest.bar.time);
          callbacks.current.onLatest(latest);
        },
      });
      feed.setPaused(!liveRef.current);
      provider.current = feed;
      const name = velaProviderName(source.provider);
      const instance = new Vela(element, {
        symbol: `${name}:${symbol}`,
        timeframe: VELA_TIMEFRAME[resolutionRef.current],
        bars,
        live: true,
        theme: dark() ? "dark" : "light",
        priceStyle: "candles",
        volume: true,
        drawings: true,
        ...(visible ? { visibleRange: visible } : {}),
      });
      instance.data.registerProvider(name, feed);
      chart.current = instance;
      instance.drawings.fromJSON(drawings);
      applyLayers(instance, layersRef.current);
      publish(instance);

      const refresh = () =>
        setUndoState({ undo: instance.drawings.canUndo(), redo: instance.drawings.canRedo() });
      const edited = () => {
        // Undo/redo restore snapshots that predate layer changes; layers stay authoritative.
        applyLayers(instance, layersRef.current);
        refresh();
        publish(instance);
        callbacks.current.onEdit();
      };
      const seeded = canSeedStyle(instance);
      const offs = [
        instance.on("drawing:created", ({ id }) => {
          const drawing = instance.drawings.all().find((d) => d.id === id);
          // Without the style seed, give each new quick-tool drawing the chosen ink once.
          if (drawing && !seeded && QUICK_TOOLS.has(drawing.type))
            instance.drawings.update(id, {
              style: { ...drawing.style, ...styleFor(drawing.type, prefs.current) },
            });
          callbacks.current.onDrawingCreated(id);
          edited();
        }),
        instance.on("drawing:edited", edited),
        instance.on("drawing:removed", edited),
        instance.on("drawing:selected", ({ id }) => callbacks.current.onSelect(id)),
        instance.on("drawing:tool", ({ type }) => {
          setTool(type);
          if (!type) armedByPen.current = false;
          // Re-arming the same tool pushes the seeded style to the renderer; no event loops.
          else if (QUICK_TOOLS.has(type) && seedStyle(instance, type, prefs.current))
            instance.drawings.setTool(type);
        }),
        instance.on("drawing:mode", ({ mode }) => setErasing(mode === "eraser")),
        instance.on("history:complete", ({ reason, oldestTime }) => {
          const state = history.current;
          state.loading = false;
          state.genesis = reason === "genesis" || reason === "aborted";
          if (oldestTime) state.oldest = oldestTime;
          if (pendingReveal.current) revealNow(instance, pendingReveal.current);
        }),
        instance.on("load:end", ({ bars: loaded }) => {
          if (!loaded) history.current.loading = false;
        }),
        instance.on("viewport:changed", ({ from, to }) => {
          // Scrolling near the oldest candle loads more, like any trading chart.
          const state = history.current;
          if (!state.oldest || from > state.oldest + (to - from) * 0.15) return;
          growHistory(instance, state.requested * 2);
        }),
      ];
      setTool(instance.drawings.getTool());
      refresh();

      const detachStylus = attachStylus(instance, element, {
        prefs: () => prefs.current,
        armedByPen,
        onPen: () => setPenSeen(true),
      });
      const onKey = (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase()))
          requestAnimationFrame(edited);
      };
      element.addEventListener("keydown", onKey);
      const observer = new MutationObserver(() => instance.setTheme(dark() ? "dark" : "light"));
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      const resize = new ResizeObserver(() => instance.resize());
      resize.observe(element);
      cleanup = () => {
        offs.forEach((off) => off());
        detachStylus();
        element.removeEventListener("keydown", onKey);
        observer.disconnect();
        resize.disconnect();
        seed.current = {
          drawings: instance.drawings.toJSON() as unknown as DrawingsDocument,
          visible: instance.getVisibleRange(),
        };
        instance.destroy();
        if (chart.current === instance) chart.current = null;
        if (provider.current === feed) provider.current = null;
      };
    })().catch(() => {
      if (!disposed) setError("The chart could not be rendered.");
    });
    return () => {
      disposed = true;
      cleanup();
    };
    // Source and symbol changes remount; resolution, live and layers update in place.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A timeframe switch keeps the drawings and loads the latest candles at the new size.
  useEffect(() => {
    if (resolutionRef.current === resolution) return;
    resolutionRef.current = resolution;
    const instance = chart.current;
    if (!instance) return;
    history.current = freshHistory(INITIAL_BARS);
    void instance.setMarket({ timeframe: VELA_TIMEFRAME[resolution], bars: INITIAL_BARS });
  }, [resolution]);

  useEffect(() => {
    liveRef.current = live;
    provider.current?.setPaused(!live);
  }, [live]);

  useEffect(() => {
    const previous = layersRef.current;
    layersRef.current = layers;
    if (chart.current && previous !== layers) {
      applyLayers(chart.current, layers, previous);
      publish(chart.current);
    }
  }, [layers]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  /** Apply layer visibility/locks without adding undo steps; see `drawingStates`. */
  function applyLayers(instance: Vela, doc: LayersDocument, previous?: LayersDocument) {
    const patches = drawingStates(doc, instance.drawings.all(), previous);
    if (!patches.length) return;
    const store = (instance.drawings as unknown as DrawingsInternals).ctrl?.store;
    if (typeof store?.setVisible === "function" && typeof store.setLocked === "function") {
      const setVisible = store.setVisible as (id: string, v: boolean) => void;
      const setLocked = store.setLocked as (id: string, v: boolean) => void;
      for (const patch of patches) {
        setVisible.call(store, patch.id, patch.visible);
        setLocked.call(store, patch.id, patch.locked);
      }
    } else {
      // Public fallback: one undo step per layer change.
      instance.drawings.updateMany(
        patches.map((p) => ({ id: p.id, patch: { visible: p.visible, locked: p.locked } })),
      );
    }
  }

  function publish(instance: Vela) {
    callbacks.current.onDrawingsChange(instance.drawings.all().map(toChartDrawing));
  }

  /** Grow the loaded history; Vela backfills older chunks behind the chart. */
  function growHistory(instance: Vela, bars: number) {
    const state = history.current;
    const target = Math.min(MAX_CHART_BARS, bars);
    if (state.loading || state.genesis || target <= state.requested) return;
    state.requested = target;
    state.loading = true;
    void instance.setMarket({ bars: target });
  }

  function revealNow(instance: Vela, ids: string[]) {
    const times = instance.drawings
      .all()
      .filter((d) => ids.includes(d.id))
      .flatMap((d) => d.anchors.map((a) => a.time));
    if (!times.length) return;
    const step = RESOLUTIONS[resolutionRef.current];
    const min = Math.min(...times);
    const max = Math.max(...times);
    const pad = Math.max((max - min) * 0.3, step * 20);
    const state = history.current;
    const needsOlder = state.oldest > 0 && min - pad < state.oldest;
    if (needsOlder && !state.genesis && state.requested < MAX_CHART_BARS) {
      pendingReveal.current = ids;
      growHistory(instance, Math.ceil((state.newest - (min - pad)) / step) + 50);
      if (history.current.loading) return;
    }
    pendingReveal.current = null;
    const end = state.newest ? Math.min(max + pad, state.newest + step * 10) : max + pad;
    instance.setVisibleRange({ from: min - pad, to: end });
  }

  const updatePreference = (patch: Partial<typeof preference>) => {
    const next = { ...preference, ...patch };
    setPreference(next);
    prefs.current = next;
    stylusPreference.write(next);
    const instance = chart.current;
    const current = instance?.drawings.getTool();
    // Re-arm so the renderer picks up the new color/width for the next stroke.
    if (instance && current && QUICK_TOOLS.has(current)) {
      seedStyle(instance, current, next);
      instance.drawings.setTool(current);
    }
  };

  // Browsers without element full screen (iPhone Safari) get a fixed full-window layout.
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (fullscreen) setFullscreen(false);
    else if (frame.current?.requestFullscreen)
      frame.current.requestFullscreen().catch(() => setFullscreen(true));
    else setFullscreen(true);
  };
  useEffect(() => {
    if (!fullscreen || document.fullscreenElement) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const drawingsApi = () => chart.current?.drawings;
  const afterHistoryStep = () => {
    const instance = chart.current;
    if (!instance) return;
    applyLayers(instance, layersRef.current);
    publish(instance);
    callbacks.current.onEdit();
    setUndoState({ undo: instance.drawings.canUndo(), redo: instance.drawings.canRedo() });
  };
  return (
    <div
      ref={frame}
      className={cn(
        "flex flex-col gap-2 bg-background",
        fullscreen && "fixed inset-0 z-50 p-2 sm:p-3",
      )}
    >
      <div
        role="toolbar"
        aria-label="Drawing tools"
        className="flex flex-wrap items-center gap-1 rounded-lg border bg-card p-1"
      >
        <ToolButton
          label="Pan and select"
          active={!tool && !erasing}
          onClick={() => arm(null)}
          icon={Hand}
        />
        {TOOLS.map((entry) => (
          <ToolButton
            key={entry.type}
            label={entry.label}
            active={tool === entry.type && !erasing}
            onClick={() => {
              if (isBrush(entry.type)) updatePreference({ penTool: entry.type });
              arm(entry.type);
            }}
            icon={entry.icon}
          />
        ))}
        <ToolButton
          label="Eraser (drag across drawings)"
          active={erasing}
          onClick={() => drawingsApi()?.setMode(erasing ? null : "eraser")}
          icon={Eraser}
        />
        <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
        <div role="radiogroup" aria-label="Ink color" className="flex items-center gap-1">
          {STYLUS_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              role="radio"
              aria-checked={preference.color === color.value}
              aria-label={color.label}
              title={color.label}
              onClick={() => updatePreference({ color: color.value })}
              className={cn(
                "size-7 rounded-full border-2 transition-transform",
                preference.color === color.value
                  ? "scale-110 border-foreground"
                  : "border-transparent",
              )}
              style={{ backgroundColor: color.value }}
            />
          ))}
        </div>
        <div role="radiogroup" aria-label="Stroke width" className="flex items-center gap-0.5">
          {STYLUS_WIDTHS.map((width) => (
            <button
              key={width.value}
              type="button"
              role="radio"
              aria-checked={preference.width === width.value}
              aria-label={`${width.label} stroke`}
              title={`${width.label} stroke`}
              onClick={() => updatePreference({ width: width.value })}
              className={cn(
                "flex size-8 items-center justify-center rounded-md",
                preference.width === width.value ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              <span
                className="block w-4 rounded-full bg-foreground"
                style={{ height: Math.max(2, width.value) }}
              />
            </button>
          ))}
        </div>
        <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
        <ToolButton
          label="Undo"
          disabled={!undoState.undo}
          onClick={() => {
            drawingsApi()?.undo();
            afterHistoryStep();
          }}
          icon={Undo2}
        />
        <ToolButton
          label="Redo"
          disabled={!undoState.redo}
          onClick={() => {
            drawingsApi()?.redo();
            afterHistoryStep();
          }}
          icon={Redo2}
        />
        <ToolButton
          label="Clear all drawings"
          onClick={() => {
            const api = drawingsApi();
            const ids = api?.all().map((d) => d.id) ?? [];
            if (!api || !ids.length) return;
            if (!confirm("Remove every drawing from this chart, in all layers?")) return;
            api.removeMany(ids);
          }}
          icon={Trash2}
        />
        <label className="ml-auto flex min-h-8 cursor-pointer items-center gap-2 px-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={preference.penDraws}
            onChange={(event) => updatePreference({ penDraws: event.target.checked })}
          />
          Stylus draws, fingers pan
        </label>
        <ToolButton
          label={fullscreen ? "Exit full screen" : "Full screen"}
          onClick={toggleFullscreen}
          icon={fullscreen ? Minimize2 : Maximize2}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div
        ref={host}
        tabIndex={-1}
        className={cn(
          "journal-analysis-chart overflow-hidden rounded-lg border",
          fullscreen ? "min-h-0 flex-1" : "h-[min(72vh,680px)] min-h-[420px]",
        )}
      />
      {!fullscreen && (
        <p className="text-xs text-muted-foreground">
          {penSeen
            ? "Stylus detected. The pen tip draws, a pen tap selects a drawing, the eraser end erases, and fingers pan and zoom. Turn off “Stylus draws” to drag drawings with the pen."
            : "Draw with a stylus, mouse or finger after choosing a tool. With a stylus, the pen tip draws without choosing a tool first."}{" "}
          Scroll back for older candles. New drawings go to the active layer.
        </p>
      )}
    </div>
  );
}

type Prefs = ReturnType<typeof stylusPreference.read>;

function styleFor(type: DrawingTypeKey, prefs: Prefs) {
  return {
    lineColor: prefs.color,
    lineWidth: type === "highlighter" ? Math.max(10, prefs.width * 4) : prefs.width,
  };
}

/** Vela keeps a per-tool "last used" style that seeds new drawings; it has no public
 *  setter, so the palette writes it when present and falls back to per-drawing styling. */
const lastStyles = (instance: Vela) => {
  const last = (instance.drawings as unknown as DrawingsInternals).ctrl?.lastStyle;
  return last instanceof Map ? (last as Map<string, Record<string, unknown>>) : null;
};
const canSeedStyle = (instance: Vela) => lastStyles(instance) !== null;
function seedStyle(instance: Vela, type: DrawingTypeKey, prefs: Prefs): boolean {
  const last = lastStyles(instance);
  if (!last) return false;
  const style = styleFor(type, prefs);
  const current = last.get(type);
  if (current?.lineColor === style.lineColor && current?.lineWidth === style.lineWidth)
    return false;
  last.set(type, { ...current, ...style });
  return true;
}

function ToolButton({
  label,
  icon: Icon,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <HoverHint content={label}>
      <Button
        type="button"
        size="icon"
        variant={active ? "secondary" : "ghost"}
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={cn("size-9", active && "ring-1 ring-primary")}
      >
        <Icon className="size-4" />
      </Button>
    </HoverHint>
  );
}
