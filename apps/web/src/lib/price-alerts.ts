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

/** The side of a line a price was last strictly on, per drawing id. */
export type LineSides = Map<string, 1 | -1>;

/**
 * Lines crossed between two consecutive closes: the close moved strictly to the other side
 * of the line (priced at each close's time, so a sloped line passing a flat price counts).
 * Touching the line and going back is not a crossing; resting on it and then leaving on
 * the other side counts once. `sides` remembers the last strict side of each line across
 * calls; without it a close exactly on the line has no side and the move off it is missed.
 */
export function lineCrossings(
  lines: AlertLine[],
  previous: { time: number; close: number },
  next: { time: number; close: number },
  sides?: LineSides,
): LineCrossing[] {
  if (!Number.isFinite(previous.close) || !Number.isFinite(next.close)) return [];
  const crossings: LineCrossing[] = [];
  for (const line of lines) {
    if (line.visible === false || !ALERT_TYPES.has(line.type)) continue;
    const before = linePriceAt(line, previous.time);
    const after = linePriceAt(line, next.time);
    if (before === null || after === null) continue;
    // A strict side at the previous close wins over the remembered one (the line may have moved).
    const was = Math.sign(previous.close - before) || (sides?.get(line.id) ?? 0);
    const now = Math.sign(next.close - after);
    if (now === 0) {
      if (was !== 0) sides?.set(line.id, was as 1 | -1);
      continue;
    }
    sides?.set(line.id, now as 1 | -1);
    if (was === 0 || was === now) continue;
    crossings.push({
      drawingId: line.id,
      type: line.type,
      price: after,
      direction: now > 0 ? "up" : "down",
      time: next.time,
    });
  }
  return crossings;
}
