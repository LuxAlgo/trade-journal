import { drawingLabel, type StoredDrawing } from "./chart-analysis";
import {
  drawingName,
  drawingTree,
  effectiveDrawing,
  type DrawingNode,
  type LayersDocument,
} from "./chart-layers";
import { LEGACY_PROP, PATTERN_FIXES } from "./pattern-fixes";
import { degreeLabel, isWaveDegree, WAVE_DEGREES } from "./wave-degrees";

/**
 * A chart analysis's drawings as plain text with their prices, for AI reviews. Vision
 * models read chart pictures poorly, so each drawing is described by what defines it: a
 * level's price, a line's two points, a Fibonacci tool's level prices, an Elliott count's
 * labelled points and degree, with the name you gave it and where it sits in the layer
 * tree (sub-waves under their wave, numbered like the Layers panel).
 */

export const MAX_DESCRIBED_DRAWINGS = 150;
const MAX_POINTS = 8;

/** A price with the digits that matter: 84210.5, 1.0843, 0.00001234. */
export const fmtPrice = (price: number) =>
  Number.isFinite(price) ? String(Number(price.toPrecision(8))) : "?";

/** UTC minute, as the rest of the AI context: "2026-09-26 14:30". */
export const fmtTime = (time: number) =>
  Number.isFinite(time) ? new Date(time).toISOString().slice(0, 16).replace("T", " ") : "?";

const point = (p: { time: number; price: number }) => `${fmtPrice(p.price)} at ${fmtTime(p.time)}`;

interface FibLevel {
  ratio: number;
  enabled?: boolean;
  label?: string;
}

const fibLevels = (drawing: StoredDrawing): FibLevel[] => {
  const levels = (drawing.props as { levels?: unknown } | undefined)?.levels;
  return Array.isArray(levels)
    ? levels.filter(
        (l): l is FibLevel =>
          Boolean(l) &&
          typeof (l as FibLevel).ratio === "number" &&
          (l as FibLevel).enabled !== false,
      )
    : [];
};

/**
 * The prices a Fibonacci tool draws, as Vela computes them: retracements and extensions
 * measure from the first point towards the second; the trend-based extension projects the
 * first move from the third point.
 */
export function fibPrices(
  drawing: StoredDrawing,
): { ratio: number; price: number; label?: string }[] {
  const [a, b, c] = drawing.anchors;
  if (!a || !b) return [];
  const base = drawing.type === "fibextensiontrend" ? c : a;
  if (!base) return [];
  const move = b.price - a.price;
  return fibLevels(drawing).map((level) => ({
    ratio: level.ratio,
    price: base.price + level.ratio * move,
    ...(level.label ? { label: level.label } : {}),
  }));
}

const FIB_TOOLS = new Set(["fibretracement", "fibextension", "fibextensiontrend"]);

/** Point labels of a pattern drawing, in the notation of its wave degree. */
function patternLabels(drawing: StoredDrawing): string[] | null {
  const fix = PATTERN_FIXES.find((f) => f.type === drawing.type);
  if (!fix) return null;
  const props = (drawing.props ?? {}) as Record<string, unknown>;
  const base = props[LEGACY_PROP] === true && fix.legacyLabels ? fix.legacyLabels : fix.labels;
  const degree = isWaveDegree(props.degree) ? props.degree : undefined;
  return degree ? base.map((label) => degreeLabel(label, degree)) : base;
}

const degreeName = (drawing: StoredDrawing) => {
  const degree = (drawing.props as { degree?: unknown } | undefined)?.degree;
  return isWaveDegree(degree)
    ? WAVE_DEGREES.find((d) => d.value === degree)!.label.split(" ")[0]
    : null;
};

