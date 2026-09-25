"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { DrawingTypeKey, Vela } from "@luxalgo/vela";
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
import type { MarketHistory } from "@/lib/market-data";
import { VELA_TIMEFRAME, type DrawingsDocument } from "@/lib/chart-analysis";
import { STYLUS_COLORS, STYLUS_WIDTHS, isBrush, stylusPreference } from "@/lib/stylus";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { HoverHint } from "./ui/tooltip";

export interface AnalysisChartHandle {
  drawings(): DrawingsDocument;
  /** PNG data URL of candles plus drawings, or null when the renderer can't export. */
  screenshot(): string | null;
  visibleRange(): { from: number; to: number } | null;
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

/** The stylus eraser end reports button 5 on press and bit 32 in `buttons` while held. */
const isEraserTip = (event: PointerEvent) =>
  event.pointerType === "pen" && (event.button === 5 || (event.buttons & 32) !== 0);

type DrawingsInternals = { ctrl?: { lastStyle?: unknown } };

/**
 * A market chart on Vela with its drawing tools, tuned for a stylus: the pen tip draws
 * (arming the pen when no tool is chosen), its eraser end erases, and fingers keep
 * panning and pinch-zooming. Touches that land while a pen is down are ignored as palm
 * contact. Candles come from `history`; drawings are time+price anchored, so they
 * survive reloads at another resolution or range.
 */
export function AnalysisChart({
  history,
  initialDrawings,
  initialVisible,
  onChange,
  chartRef,
}: {
  history: MarketHistory;
  initialDrawings: DrawingsDocument;
  initialVisible?: { from: number; to: number } | null;
  onChange: () => void;
  chartRef?: Ref<AnalysisChartHandle>;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<Vela | null>(null);
  const seed = useRef({
    drawings: initialDrawings,
    visible: initialVisible,
    resolution: history.resolution,
  });
  const changed = useRef(onChange);
  changed.current = onChange;
  const [preference, setPreference] = useState(stylusPreference.read);
  const prefs = useRef(preference);
  prefs.current = preference;
  const [tool, setTool] = useState<DrawingTypeKey | null>(null);
  const [erasing, setErasing] = useState(false);
  const [undoState, setUndoState] = useState({ undo: false, redo: false });
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState("");
  const [penSeen, setPenSeen] = useState(false);

  useImperativeHandle(chartRef, () => ({
    drawings: () =>
      (chart.current?.drawings.toJSON() as unknown as DrawingsDocument | undefined) ??
      seed.current.drawings,
    screenshot: () => chart.current?.renderer.screenshot() ?? null,
    visibleRange: () => chart.current?.getVisibleRange() ?? null,
  }));

  const armedByPen = useRef(false);

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
      const { drawings, resolution } = seed.current;
      // The same window at another resolution can be a handful of bars; refit instead.
      const visible = resolution === history.resolution ? seed.current.visible : null;
      const instance = new Vela(element, {
        symbol: history.symbol,
        timeframe: VELA_TIMEFRAME[history.resolution],
        data: history.bars,
        live: false,
        theme: dark() ? "dark" : "light",
        priceStyle: "candles",
        volume: true,
        drawings: true,
        ...(visible ? { visibleRange: visible } : {}),
      });
      chart.current = instance;
      instance.drawings.fromJSON(drawings);
      // Drawings-only updates: panning and zooming are not edits.
      const refresh = () =>
        setUndoState({
          undo: instance.drawings.canUndo(),
          redo: instance.drawings.canRedo(),
        });
      const edit = () => {
        refresh();
        changed.current();
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
          edit();
        }),
        instance.on("drawing:edited", edit),
        instance.on("drawing:removed", edit),
        instance.on("drawing:tool", ({ type }) => {
          setTool(type);
          if (!type) armedByPen.current = false;
          // Re-arming the same tool pushes the seeded style to the renderer; no event loops.
          else if (QUICK_TOOLS.has(type) && seedStyle(instance, type, prefs.current))
            instance.drawings.setTool(type);
        }),
        instance.on("drawing:mode", ({ mode }) => setErasing(mode === "eraser")),
      ];
      setTool(instance.drawings.getTool());
      refresh();

