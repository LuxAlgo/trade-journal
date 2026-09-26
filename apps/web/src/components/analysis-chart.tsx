"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { DrawingTypeKey, SerializedDrawing, Vela } from "@luxalgo/vela";
import {
  ArrowUpRight,
  Eraser,
  Hand,
  Highlighter,
  Layers,
  PanelRightClose,
  Maximize2,
  Minimize2,
  Minus,
  MoveUpRight,
  Pen,
  Plus,
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
import { markLegacyPatterns } from "@/lib/pattern-fixes";
import {
  isColor,
  mergeStyle,
  sameToolStyle,
  styleDiff,
  tickForDecimals,
  toolStyleOf,
  MAX_PALETTE,
  type SnapMode,
  type StyleDiff,
  type ToolStyle,
} from "@/lib/chart-preferences";
import { attachStylus } from "./chart-stylus";
import { applyPatternFixes } from "./vela-pattern-fixes";
import {
  createIndicatorBridge,
  type ChartIndicator,
  type IndicatorAlert,
  type IndicatorBridge,
} from "./chart-indicators-bridge";
import type { StoredIndicator } from "@/lib/chart-indicators";
import {
  createChartOverlays,
  type ChartOverlays,
  type OverlayHooks,
  type OverlayState,
} from "./chart-overlays";
import type { ChartSync } from "@/lib/chart-sync";
import { Button } from "./ui/button";
import { HoverHint } from "./ui/tooltip";
import { PortalContainer } from "./ui/portal-container";

const SIDE_PANEL_KEY = "journal-chart-side-panel-v1";

export interface ChartDrawing {
  id: string;
  type: string;
  anchors: { time: number; price: number }[];
  visible: boolean;
  locked: boolean;
  text?: string;
  color?: string;
  lineWidth?: number;
  lineStyle?: string;
  zIndex: number;
}

/** How the chart looks and behaves, resolved by the page from the saved preferences. */
export interface ChartAppearance {
  /** The look to show, as a difference from the theme defaults. */
  style: StyleDiff;
  /** IANA zone for the time axis. */
  timeZone: string;
  /** Price decimals on the axis; undefined = automatic. */
  decimals?: number;
  volume: boolean;
  magnet: SnapMode;
  stayInDrawingMode: boolean;
  tools: Record<string, ToolStyle>;
  rememberToolStyles: boolean;
  palette: string[];
  favoriteTools: string[];
}

/** A drawing-behaviour change made on the chart itself, to save as a preference. */
export type DrawingPrefsPatch = Partial<
  Pick<ChartAppearance, "magnet" | "stayInDrawingMode" | "palette" | "favoriteTools">
>;

/** One drawing's new fields, for bulk edits from the layers panel. */
export type DrawingPatch = {
  id: string;
  patch: {
    visible?: boolean;
    locked?: boolean;
    style?: Record<string, unknown>;
  };
};

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
  /** Script indicators on the chart, or null until the chart and its Pine engine are up. */
  indicators(): IndicatorBridge | null;
  /** Scroll to a moment (loading older history if needed). */
  showTime(time: number): void;
  /** Vela's own settings dialog (every option), optionally on one tab. */
  openSettings(section?: string): void;
  /** The current theme's untouched default config (what a look is a difference from). */
  themeBase(): unknown;
  /** Change several drawings as one undo step. */
  updateDrawings(patches: DrawingPatch[]): void;
  duplicate(ids: string[]): string[];
  bringToFront(ids: string[]): void;
  sendToBack(ids: string[]): void;
  /** Open a drawing's own settings popup on the chart. */
  editDrawing(id: string): void;
  selectMany(ids: string[]): void;
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
    store?: { setVisible?: unknown; setLocked?: unknown; get?: (id: string) => unknown };
    sync?: () => void;
  };
};

const toChartDrawing = (d: SerializedDrawing): ChartDrawing => ({
  id: d.id,
  type: d.type,
  anchors: d.anchors.map((a) => ({ time: a.time, price: a.price })),
  visible: d.visible,
  locked: d.locked,
  text: d.text?.value,
  color: d.style.lineColor,
  lineWidth: d.style.lineWidth,
  lineStyle: d.style.lineStyle,
  zIndex: d.zIndex,
});

