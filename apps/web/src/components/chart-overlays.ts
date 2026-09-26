import type {
  DrawingBox,
  DrawingLabel,
  DrawingLine,
  MarkGroup,
  OHLCV,
  TimelineMark,
  Vela,
} from "@luxalgo/vela";
import {
  visibleTrades,
  type ChartMissedTrade,
  type ChartOverlayData,
  type ChartTrade,
  type OverlayOptions,
} from "@/lib/chart-overlays";
import { eventSummary, type EconomicEvent } from "@/lib/economic-calendar";
import { MARKET_SESSIONS, sessionEvents } from "@/lib/market-sessions";
import { zoneStats, zoneSummary, type SrZone, type ZoneStats } from "@/lib/sr-zones";
import { fmtMoney, fmtNumber } from "@/lib/utils";

type VelaModule = typeof import("@luxalgo/vela");

export interface OverlayState {
  data: ChartOverlayData;
  options: OverlayOptions;
  zones: SrZone[];
  events: EconomicEvent[];
  privacy: boolean;
  /** First edge of a zone being drawn, shown as a guide line. */
  pendingZone: number | null;
}

export interface OverlayHooks {
  onOpenTrade: (key: string) => void;
  onOpenMissed: (id: string) => void;
  onZoneStats: (stats: Record<string, ZoneStats>) => void;
  /** A click on the chart's price pane; return true when a capture mode used it. */
  onChartClick: (point: { time: number; price: number }) => boolean;
  /** Whether a drawing tool or eraser owns clicks right now. */
  drawingActive: () => boolean;
}

const PANE = "price";
const COLORS = {
  buy: "#16a34a",
  sell: "#dc2626",
  win: "#16a34a",
  loss: "#dc2626",
  even: "#737373",
  open: "#2962ff",
  missed: "#a855f7",
  support: "22, 163, 74",
  resistance: "225, 29, 72",
};
const IMPACT_GLYPH = {
  High: { color: "#f97316", shape: "pin" as const },
  Medium: { color: "#eab308", shape: "circle" as const },
  Low: { color: "#94a3b8", shape: "circle" as const },
  Holiday: { color: "#64748b", shape: "square" as const },
};
const GROUPS: MarkGroup[] = [
  { id: "trades", label: "My trades" },
  { id: "trades-open", label: "Open positions", parent: "trades" },
  { id: "trades-closed", label: "Closed trades", parent: "trades" },
  { id: "missed", label: "Missed trades" },
  { id: "sessions", label: "Market sessions" },
  ...MARKET_SESSIONS.map((s) => ({ id: `session-${s.id}`, label: s.label, parent: "sessions" })),
  { id: "economic", label: "Economic calendar" },
  ...(["High", "Medium", "Low", "Holiday"] as const).map((impact) => ({
    id: `economic-${impact}`,
    label: impact === "Holiday" ? "Bank holidays" : `${impact} impact`,
    parent: "economic",
  })),
];

const label = (
  partial: Partial<DrawingLabel> & Pick<DrawingLabel, "id" | "x" | "y">,
): DrawingLabel => ({
  paneId: PANE,
  xloc: "bar_time",
  yloc: "price",
  style: "label_left",
  size: "small",
  textAlign: "left",
  fontFamily: "default",
  overlay: true,
  ...partial,
});
const line = (
  partial: Partial<DrawingLine> & Pick<DrawingLine, "id" | "x1" | "y1" | "x2" | "y2">,
): DrawingLine => ({
  paneId: PANE,
  xloc: "bar_time",
  extend: "none",
  invisible: false,
  width: 1,
  style: "dashed",
  arrowLeft: false,
  arrowRight: false,
  overlay: true,
  ...partial,
});

const resultColor = (t: ChartTrade) =>
  t.status === "open"
    ? COLORS.open
    : t.status === "win"
      ? COLORS.win
      : t.status === "loss"
        ? COLORS.loss
        : COLORS.even;
