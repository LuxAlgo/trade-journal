/**
 * Line alerts for live charts: a live close that crosses a drawn line. Horizontal lines
 * are a fixed price; trend lines are priced at the tick's time along the line.
 */

export interface AlertLine {
  id: string;
  type: string;
  anchors: { time: number; price: number }[];
  visible?: boolean;
}

export interface LineCrossing {
  drawingId: string;
  type: string;
  price: number;
  direction: "up" | "down";
  time: number;
}

export const ALERT_TYPES = new Set(["hline", "hray", "trendline", "ray", "extendedline"]);

/** The line's price at `time`, or null where the drawing does not reach. */
export function linePriceAt(line: AlertLine, time: number): number | null {
  const [a, b] = line.anchors;
  if (!a) return null;
  if (line.type === "hline") return a.price;
  if (line.type === "hray") return time >= a.time ? a.price : null;
  if (!b || b.time === a.time) return null;
  const [start, end] = a.time <= b.time ? [a, b] : [b, a];
  const price = a.price + ((b.price - a.price) * (time - a.time)) / (b.time - a.time);
  if (line.type === "extendedline") return price;
  if (line.type === "ray") {
    // A ray starts at its first anchor and runs through the second.
    return (b.time > a.time ? time >= a.time : time <= a.time) ? price : null;
  }
  if (line.type === "trendline") return time >= start.time && time <= end.time ? price : null;
  return null;
}

/**
 * Lines crossed between two consecutive closes. Touching the line from one side and
 * leaving on the other counts once; resting exactly on it does not repeat.
 */
export function lineCrossings(
  lines: AlertLine[],
  previous: { time: number; close: number },
  next: { time: number; close: number },
): LineCrossing[] {
  if (!Number.isFinite(previous.close) || !Number.isFinite(next.close)) return [];
  if (previous.close === next.close) return [];
  const crossings: LineCrossing[] = [];
  for (const line of lines) {
    if (line.visible === false || !ALERT_TYPES.has(line.type)) continue;
    const before = linePriceAt(line, previous.time);
    const after = linePriceAt(line, next.time);
    if (before === null || after === null) continue;
    if (previous.close < before && next.close >= after)
      crossings.push({
        drawingId: line.id,
        type: line.type,
        price: after,
        direction: "up",
        time: next.time,
      });
    else if (previous.close > before && next.close <= after)
      crossings.push({
        drawingId: line.id,
        type: line.type,
        price: after,
        direction: "down",
        time: next.time,
      });
  }
  return crossings;
}