const dark = () => document.documentElement.classList.contains("dark");

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
  initialIndicators,
  onIndicatorsChange,
  onIndicatorAlert,
  overlay,
  overlayHooks,
  capturing,
  toolbarExtras,
  sidePanel,
  sync,
  layers,
  onDrawingCreated,
  onDrawingsChange,
  onEdit,
  onStatus,
  onLatest,
  onSelect,
  appearance,
  onLookEdited,
  onDrawingPrefs,
  onToolStyle,
  chartRef,
}: {
  source: { provider: string; dataset: string | null };
  symbol: string;
  resolution: Resolution;
  live: boolean;
  initialDrawings: DrawingsDocument;
  initialVisible?: { from: number; to: number } | null;
  /** Saved indicators with their code already resolved (library or saved script). */
  initialIndicators: StoredIndicator[];
  /** Indicators after any change; `edited` is false for errors and the initial restore. */
  onIndicatorsChange: (indicators: ChartIndicator[], edited: boolean) => void;
  onIndicatorAlert: (alert: IndicatorAlert) => void;
  /** Journal trades, missed trades, zones and events to draw, and what to show. */
  overlay: OverlayState;
  overlayHooks: Omit<OverlayHooks, "drawingActive">;
  /** A click-to-place mode (missed trade, zone) is waiting for a chart click. */
  capturing: boolean;
  /** Extra buttons appended to the drawing toolbar. */
  toolbarExtras?: React.ReactNode;
  /** Docked beside the chart (below it on narrow screens), toggled from the toolbar. */
  sidePanel?: { title: string; count?: number; content: React.ReactNode };
  /** Multiview: keeps this chart's crosshair and time window in step with the others. */
  sync?: { bus: ChartSync; id: string };
  layers: LayersDocument;
  onDrawingCreated: (id: string) => void;
  /** Every drawing on the chart, after any change (for the layers panel and alerts). */
  onDrawingsChange: (drawings: ChartDrawing[]) => void;
  /** A user edit worth saving (not panning or zooming). */
  onEdit: () => void;
  onStatus: (status: LiveStatus) => void;
  onLatest: (latest: LatestBar) => void;
  onSelect: (id: string | null, ids: string[]) => void;
  appearance: ChartAppearance;
  /** The look was changed in Vela's own settings dialog: the full config and the theme base. */
  onLookEdited: (edit: { style: StyleDiff; base: unknown; timeZone: string | null }) => void;
  onDrawingPrefs: (patch: DrawingPrefsPatch) => void;
  /** A tool's style to start its next drawing with (the last one used). */
  onToolStyle: (type: string, style: ToolStyle) => void;
  chartRef?: Ref<AnalysisChartHandle>;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<Vela | null>(null);
  const provider = useRef<JournalMarketProvider | null>(null);
  const seed = useRef({ drawings: initialDrawings, visible: initialVisible });
  const indicatorsSeed = useRef(initialIndicators);
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const overlayHooksRef = useRef(overlayHooks);
  overlayHooksRef.current = overlayHooks;
  const overlays = useRef<ChartOverlays | null>(null);
  const bridge = useRef<IndicatorBridge | null>(null);
  const callbacks = useRef({
    onDrawingCreated,
    onDrawingsChange,
    onEdit,
    onStatus,
    onLatest,
    onSelect,
    onIndicatorsChange,
    onIndicatorAlert,
    onLookEdited,
    onDrawingPrefs,
    onToolStyle,
  });
  callbacks.current = {
    onDrawingCreated,
    onDrawingsChange,
    onEdit,
    onStatus,
    onLatest,
    onSelect,
    onIndicatorsChange,
    onIndicatorAlert,
    onLookEdited,
    onDrawingPrefs,
    onToolStyle,
  };
  const layersRef = useRef(layers);
  const appearanceRef = useRef(appearance);
  /** Theme default configs, captured clean at creation; looks are applied over them. */
  const themeBases = useRef<{ dark?: unknown; light?: unknown }>({});
  /** Set while this component writes the config or drawings, so its own writes aren't read back as edits. */
  const writing = useRef(false);
  const resolutionRef = useRef(resolution);
  const liveRef = useRef(live);
  const history = useRef(freshHistory(INITIAL_BARS));
  const pendingReveal = useRef<string[] | null>(null);
  const pendingTime = useRef<number | null>(null);
  const [preference, setPreference] = useState(stylusPreference.read);
  const prefs = useRef(preference);
  prefs.current = preference;
  const [tool, setTool] = useState<DrawingTypeKey | null>(null);
  const [erasing, setErasing] = useState(false);
  const [undoState, setUndoState] = useState({ undo: false, redo: false });
  const [fullscreen, setFullscreen] = useState(false);
  /** Full screen via the browser API shows only the frame, so popups portal into it. */
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [sideOpen, setSideOpen] = useState(true);
  useEffect(() => {
    try {
      setSideOpen(localStorage.getItem(SIDE_PANEL_KEY) !== "closed");
    } catch {
      // Open by default.
    }
  }, []);
  const toggleSide = () =>
    setSideOpen((open) => {
      try {
        localStorage.setItem(SIDE_PANEL_KEY, open ? "closed" : "open");
      } catch {
        // This page only.
      }
      return !open;
    });
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
    indicators: () => bridge.current,
    showTime: (time) => {
      if (chart.current) showTimeNow(chart.current, time);
    },
    openSettings: (section) => chart.current?.renderer.openSettings(section),
    themeBase: () => themeBases.current[dark() ? "dark" : "light"] ?? null,
    updateDrawings: (patches) => {
      const instance = chart.current;
      if (!instance || !patches.length) return;
      writing.current = true;
      try {
        instance.drawings.updateMany(
          patches.map(({ id, patch }) => {
            const current = instance.drawings.all().find((d) => d.id === id);
            return {
              id,
              patch: {
                ...patch,
                ...(patch.style && current
                  ? { style: { ...current.style, ...patch.style } as SerializedDrawing["style"] }
                  : {}),
              } as Partial<SerializedDrawing>,
            };
          }),
        );
      } finally {
        writing.current = false;
      }
      applyLayers(instance, layersRef.current);
      publish(instance);
      callbacks.current.onEdit();
    },
    duplicate: (ids) => {
      const instance = chart.current;
      if (!instance || !ids.length) return [];
      const before = new Set(instance.drawings.all().map((d) => d.id));
      instance.drawings.duplicate(ids);
      const copies = instance.drawings
        .all()
        .map((d) => d.id)
        .filter((id) => !before.has(id));
      publish(instance);
      callbacks.current.onEdit();
      return copies;
    },
    bringToFront: (ids) => {
      const instance = chart.current;
      if (!instance) return;
      for (const id of ids) instance.drawings.bringToFront(id);
      publish(instance);
      callbacks.current.onEdit();
    },
    sendToBack: (ids) => {
      const instance = chart.current;
      if (!instance) return;
      for (const id of [...ids].reverse()) instance.drawings.sendToBack(id);
      publish(instance);
      callbacks.current.onEdit();
    },
    editDrawing: (id) => chart.current?.drawings.openSettings(id),
    selectMany: (ids) => chart.current?.drawings.select(ids),
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
      const [vela, { PineWorkerEngine }] = await Promise.all([
        import("@luxalgo/vela"),
        import("@luxalgo/vela-pinets"),
      ]);
      const { Vela } = vela;
      if (disposed || !host.current) return;
      applyPatternFixes(vela);
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
        volume: appearanceRef.current.volume,
        drawings: true,
        ...(visible ? { visibleRange: visible } : {}),
      });
      instance.data.registerProvider(name, feed);
      // Pine Script indicators run in a Web Worker so heavy scripts never block drawing.
      const engine = new PineWorkerEngine({ props: "strategy" });
      instance.registerEngine("pine", engine);
      chart.current = instance;
      // Capture both themes' untouched defaults before any look is applied over them.
      const theme = dark() ? "dark" : "light";
      const other = theme === "dark" ? "light" : "dark";
      themeBases.current[theme] = instance.renderer.getConfig();
      instance.setTheme(other);
      themeBases.current[other] = instance.renderer.getConfig();
      instance.setTheme(theme);
      applyLook(instance);
      applyDrawingPrefs(instance, appearanceRef.current);
      instance.drawings.fromJSON(markLegacyPatterns(drawings));
      applyLayers(instance, layersRef.current);
      publish(instance);
      const indicators = createIndicatorBridge(instance, {
        onChange: (list, edited) => callbacks.current.onIndicatorsChange(list, edited),
        onAlert: (alert) => callbacks.current.onIndicatorAlert(alert),
      });
      indicators.restore(indicatorsSeed.current);
      bridge.current = indicators;
      const drawn = createChartOverlays(
        vela,
        instance,
        element,
        {
          onOpenTrade: (key) => overlayHooksRef.current.onOpenTrade(key),
          onOpenMissed: (id) => overlayHooksRef.current.onOpenMissed(id),
          onZoneStats: (stats) => overlayHooksRef.current.onZoneStats(stats),
          onChartClick: (point) => overlayHooksRef.current.onChartClick(point),
          drawingActive: () =>
            instance.drawings.getTool() !== null || instance.drawings.getMode() !== null,
        },
        overlayRef.current,
      );
      overlays.current = drawn;

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
          const tools = appearanceRef.current.tools;
          // Without the style seed, give each new quick-tool drawing the chosen ink once.
          if (drawing && !seeded && QUICK_TOOLS.has(drawing.type))
            instance.drawings.update(id, {
              style: { ...drawing.style, ...styleFor(drawing.type, prefs.current, tools) },
            });
          if (drawing) applyTextDefaults(instance, drawing, tools[drawing.type]);
          callbacks.current.onDrawingCreated(id);
          edited();
        }),
        instance.on("drawing:edited", ({ id }) => {
          // A style changed in the drawing's own popup becomes its tool's starting style.
          const current = appearanceRef.current;
          const drawing = instance.drawings.all().find((d) => d.id === id);
          if (drawing && current.rememberToolStyles && !writing.current && !isBrush(drawing.type)) {
            const style = toolStyleOf(drawing as unknown as Parameters<typeof toolStyleOf>[0]);
            const saved = current.tools[drawing.type];
            const merged = { ...saved, ...style };
            if (!sameToolStyle(saved, merged)) callbacks.current.onToolStyle(drawing.type, merged);
          }
          edited();
        }),
        instance.on("drawing:snap", ({ mode }) => {
          if (!writing.current && mode !== appearanceRef.current.magnet)
            callbacks.current.onDrawingPrefs({ magnet: mode as SnapMode });
        }),
        instance.on("drawing:stay", ({ on }) => {
          if (!writing.current && on !== appearanceRef.current.stayInDrawingMode)
            callbacks.current.onDrawingPrefs({ stayInDrawingMode: on });
        }),
        instance.on("drawing:favorites", ({ favorites }) => {
          if (!writing.current && favorites.join() !== appearanceRef.current.favoriteTools.join())
            callbacks.current.onDrawingPrefs({ favoriteTools: favorites });
        }),
        instance.renderer.onConfigChanged(() => {
          if (writing.current) return;
          const base = themeBases.current[dark() ? "dark" : "light"];
          const config = instance.renderer.getConfig();
          const zone = (config as { timeScale?: { timezone?: unknown } } | null)?.timeScale
            ?.timezone;
          callbacks.current.onLookEdited({
            style: styleDiff(base, config),
            base,
            timeZone:
              typeof zone === "string" && zone !== appearanceRef.current.timeZone ? zone : null,
          });
        }),
        instance.on("drawing:removed", edited),
        instance.on("drawing:selected", ({ id, ids }) => callbacks.current.onSelect(id, ids)),
        instance.on("drawing:tool", ({ type }) => {
          setTool(type);
          if (!type) armedByPen.current = false;
          // Re-arming the same tool pushes the seeded style to the renderer; no event loops.
          else if (
            QUICK_TOOLS.has(type) &&
            seedStyle(instance, type, prefs.current, appearanceRef.current.tools)
          )
            instance.drawings.setTool(type);
        }),
        instance.on("drawing:mode", ({ mode }) => setErasing(mode === "eraser")),
        instance.on("history:complete", ({ reason, oldestTime }) => {
          const state = history.current;
          state.loading = false;
          state.genesis = reason === "genesis" || reason === "aborted";
          if (oldestTime) state.oldest = oldestTime;
          if (pendingReveal.current) revealNow(instance, pendingReveal.current);
          if (pendingTime.current !== null) showTimeNow(instance, pendingTime.current);
        }),
        instance.on("load:end", ({ bars: loaded }) => {
          if (!loaded) history.current.loading = false;
          // A market switch resets the axis precision; put the chosen one back.
          setTimeout(() => applyPrecision(instance, appearanceRef.current.decimals), 0);
        }),
        instance.on("viewport:changed", ({ from, to }) => {
          // Scrolling near the oldest candle loads more, like any trading chart.
          const state = history.current;
          if (!state.oldest || from > state.oldest + (to - from) * 0.15) return;
          growHistory(instance, state.requested * 2);
        }),
      ];
      if (sync) {
        const following = { current: false };
        offs.push(
          instance.renderer.onCrosshairMove((e) => sync.bus.crosshair(sync.id, e.time)),
          instance.on("viewport:changed", ({ from, to }) => {
            if (!following.current) sync.bus.range(sync.id, { from, to });
          }),
          sync.bus.subscribe(sync.id, {
            crosshair: (time) => instance.renderer.setExternalCrosshair(time, null),
            range: (range) => {
              following.current = true;
              instance.setVisibleRange(range);
              setTimeout(() => (following.current = false), 50);
            },
          }),
        );
      }
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
      const observer = new MutationObserver(() => {
        const next = dark() ? "dark" : "light";
        writing.current = true;
        try {
          instance.setTheme(next);
        } finally {
          writing.current = false;
        }
        // The theme resets its colours; the saved look goes back on top.
        applyLook(instance);
        drawn.repaint();
      });
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
        drawn.dispose();
        if (overlays.current === drawn) overlays.current = null;
        indicatorsSeed.current = indicators.list();
        indicators.dispose();
        if (bridge.current === indicators) bridge.current = null;
        instance.destroy();
        engine.terminate();
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

  useEffect(() => overlays.current?.set(overlay), [overlay]);

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

  // Looks, precision, volume and drawing behaviour follow the preferences in place.
  useEffect(() => {
    const previous = appearanceRef.current;
    appearanceRef.current = appearance;
    const instance = chart.current;
    if (!instance || previous === appearance) return;
    if (previous.style !== appearance.style || previous.timeZone !== appearance.timeZone)
      applyLook(instance);
    if (previous.decimals !== appearance.decimals) applyPrecision(instance, appearance.decimals);
    if (previous.volume !== appearance.volume) {
      const volume = instance.indicators().find((h) => h.nativeType === "volume");
      if (!appearance.volume) volume?.remove();
      else if (!volume) instance.addNativeIndicator("volume");
    }
    applyDrawingPrefs(instance, appearance);
  }, [appearance]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The theme defaults with the look and time zone over them; removed settings revert. */
  function applyLook(instance: Vela) {
    const base = themeBases.current[dark() ? "dark" : "light"];
    if (!base) return;
    const current = appearanceRef.current;
    writing.current = true;
    try {
      instance.renderer.applyConfig(
        mergeStyle(base as StyleDiff, {
          ...current.style,
          timeScale: { timezone: current.timeZone },
        }),
      );
      // The chart type has its own switch: some types (Heikin Ashi) recompute the series.
      const type = (current.style.series as { style?: unknown } | undefined)?.style;
      const wanted = typeof type === "string" ? type : "candles";
      if (instance.renderer.get("priceStyle") !== wanted || type === "heikinashi")
        instance.renderer.set("priceStyle", wanted);
    } finally {
      writing.current = false;
    }
  }

  function applyDrawingPrefs(instance: Vela, current: ChartAppearance) {
    writing.current = true;
    try {
      const api = instance.drawings;
      if (api.getSnapMode() !== current.magnet) api.setSnapMode(current.magnet);
      if (api.getStayMode() !== current.stayInDrawingMode)
        api.setStayMode(current.stayInDrawingMode);
      const favorites = (api as unknown as { favorites?: () => string[] }).favorites?.();
      if (favorites && favorites.join() !== current.favoriteTools.join())
        (api as unknown as { setFavorites?: (t: string[]) => void }).setFavorites?.(
          current.favoriteTools,
        );
      seedToolDefaults(instance, current.tools);
    } finally {
      writing.current = false;
    }
  }

  useEffect(() => {
    const onFullscreen = () => {
      const on = document.fullscreenElement === frame.current;
      setFullscreen(on);
      setPortalTarget(on ? frame.current : null);
    };
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

  function showTimeNow(instance: Vela, time: number) {
    const step = RESOLUTIONS[resolutionRef.current];
    const from = time - step * 40;
    const state = history.current;
    if (
      state.oldest > 0 &&
      from < state.oldest &&
      !state.genesis &&
      state.requested < MAX_CHART_BARS
    ) {
      pendingTime.current = time;
      growHistory(instance, Math.ceil((state.newest - from) / step) + 50);
      if (history.current.loading) return;
    }
    pendingTime.current = null;
    instance.setVisibleRange({ from, to: time + step * 120 });
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
      seedStyle(instance, current, next, appearanceRef.current.tools);
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
    <PortalContainer.Provider value={portalTarget}>
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
            {appearance.palette.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={preference.color === value}
                aria-label={`Ink ${value}`}
                title={`${value} (right-click to remove)`}
                onClick={() => updatePreference({ color: value })}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onDrawingPrefs({ palette: appearance.palette.filter((c) => c !== value) });
                }}
                className={cn(
                  "size-7 rounded-full border-2 transition-transform",
                  preference.color === value ? "scale-110 border-foreground" : "border-transparent",
                )}
                style={{ backgroundColor: value }}
              />
            ))}
            <HoverHint content="Add an ink colour">
              <label className="relative flex size-7 cursor-pointer items-center justify-center rounded-full border border-dashed text-muted-foreground hover:text-foreground">
                <Plus className="size-3.5" aria-hidden="true" />
                <input
                  type="color"
                  aria-label="Add an ink colour"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!isColor(value)) return;
                    updatePreference({ color: value });
                    if (
                      !appearance.palette.includes(value) &&
                      !STYLUS_COLORS.some((c) => c.value === value)
                    )
                      onDrawingPrefs({
                        palette: [...appearance.palette, value].slice(-MAX_PALETTE),
                      });
                  }}
                />
              </label>
            </HoverHint>
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
          {toolbarExtras && (
            <>
              <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
              {toolbarExtras}
            </>
          )}
          <label className="ml-auto flex min-h-8 cursor-pointer items-center gap-2 px-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={preference.penDraws}
              onChange={(event) => updatePreference({ penDraws: event.target.checked })}
            />
            Stylus draws, fingers pan
          </label>
          {sidePanel && (
            <HoverHint
              content={
                sideOpen
                  ? `Hide the ${sidePanel.title.toLowerCase()} panel`
                  : `Show the ${sidePanel.title.toLowerCase()} panel`
              }
            >
              <Button
                type="button"
                size="sm"
                variant={sideOpen ? "secondary" : "ghost"}
                aria-pressed={sideOpen}
                onClick={toggleSide}
                className="h-9 gap-1.5"
              >
                <Layers className="size-4" />
                {sidePanel.title}
                {sidePanel.count !== undefined && (
                  <span className="tnum text-xs text-muted-foreground">{sidePanel.count}</span>
                )}
              </Button>
            </HoverHint>
          )}
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
          className={cn(
            "flex flex-col gap-2 md:flex-row",
            fullscreen ? "min-h-0 flex-1" : "md:h-[min(72vh,680px)] md:min-h-[420px]",
          )}
        >
          <div
            ref={host}
            tabIndex={-1}
            className={cn(
              "journal-analysis-chart min-w-0 overflow-hidden rounded-lg border md:min-h-0 md:flex-1",
              capturing && "cursor-crosshair ring-2 ring-primary",
              fullscreen ? "min-h-0 flex-1" : "h-[min(72vh,680px)] min-h-[420px] md:h-auto",
            )}
          />
          {sidePanel && sideOpen && (
            <aside
              aria-label={sidePanel.title}
              className="flex max-h-[28rem] flex-col rounded-lg border bg-card md:max-h-none md:w-80 md:shrink-0"
            >
              <div className="flex items-center justify-between border-b px-3 py-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {sidePanel.title}
                </span>
                <HoverHint content="Hide this panel">
                  <button
                    type="button"
                    aria-label={`Hide the ${sidePanel.title.toLowerCase()} panel`}
                    onClick={toggleSide}
                    className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <PanelRightClose className="size-4" />
                  </button>
                </HoverHint>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">{sidePanel.content}</div>
            </aside>
          )}
        </div>
        {!fullscreen && (
          <p className="text-xs text-muted-foreground">
            {penSeen
              ? "Stylus detected. The pen tip draws, a pen tap selects a drawing, the eraser end erases, and fingers pan and zoom. Turn off “Stylus draws” to drag drawings with the pen."
              : "Draw with a stylus, mouse or finger after choosing a tool. With a stylus, the pen tip draws without choosing a tool first."}{" "}
            Scroll back for older candles. New drawings go to the active layer.
          </p>
        )}
      </div>
    </PortalContainer.Provider>
  );
}