      // ── Stylus routing ── capture phase runs before Vela's own pointer handlers.
      const pens = new Set<number>();
      const palms = new Set<number>();
      let press: { id: number; x: number; y: number; created: boolean; armed: boolean } | null =
        null;
      let eraserRestore: { tool: DrawingTypeKey | null; armedByPen: boolean } | null = null;
      let replaying = false;
      offs.push(instance.on("drawing:created", () => press && (press.created = true)));
      const replay = (target: EventTarget, init: PointerEventInit, types: string[]) => {
        replaying = true;
        try {
          for (const type of types)
            target.dispatchEvent(
              new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, ...init }),
            );
        } finally {
          replaying = false;
        }
      };
      const pointerInit = (event: PointerEvent): PointerEventInit => ({
        pointerId: event.pointerId,
        pointerType: "pen",
        isPrimary: event.isPrimary,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        pressure: event.pressure,
      });
      const onDown = (event: PointerEvent) => {
        if (replaying) return;
        const target = event.target;
        if (!(target instanceof HTMLCanvasElement)) return;
        const drawingsApi = instance.drawings;
        if (event.pointerType === "pen") {
          pens.add(event.pointerId);
          setPenSeen(true);
          if (isEraserTip(event)) {
            // Vela only reacts to the primary button: replay the eraser tip as a
            // primary press in eraser mode, then restore the tool on release.
            event.stopImmediatePropagation();
            event.preventDefault();
            eraserRestore = { tool: drawingsApi.getTool(), armedByPen: armedByPen.current };
            drawingsApi.setMode("eraser");
            replay(target, { ...pointerInit(event), button: 0, buttons: 1 }, ["pointerdown"]);
            return;
          }
          let armed = false;
          if (prefs.current.penDraws && !drawingsApi.getTool() && !drawingsApi.getMode()) {
            drawingsApi.setTool(prefs.current.penTool);
            armedByPen.current = true;
            armed = true;
          }
          press = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            created: false,
            armed,
          };
          return;
        }
        if (event.pointerType === "touch" && pens.size) {
          // Palm resting on the screen while the pen writes: hide the whole contact from Vela,
          // or its moves would drag the stroke in progress.
          palms.add(event.pointerId);
          event.stopImmediatePropagation();
          event.preventDefault();
          return;
        }
        if (armedByPen.current && isBrush(drawingsApi.getTool())) {
          // A finger or mouse after the pen pans the chart instead of drawing.
          drawingsApi.setTool(null);
          armedByPen.current = false;
        }
      };
      const onPalm = (event: PointerEvent) => {
        if (!palms.has(event.pointerId)) return;
        if (event.type !== "pointermove") palms.delete(event.pointerId);
        event.stopImmediatePropagation();
        event.preventDefault();
      };
      // On window, bubble phase: Vela has handled the release, and a release outside the
      // chart still clears the pen (a stuck pen would reject every later touch).
      const onUp = (event: PointerEvent) => {
        if (replaying || event.pointerType !== "pen") return;
        pens.delete(event.pointerId);
        if (eraserRestore) {
          const restore = eraserRestore;
          eraserRestore = null;
          instance.drawings.setMode(null);
          if (restore.tool) instance.drawings.setTool(restore.tool);
          armedByPen.current = restore.armedByPen;
          return;
        }
        const tap = press;
        press = null;
        if (
          !tap ||
          tap.id !== event.pointerId ||
          event.type !== "pointerup" ||
          !tap.armed ||
          tap.created ||
          Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 6
        )
          return;
        // A pen tap that drew nothing selects what is under it, like a mouse click: put the
        // auto-armed pen down and replay the tap to Vela's selection.
        const target = document.elementFromPoint(tap.x, tap.y);
        if (!(target instanceof HTMLCanvasElement) || !element.contains(target)) return;
        instance.drawings.setTool(null);
        armedByPen.current = false;
        replay(target, { ...pointerInit(event), clientX: tap.x, clientY: tap.y, button: 0 }, [
          "pointerdown",
          "pointerup",
        ]);
      };
      const onKey = (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase()))
          requestAnimationFrame(edit);
      };
      element.addEventListener("pointerdown", onDown, { capture: true });
      for (const type of ["pointermove", "pointerup", "pointercancel"] as const)
        element.addEventListener(type, onPalm, { capture: true });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      element.addEventListener("keydown", onKey);
      const observer = new MutationObserver(() => instance.setTheme(dark() ? "dark" : "light"));
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      const resize = new ResizeObserver(() => instance.resize());
      resize.observe(element);
      cleanup = () => {
        offs.forEach((off) => off());
        element.removeEventListener("pointerdown", onDown, { capture: true });
        for (const type of ["pointermove", "pointerup", "pointercancel"] as const)
          element.removeEventListener(type, onPalm, { capture: true });
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        element.removeEventListener("keydown", onKey);
        observer.disconnect();
        resize.disconnect();
        // Keep the latest drawings for the next mount (a reload at another resolution).
        seed.current = {
          drawings: instance.drawings.toJSON() as unknown as DrawingsDocument,
          visible: instance.getVisibleRange(),
          resolution: history.resolution,
        };
        instance.destroy();
        if (chart.current === instance) chart.current = null;
      };
    })().catch(() => {
      if (!disposed) setError("The chart could not be rendered.");
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [history]);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

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
          onClick={() => {
            const api = drawingsApi();
            if (!api) return;
            api.setMode(erasing ? null : "eraser");
          }}
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
            changed.current();
            setUndoState({
              undo: Boolean(drawingsApi()?.canUndo()),
              redo: Boolean(drawingsApi()?.canRedo()),
            });
          }}
          icon={Undo2}
        />
        <ToolButton
          label="Redo"
          disabled={!undoState.redo}
          onClick={() => {
            drawingsApi()?.redo();
            changed.current();
            setUndoState({
              undo: Boolean(drawingsApi()?.canUndo()),
              redo: Boolean(drawingsApi()?.canRedo()),
            });
          }}
          icon={Redo2}
        />
        <ToolButton
          label="Clear all drawings"
          onClick={() => {
            const api = drawingsApi();
            const ids = api?.all().map((d) => d.id) ?? [];
            if (!api || !ids.length || !confirm("Remove every drawing from this chart?")) return;
            api.removeMany(ids);
            changed.current();
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
          Tap a drawing to change its style; the chart's side toolbar has Fibonacci, channel,
          pattern and measuring tools.
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