const resultWord = (t: ChartTrade) =>
  t.status === "open" ? "OPEN" : t.status === "win" ? "WIN" : t.status === "loss" ? "LOSS" : "EVEN";
const tradeTitle = (t: ChartTrade) => `${t.symbol} ${t.direction.toUpperCase()} · ${resultWord(t)}`;

let seq = 0;

/**
 * Journal overlays on a Vela chart: trades, missed trades and zones are painted by one
 * native indicator (kept out of the legend so it can't be removed by accident);
 * trades, missed trades, sessions and economic events also get timeline marks, which
 * are what a click opens.
 */
export function createChartOverlays(
  vela: VelaModule,
  instance: Vela,
  element: HTMLElement,
  hooks: OverlayHooks,
  initial: OverlayState,
) {
  let state = initial;
  let ctx: { emit(out: object): void; bars(): readonly OHLCV[] } | null = null;
  let bars: readonly OHLCV[] = [];
  const type = `journal-overlays-${(seq += 1)}-${Date.now().toString(36)}`;
  const dark = () => document.documentElement.classList.contains("dark");
  const step = () => vela.timeframeToMs(instance.market.timeframe ?? "60");
  /** Labels near the latest candle open to the left so the price axis never clips them. */
  const sideFor = (time: number): DrawingLabel["style"] =>
    time > (bars.at(-1)?.time ?? Date.now()) - step() * 25 ? "label_right" : "label_left";

  const tradeLabels = (trades: ChartTrade[]) => {
    const labels: DrawingLabel[] = [];
    const lines: DrawingLine[] = [];
    const ink = dark() ? "#f4f4f2" : "#0b0b0b";
    for (const t of trades) {
      const tip = `${tradeTitle(t)}${t.account ? ` · ${t.account}` : ""} · click to open`;
      t.fills.forEach((fill, i) =>
        labels.push(
          label({
            id: `fill-${t.key}-${i}`,
            x: fill.time,
            y: fill.price,
            yloc: "price",
            style: fill.side === "buy" ? "triangleup" : "triangledown",
            color: fill.side === "buy" ? COLORS.buy : COLORS.sell,
            textColor: ink,
            text: `${fill.side === "buy" ? "B" : "S"} ${fmtNumber(fill.quantity, 4)}`,
            size: "tiny",
            tooltip: `${fill.side.toUpperCase()} ${fill.quantity} @ ${fill.price} · ${tip}`,
          }),
        ),
      );
      const opened = Date.parse(t.openedAt);
      if (t.status !== "open" && t.closedAt && t.avgExit !== null) {
        const closed = Date.parse(t.closedAt);
        lines.push(
          line({
            id: `path-${t.key}`,
            x1: opened,
            y1: t.avgEntry,
            x2: closed,
            y2: t.avgExit,
            color: resultColor(t),
            arrowRight: true,
          }),
        );
        labels.push(
          label({
            id: `result-${t.key}`,
            x: closed,
            y: t.avgExit,
            style: sideFor(closed),
            color: resultColor(t),
            textColor: "#ffffff",
            // Signed text and the word carry the result; color only reinforces it.
            text: state.privacy
              ? resultWord(t)
              : `${resultWord(t)} ${fmtMoney(t.netPnl, t.currency)}`,
            tooltip: tip,
          }),
        );
      } else {
        const right = opened + step() * 30;
        lines.push(
          line({
            id: `open-${t.key}`,
            x1: opened,
            y1: t.avgEntry,
            x2: right,
            y2: t.avgEntry,
            extend: "right",
            style: "dotted",
            color: COLORS.open,
            width: 2,
          }),
        );
        labels.push(
          label({
            id: `open-label-${t.key}`,
            x: opened,
            y: t.avgEntry,
            style: sideFor(opened),
            color: COLORS.open,
            textColor: "#ffffff",
            text: `OPEN ${t.direction.toUpperCase()} ${fmtNumber(t.openQuantity, 4)} @ ${state.privacy ? "•••" : fmtNumber(t.avgEntry)}`,
            tooltip: tip,
          }),
        );
        for (const [kind, price] of [
          ["SL", t.stopLoss],
          ["TP", t.profitTarget],
        ] as const)
          if (price !== null) {
            lines.push(
              line({
                id: `${kind}-${t.key}`,
                x1: opened,
                y1: price,
                x2: right,
                y2: price,
                extend: "right",
                color: kind === "SL" ? COLORS.loss : COLORS.win,
              }),
            );
            labels.push(
              label({
                id: `${kind}-label-${t.key}`,
                x: opened,
                y: price,
                color: "transparent",
                noFill: true,
                textColor: kind === "SL" ? COLORS.loss : COLORS.win,
                text: kind,
                style: "label_right",
              }),
            );
          }
      }
    }
    return { labels, lines };
  };

  const missedLabels = (missed: ChartMissedTrade[]) => {
    const labels: DrawingLabel[] = [];
    const lines: DrawingLine[] = [];
    for (const m of missed) {
      if (m.entry === null) continue;
      const at = Date.parse(m.observedAt);
      const right = at + step() * 20;
      labels.push(
        label({
          id: `missed-${m.id}`,
          x: at,
          y: m.entry,
          style: "diamond",
          color: COLORS.missed,
          textColor: COLORS.missed,
          text: `MISSED ${m.direction.toUpperCase()}`,
          tooltip: `Missed ${m.direction} @ ${m.entry}${m.notes ? ` · ${m.notes.slice(0, 120)}` : ""} · click to open`,
        }),
      );
      for (const [kind, price] of [
        ["entry", m.entry],
        ["stop", m.stop],
        ["target", m.target],
      ] as const)
        if (price !== null)
          lines.push(
            line({
              id: `missed-${kind}-${m.id}`,
              x1: at,
              y1: price,
              x2: right,
              y2: price,
              style: "dotted",
              color: COLORS.missed,
              width: kind === "entry" ? 2 : 1,
            }),
          );
    }
    return { labels, lines };
  };

  const zoneShapes = () => {
    const boxes: DrawingBox[] = [];
    const lines: DrawingLine[] = [];
    const stats: Record<string, ZoneStats> = {};
    const lastTime = bars.at(-1)?.time ?? Date.now();
    for (const zone of state.zones) {
      const s = zoneStats(zone, bars);
      stats[zone.id] = s;
      if (!zone.visible || !state.options.zones) continue;
      const rgb = s.role === "support" ? COLORS.support : COLORS.resistance;
      const faded = s.status === "broken";
      boxes.push({
        id: `zone-${zone.id}`,
        paneId: PANE,
        xloc: "bar_time",
        left: zone.start,
        right: Math.max(lastTime, zone.start + step()),
        top: zone.high,
        bottom: zone.low,
        extend: "right",
        bgColor: `rgba(${rgb}, ${faded ? 0.06 : 0.14})`,
        borderColor: `rgba(${rgb}, ${faded ? 0.35 : 0.7})`,
        borderWidth: 1,
        borderStyle: faded ? "dotted" : "dashed",
        text: zoneSummary(zone, s, (n) => fmtNumber(n)),
        textColor: dark() ? "#e5e5e5" : "#171717",
        textSize: "small",
        hAlign: "left",
        vAlign: "top",
        wrap: false,
        fontFamily: "default",
        bold: false,
        italic: false,
        overlay: true,
      });
    }
    if (state.pendingZone !== null && bars.length)
      lines.push(
        line({
          id: "zone-pending",
          x1: bars[0]!.time,
          y1: state.pendingZone,
          x2: lastTime,
          y2: state.pendingZone,
          extend: "both",
          color: dark() ? "#e5e5e5" : "#171717",
        }),
      );
    hooks.onZoneStats(stats);
    return { boxes, lines };
  };

  const emit = () => {
    if (!ctx) return;
    bars = ctx.bars();
    const trades = tradeLabels(visibleTrades(state.data.trades, state.options));
    const missed = missedLabels(state.options.missed ? state.data.missed : []);
    const zones = zoneShapes();
    ctx.emit({
      labels: [...trades.labels, ...missed.labels],
      lines: [...zones.lines, ...trades.lines, ...missed.lines],
      boxes: zones.boxes,
    });
  };

  const marks = () => {
    if (!instance.marks.supported) return;
    const out: TimelineMark[] = [];
    for (const t of visibleTrades(state.data.trades, state.options)) {
      const time = Date.parse(t.status === "open" ? t.openedAt : (t.closedAt ?? t.openedAt));
      out.push({
        id: `trade:${t.key}`,
        time,
        title: tradeTitle(t),
        tooltip: `${tradeTitle(t)}${state.privacy || t.status === "open" ? "" : ` ${fmtMoney(t.netPnl, t.currency)}`} · click to open`,
        group: t.status === "open" ? "trades-open" : "trades-closed",
        glyph: { shape: "circle", color: resultColor(t), letter: resultWord(t)[0] },
      });
    }
    if (state.options.missed)
      for (const m of state.data.missed)
        out.push({
          id: `missed:${m.id}`,
          time: Date.parse(m.observedAt),
          title: `Missed ${m.direction}`,
          tooltip: `Missed ${m.direction}${m.entry !== null ? ` @ ${m.entry}` : ""} · click to open`,
          group: "missed",
          glyph: { shape: "diamond", color: COLORS.missed, letter: "M" },
        });
    const first = bars[0]?.time;
    const last = bars.at(-1)?.time;
    if (state.options.sessions && first !== undefined && last !== undefined && step() <= 3_600_000)
      for (const e of sessionEvents(first, last + step())) {
        const session = MARKET_SESSIONS.find((s) => s.id === e.session)!;
        out.push({
          id: `session:${e.id}`,
          time: e.time,
          title: `${session.label} ${e.kind === "open" ? "opens" : "closes"}`,
          tooltip: `${session.label} ${e.kind === "open" ? "opens" : "closes"} (${session[e.kind]} local)`,
          group: `session-${e.session}`,
          glyph: {
            shape: e.kind === "open" ? "square" : "circle",
            color: e.kind === "open" ? "#0ea5e9" : "#475569",
            letter: session.letter,
          },
        });
      }
    if (state.options.economic) {
      const currencies = new Set(state.options.economicCurrencies);
      for (const e of state.events) {
        if (!state.options.economicImpact.includes(e.impact)) continue;
        if (currencies.size && !currencies.has(e.currency)) continue;
        out.push({
          id: `econ:${e.id}`,
          time: e.time,
          title: `${e.currency} · ${e.title}`,
          tooltip: eventSummary(e),
          group: `economic-${e.impact}`,
          glyph: { ...IMPACT_GLYPH[e.impact], letter: e.currency.slice(0, 2) },
          content: {
            panel: {
              items: [
                { type: "field", label: "Impact", value: e.impact },
                { type: "field", label: "Time", value: new Date(e.time).toLocaleString() },
                ...(e.forecast
                  ? [{ type: "field" as const, label: "Forecast", value: e.forecast }]
                  : []),
                ...(e.previous
                  ? [{ type: "field" as const, label: "Previous", value: e.previous }]
                  : []),
              ],
            },
          },
        });
      }
    }
    instance.marks.set(out);
  };

  vela.registerNativeIndicator({
    type,
    title: "Journal overlays",
    paneHint: "price",
    overlay: true,
    legend: false,
    inputsSchema: () => [],
    defaultInputs: () => ({}),
    create: () => ({
      start(context) {
        ctx = context as unknown as typeof ctx;
        emit();
        marks();
        context.setStatus("idle");
      },
      onBars() {
        const before = bars.length;
        emit();
        // New history or a new day: sessions depend on the loaded span.
        if (bars.length !== before) marks();
      },
      onViewport() {},
      setInputs() {},
      suspend() {},
      resume() {},
      stop() {
        ctx = null;
      },
    }),
  });
  for (const group of GROUPS) instance.marks.defineGroup(group);
  instance.addNativeIndicator(type);

  // ── Clicks: marks open their record; price markers are hit-tested ──
  const offMark = instance.on("mark:click", ({ id }) => {
    if (id.startsWith("trade:")) hooks.onOpenTrade(id.slice(6));
    else if (id.startsWith("missed:")) hooks.onOpenMissed(id.slice(7));
  });
  let hover: { time: number; price: number } | null = null;
  const offCrosshair = instance.renderer.onCrosshairMove((e) => {
    hover =
      e.time !== null && e.price !== null && e.paneKind === "price"
        ? { time: e.time, price: e.price }
        : null;
  });
  const hitTest = (point: { time: number; price: number }) => {
    const span = step();
    const bar = bars.find((b) => point.time >= b.time && point.time < b.time + span);
    const tolerance = Math.max(
      bar ? (bar.high - bar.low) * 0.6 : 0,
      Math.abs(point.price) * 0.0015,
    );
    let best: { kind: "trade" | "missed"; id: string; score: number } | null = null;
    const consider = (kind: "trade" | "missed", id: string, time: number, price: number) => {
      const dt = Math.abs(time - point.time) / span;
      const dp = Math.abs(price - point.price) / tolerance;
      if (dt <= 1.2 && dp <= 1) {
        const score = dt + dp;
        if (!best || score < best.score) best = { kind, id, score };
      }
    };
    for (const t of visibleTrades(state.data.trades, state.options)) {
      for (const f of t.fills) consider("trade", t.key, f.time, f.price);
      if (t.closedAt && t.avgExit !== null)
        consider("trade", t.key, Date.parse(t.closedAt), t.avgExit);
    }
    if (state.options.missed)
      for (const m of state.data.missed)
        if (m.entry !== null) consider("missed", m.id, Date.parse(m.observedAt), m.entry);
    return best as { kind: "trade" | "missed"; id: string } | null;
  };
  const handleClick = (point: { time: number; price: number }) => {
    if (hooks.drawingActive()) return;
    if (hooks.onChartClick(point)) return;
    const hit = hitTest(point);
    if (hit?.kind === "trade") hooks.onOpenTrade(hit.id);
    else if (hit?.kind === "missed") hooks.onOpenMissed(hit.id);
  };
  // The renderer's own click (taps included, drags and mark clicks excluded) when available;
  // otherwise a DOM click. Neither carries a price, so both use the crosshair's position.
  type ClickPort = {
    onClick?: (cb: (e: { time: number | null; price: number | null }) => void) => () => void;
  };
  const port = (instance.renderer as unknown as { renderer?: ClickPort }).renderer;
  let offClick: () => void;
  if (typeof port?.onClick === "function") {
    offClick = port.onClick((e) => {
      if (e.time !== null && hover) handleClick({ time: e.time, price: e.price ?? hover.price });
    });
  } else {
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      if (e.target instanceof HTMLCanvasElement && hover) handleClick(hover);
    };
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointerup", onUp);
    offClick = () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointerup", onUp);
    };
  }

  return {
    set(patch: Partial<OverlayState>) {
      state = { ...state, ...patch };
      emit();
      marks();
    },
    /** Called on theme changes so label ink follows the theme. */
    repaint() {
      emit();
    },
    dispose() {
      offMark();
      offCrosshair();
      offClick();
      vela.unregisterNativeIndicator(type);
    },
  };
}

export type ChartOverlays = ReturnType<typeof createChartOverlays>;