type Prefs = ReturnType<typeof stylusPreference.read>;

/**
 * The pen and highlighter always use the toolbar ink. Other quick tools use their saved
 * tool style when there is one, otherwise the toolbar ink.
 */
function styleFor(type: DrawingTypeKey, prefs: Prefs, tools: Record<string, ToolStyle> = {}) {
  const ink = {
    lineColor: prefs.color,
    lineWidth: type === "highlighter" ? Math.max(10, prefs.width * 4) : prefs.width,
  };
  const saved = isBrush(type) ? undefined : tools[type];
  // Saved fields win; anything the tool style leaves open keeps the ink.
  return saved ? { ...ink, ...velaStyle(saved) } : ink;
}

/** A saved tool style as Vela drawing style fields. */
function velaStyle(tool: ToolStyle): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (tool.lineColor) out.lineColor = tool.lineColor;
  if (tool.lineWidth) out.lineWidth = tool.lineWidth;
  if (tool.lineStyle) out.lineStyle = tool.lineStyle;
  if (tool.fillColor) out.fillColor = tool.fillColor;
  if (tool.fillOpacity !== undefined) out.fillOpacity = tool.fillOpacity;
  return out;
}

/** Seed Vela's per-tool "last used" style with the saved tool styles. */
function seedToolDefaults(instance: Vela, tools: Record<string, ToolStyle>) {
  const last = lastStyles(instance);
  if (!last) return;
  for (const [type, tool] of Object.entries(tools)) {
    if (isBrush(type)) continue;
    last.set(type, { ...last.get(type), ...velaStyle(tool) });
  }
}

