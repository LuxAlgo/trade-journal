/**
 * Support and resistance zones: price ranges, not boxes. A zone runs from where it was
 * drawn to the present at every candle size. Its role comes from price: above the
 * zone it is support, below it resistance. Candles that enter the zone and leave on
 * the side they came from are touches (rejections); a close through the zone breaks it,
 * and a broken zone flips role (old support becomes resistance), as traders read them.
 */
export type ZoneKind = "auto" | "support" | "resistance";

export interface SrZone {
  id: string;
  low: number;
  high: number;
  kind: ZoneKind;
  label: string;
  /** Epoch ms the zone starts counting from (where it was drawn). */
  start: number;
  visible: boolean;
}

export interface ZoneStats {
  role: "support" | "resistance";
  /** Where the last close sits relative to the zone. */
  position: "above" | "below" | "inside";
  touches: number;
  breaks: number;
  lastTouch: number | null;
  status: "holding" | "testing" | "broken";
}

export const MAX_ZONES = 100;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

interface Bar {
  time: number;
  high: number;
  low: number;
  close: number;
}

const sideOf = (price: number, zone: Pick<SrZone, "low" | "high">) =>
  price > zone.high ? "above" : price < zone.low ? "below" : "inside";

/** A zone's behaviour over the candles since it was drawn. */
export function zoneStats(zone: SrZone, bars: readonly Bar[]): ZoneStats {
  let touches = 0;
  let breaks = 0;
  let lastTouch: number | null = null;
  let lastBreak = -Infinity;
  // The side price came from before entering the zone.
  let origin: "above" | "below" | null = null;
  let previous: "above" | "below" | "inside" | null = null;
  for (const bar of bars) {
    if (bar.time < zone.start) continue;
    const side = sideOf(bar.close, zone);
    const entered = bar.low <= zone.high && bar.high >= zone.low;
    if (previous === null) {
      previous = side;
      origin = side === "inside" ? null : side;
      continue;
    }
    if (side === "inside") {
      if (previous !== "inside") origin = previous;
    } else {
      const from: "above" | "below" | null = previous === "inside" ? origin : previous;
      if (from && from !== side) {
        breaks += 1;
        lastBreak = bar.time;
      } else if (entered || previous === "inside") {
        // Wicked into the zone (or closed inside) and left on the same side: a rejection.
        touches += 1;
        lastTouch = bar.time;
      }
      origin = side;
    }
    previous = side;
  }
  const last = bars.at(-1);
  const position = last && last.time >= zone.start ? sideOf(last.close, zone) : "inside";
  const reference = position === "inside" ? (origin ?? "above") : position;
  const role =
    zone.kind === "auto" ? (reference === "above" ? "support" : "resistance") : zone.kind;
  const status =
    position === "inside" ? "testing" : lastBreak > (lastTouch ?? -Infinity) ? "broken" : "holding";
  return { role, position, touches, breaks, lastTouch, status };
}

export interface ZoneEvent {
  zoneId: string;
  /** `enter`: price moved into the zone. `break`: it left on the far side from where it entered. */
  kind: "enter" | "break";
  direction: "up" | "down";
}

/**
 * Alerts between two consecutive closes. `origins` remembers, per zone, the side price
 * entered from, so leaving the far side is a break and leaving the same side (a
 * rejection) raises nothing. Pass the same map on every tick.
 */
export function zoneEvents(
  zones: readonly SrZone[],
  previousClose: number,
  close: number,
  origins: Map<string, "above" | "below">,
): ZoneEvent[] {
  const events: ZoneEvent[] = [];
  const direction = close >= previousClose ? "up" : "down";
  for (const zone of zones) {
    if (!zone.visible) continue;
    const before = sideOf(previousClose, zone);
    const after = sideOf(close, zone);
    if (before !== "inside") origins.set(zone.id, before);
    if (before === after) continue;
    if (after === "inside") events.push({ zoneId: zone.id, kind: "enter", direction });
    else if (before !== "inside" || (origins.get(zone.id) ?? after) !== after)
      events.push({ zoneId: zone.id, kind: "break", direction });
    if (after !== "inside") origins.set(zone.id, after);
  }
  return events;
}

/** Label for lists and the chart: role, range and behaviour. */
export function zoneSummary(zone: SrZone, stats: ZoneStats, format: (n: number) => string) {
  const role = stats.role === "support" ? "Support" : "Resistance";
  const touches = `${stats.touches} touch${stats.touches === 1 ? "" : "es"}`;
  const status =
    stats.status === "broken" ? "broken" : stats.status === "testing" ? "testing" : "holding";
  return `${zone.label ? `${zone.label} · ` : ""}${role} ${format(zone.low)}–${format(zone.high)} · ${touches} · ${status}`;
}

export function zonesProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return "Zones must be a list.";
  if (value.length > MAX_ZONES) return `Keep at most ${MAX_ZONES} zones per chart.`;
  const ids = new Set<string>();
  for (const item of value as unknown[]) {
    const z = item as Partial<SrZone> | null;
    if (!z || typeof z.id !== "string" || !ID.test(z.id) || ids.has(z.id))
      return "A zone has an invalid id.";
    ids.add(z.id);
    if (
      !Number.isFinite(z.low) ||
      !Number.isFinite(z.high) ||
      (z.low as number) >= (z.high as number)
    )
      return "A zone needs a low below its high.";
    if (!["auto", "support", "resistance"].includes(z.kind as string))
      return "A zone has an invalid kind.";
    if (typeof z.label !== "string" || z.label.length > 80) return "A zone label is invalid.";
    if (!Number.isSafeInteger(z.start)) return "A zone has an invalid start.";
    if (typeof z.visible !== "boolean") return "A zone has invalid visibility.";
  }
  return null;
}

export const parseZones = (json: string | null | undefined): SrZone[] => {
  if (!json) return [];
  try {
    const value = JSON.parse(json) as unknown;
    return zonesProblem(value) ? [] : (value as SrZone[]);
  } catch {
    return [];
  }
};

/** A zone between two clicked prices, starting at the earlier click. */
export function zoneFromClicks(
  id: string,
  a: { time: number; price: number },
  b: { time: number; price: number },
): SrZone {
  const low = Math.min(a.price, b.price);
  let high = Math.max(a.price, b.price);
  // Two clicks at one price still make a usable band (0.05% wide).
  if (high - low < Math.abs(high) * 0.0005) high = low + Math.max(Math.abs(low) * 0.0005, 1e-9);
  return {
    id,
    low,
    high,
    kind: "auto",
    label: "",
    start: Math.round(Math.min(a.time, b.time)),
    visible: true,
  };
}