/** What defines one drawing, after its name. */
export function drawingFacts(drawing: StoredDrawing): string {
  const anchors = drawing.anchors;
  const [a, b] = anchors;
  const text = drawingWords(drawing)?.trim();
  const words = text ? ` "${text.slice(0, 120)}"` : "";
  if (!a) return words.trim() || "no points";
  switch (drawing.type) {
    case "hline":
    case "pricelabel":
    case "pricenote":
      return `at ${fmtPrice(a.price)}${words}`;
    case "hray":
      return `at ${fmtPrice(a.price)} from ${fmtTime(a.time)}${words}`;
    case "vline":
      return `at ${fmtTime(a.time)}${words}`;
    case "box":
    case "ellipse":
    case "rotatedrect":
      if (!b) break;
      return `${fmtPrice(Math.min(a.price, b.price))} to ${fmtPrice(Math.max(a.price, b.price))}, ${fmtTime(Math.min(a.time, b.time))} to ${fmtTime(Math.max(a.time, b.time))}${words}`;
    case "freehand":
    case "highlighter": {
      let low = Infinity;
      let high = -Infinity;
      for (const p of anchors) {
        if (p.price < low) low = p.price;
        if (p.price > high) high = p.price;
      }
      return `stroke between ${fmtPrice(low)} and ${fmtPrice(high)}, ${fmtTime(a.time)} to ${fmtTime(anchors.at(-1)!.time)}`;
    }
  }
  if (FIB_TOOLS.has(drawing.type)) {
    const levels = fibPrices(drawing)
      .map((l) => `${l.ratio}${l.label ? ` "${l.label}"` : ""} = ${fmtPrice(l.price)}`)
      .join(", ");
    const points = anchors.slice(0, 3).map(point).join(" → ");
    return `${points}; levels ${levels || "none shown"}${words}`;
  }
  const labels = patternLabels(drawing);
  if (labels) {
    const degree = degreeName(drawing);
    const points = anchors
      .slice(0, labels.length)
      .map((p, i) => `${labels[i] ?? i} ${point(p)}`)
      .join(", ");
    return `${degree ? `${degree} degree: ` : ""}${points}${words}`;
  }
  const shown = anchors.slice(0, MAX_POINTS).map(point).join(" → ");
  const more = anchors.length > MAX_POINTS ? ` (+${anchors.length - MAX_POINTS} points)` : "";
  return `${shown}${more}${words}`;
}

/** The words written on a drawing (text tools, labelled shapes), if any. */
const drawingWords = (drawing: StoredDrawing) => {
  const text = drawing.text;
  const value = typeof text === "object" && text ? (text as { value?: unknown }).value : undefined;
  return typeof value === "string" ? value : undefined;
};

/**
 * Every shown drawing, one per line, in the Layers panel's order: grouped by layer, nested
 * drawings indented under the one they sit in, with its outline number. Hidden drawings
 * (by themselves or their layer) are left out, with what is inside them, and counted.
 */
export function describeDrawings(
  drawings: StoredDrawing[],
  layers: LayersDocument,
): { lines: string[]; hidden: number; omitted: number } {
  const byId = new Map(drawings.map((d) => [d.id, d]));
  const ids = drawings.map((d) => d.id);
  // What is drawn counts, not what a temporary focus happens to show.
  const unfocused: LayersDocument = { ...layers, focusId: undefined };
  const lines: string[] = [];
  let hidden = 0;
  let omitted = 0;
  const visit = (node: DrawingNode, layer: string) => {
    const drawing = byId.get(node.id);
    if (!drawing) return;
    if (drawing.visible === false || !effectiveDrawing(unfocused, drawing.id).visible) {
      hidden += 1 + countNested(node);
      return;
    }
    if (lines.length >= MAX_DESCRIBED_DRAWINGS) omitted += 1;
    else {
      const type = drawingLabel(drawing.type);
      const name = drawingName(layers, drawing.id);
      const title = name ? `${type} "${name}"` : type;
      lines.push(
        `${"  ".repeat(node.depth)}${node.index} ${title} [${layer}]: ${drawingFacts(drawing)}`,
      );
    }
    for (const child of node.children) visit(child, layer);
  };
  for (const layer of layers.layers)
    for (const node of drawingTree(layers, layer.id, ids)) visit(node, layer.name);
  return { lines, hidden, omitted };
}

const countNested = (node: DrawingNode): number =>
  node.children.reduce((n, child) => n + 1 + countNested(child), 0);