/** Text colour and size have no "last used" seed in Vela, so they are set on creation. */
function applyTextDefaults(
  instance: Vela,
  drawing: SerializedDrawing,
  tool: ToolStyle | undefined,
) {
  if (!drawing.text || !tool || (!tool.textColor && !tool.textSize)) return;
  const text = {
    ...drawing.text,
    ...(tool.textColor ? { color: tool.textColor } : {}),
    ...(tool.textSize ? { size: tool.textSize } : {}),
  };
  const internals = (instance.drawings as unknown as DrawingsInternals).ctrl;
  const stored = internals?.store?.get?.(drawing.id) as { text?: unknown } | undefined;
  if (stored && typeof internals?.sync === "function") {
    // In place, so creating a text drawing stays one undo step.
    stored.text = text;
    internals.sync();
  } else instance.drawings.update(drawing.id, { text });
}

/** Tick size for the price axis: Vela's renderer takes it directly. */
function applyPrecision(instance: Vela, decimals: number | undefined) {
  const port = (
    instance.renderer as unknown as {
      renderer?: { setPricePrecision?: (tick: number | undefined) => void };
    }
  ).renderer;
  port?.setPricePrecision?.(tickForDecimals(decimals));
}

/** Vela keeps a per-tool "last used" style that seeds new drawings; it has no public
 *  setter, so the palette writes it when present and falls back to per-drawing styling. */
const lastStyles = (instance: Vela) => {
  const last = (instance.drawings as unknown as DrawingsInternals).ctrl?.lastStyle;
  return last instanceof Map ? (last as Map<string, Record<string, unknown>>) : null;
};
const canSeedStyle = (instance: Vela) => lastStyles(instance) !== null;
function seedStyle(
  instance: Vela,
  type: DrawingTypeKey,
  prefs: Prefs,
  tools: Record<string, ToolStyle>,
): boolean {
  const last = lastStyles(instance);
  if (!last) return false;
  const style = styleFor(type, prefs, tools);
  const current = last.get(type);
  if (Object.entries(style).every(([key, value]) => current?.[key] === value)) return false;
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
