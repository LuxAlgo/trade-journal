import type { StoredDrawing } from "./chart-analysis";
import {
  drawingName,
  drawingTree,
  effectiveDrawing,
  type DrawingNode,
  type LayersDocument,
} from "./chart-layers";
import type { MarketBar } from "./market-data";
import { zoneStats, type SrZone } from "./sr-zones";
import { fibPrices, fmtPrice, fmtTime } from "./analysis-text";
import { drawingLabel } from "./chart-analysis";

/**
 * What price did against a chart analysis on one journal day, computed from the day's
 * candles rather than read off a picture: the session's range, and for each horizontal
 * level and zone you drew, whether price touched it, held it or broke it. Levels are judged
 * like the chart's zones (a single price is a zone with no height), so the day page, the AI
 * and the chart agree.
 */

export const MAX_DAY_LEVELS = 40;

export interface DayLevel {
  label: string;
  low: number;
  high: number;
}

export interface LevelOutcome extends DayLevel {
  touches: number;
  breaks: number;
  /** The day's last close relative to the level. */
  closed: "above" | "below" | "inside";
  lastTouch: number | null;
  status: "untouched" | "held" | "broken" | "testing";
}

export interface SessionSummary {
  open: number;
  high: number;
  low: number;
  close: number;
  highTime: number;
  lowTime: number;
  change: number;
  changePct: number;
  range: number;
}

/**
 * The horizontal prices an analysis marks: horizontal lines and rays (rays only once they
 * start), price labels, the shown levels of Fibonacci tools, and visible zones. Hidden
 * drawings and hidden layers are left out, as on the chart.
 */
export function analysisLevels(
  analysis: { drawings: { drawings: StoredDrawing[] }; layers: LayersDocument; zones: SrZone[] },
  dayEnd: number,
): DayLevel[] {
  const out: DayLevel[] = [];
  const layers: LayersDocument = { ...analysis.layers, focusId: undefined };
  const add = (label: string, low: number, high = low) => {
    if (Number.isFinite(low) && Number.isFinite(high) && out.length < MAX_DAY_LEVELS)
      out.push({ label, low: Math.min(low, high), high: Math.max(low, high) });
  };
  // Numbered like the Layers panel (#1, #1.2), so two Fibonacci tools can be told apart.
  const numbers = outlineNumbers(analysis.drawings.drawings, layers);
  for (const drawing of analysis.drawings.drawings) {
    if (drawing.visible === false || !effectiveDrawing(layers, drawing.id).visible) continue;
    const name = drawingName(layers, drawing.id);
    const kind = name ? `${drawingLabel(drawing.type)} "${name}"` : drawingLabel(drawing.type);
    const number = numbers.get(drawing.id);
    const title = number ? `#${number} ${kind}` : kind;
    const [a] = drawing.anchors;
    if (!a) continue;
    if (drawing.type === "hline" || drawing.type === "pricelabel") add(title, a.price);
    else if (drawing.type === "hray" && a.time <= dayEnd) add(title, a.price);
    else if (["fibretracement", "fibextension", "fibextensiontrend"].includes(drawing.type))
      for (const level of fibPrices(drawing))
        add(`${title} ${level.ratio}${level.label ? ` "${level.label}"` : ""}`, level.price);
  }
  for (const zone of analysis.zones)
    if (zone.visible) add(`Zone${zone.label ? ` "${zone.label}"` : ""}`, zone.low, zone.high);
  return out;
}

/** Each drawing's outline number in the Layers panel. */
function outlineNumbers(drawings: StoredDrawing[], layers: LayersDocument) {
  const ids = drawings.map((d) => d.id);
  const numbers = new Map<string, string>();
  const walk = (nodes: DrawingNode[]) =>
    nodes.forEach((node) => {
      numbers.set(node.id, node.index);
      walk(node.children);
    });
  for (const layer of layers.layers) walk(drawingTree(layers, layer.id, ids));
  return numbers;
}

/** How one level fared over the day's candles, judged like a chart zone. */
export function levelOutcome(level: DayLevel, bars: readonly MarketBar[]): LevelOutcome {
  const zone: SrZone = {
    id: "level",
    low: level.low,
    high: level.high,
    kind: "auto",
    label: "",
    start: bars[0]?.time ?? 0,
    visible: true,
  };
  const stats = zoneStats(zone, bars);
  const touched = bars.some((bar) => bar.low <= level.high && bar.high >= level.low);
  const status: LevelOutcome["status"] = !touched
    ? "untouched"
    : stats.status === "broken"
      ? "broken"
      : stats.status === "testing"
        ? "testing"
        : "held";
  return {
    ...level,
    touches: stats.touches,
    breaks: stats.breaks,
    closed: stats.position,
    lastTouch: stats.lastTouch,
    status,
  };
}

export function sessionSummary(bars: readonly MarketBar[]): SessionSummary | null {
  const first = bars[0];
  const last = bars.at(-1);
  if (!first || !last) return null;
  let high = first;
  let low = first;
  for (const bar of bars) {
    if (bar.high > high.high) high = bar;
    if (bar.low < low.low) low = bar;
  }
  const change = last.close - first.open;
  return {
    open: first.open,
    high: high.high,
    low: low.low,
    close: last.close,
    highTime: high.time,
    lowTime: low.time,
    change,
    changePct: first.open ? change / first.open : 0,
    range: high.high - low.low,
  };
}

const levelText = (o: LevelOutcome) => {
  const at = o.low === o.high ? fmtPrice(o.low) : `${fmtPrice(o.low)} to ${fmtPrice(o.high)}`;
  const what =
    o.status === "untouched"
      ? "not reached"
      : o.status === "broken"
        ? `broken (${o.breaks} close${o.breaks === 1 ? "" : "s"} through)`
        : o.status === "testing"
          ? "price closed the day inside it"
          : `held (${o.touches} rejection${o.touches === 1 ? "" : "s"})`;
  return `${o.label} ${at}: ${what}, day closed ${o.closed}${o.lastTouch !== null ? `, last touch ${fmtTime(o.lastTouch)}` : ""}`;
};

/** The day's price action against the analysis, as text for the AI and the day page. */
export function describeDay(
  summary: SessionSummary,
  outcomes: LevelOutcome[],
  averageRange: number | null,
): string {
  const vsAverage =
    averageRange && averageRange > 0
      ? `, ${(summary.range / averageRange).toFixed(2)}x the average daily range of the previous days`
      : "";
  const lines = [
    `Session: open ${fmtPrice(summary.open)}, high ${fmtPrice(summary.high)} at ${fmtTime(summary.highTime)}, low ${fmtPrice(summary.low)} at ${fmtTime(summary.lowTime)}, close ${fmtPrice(summary.close)} (${summary.change >= 0 ? "+" : ""}${(summary.changePct * 100).toFixed(2)}%), range ${fmtPrice(summary.range)}${vsAverage}`,
  ];
  if (outcomes.length) {
    const reached = outcomes.filter((o) => o.status !== "untouched").length;
    lines.push(`Levels from the analysis: ${reached} of ${outcomes.length} reached`);
    for (const outcome of outcomes) lines.push(`- ${levelText(outcome)}`);
  } else
    lines.push("Levels from the analysis: none (no horizontal levels, Fibonacci levels or zones)");
  return lines.join("\n");
}
