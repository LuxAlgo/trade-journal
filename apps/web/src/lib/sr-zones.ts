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

/** Where a scan of a zone's candles stands; `scanBar` folds one more candle in. */
interface ZoneScan {
  touches: number;
  breaks: number;
  lastTouch: number | null;
  lastBreak: number;
  /** The side price came from before entering the zone. */
  origin: "above" | "below" | null;
  previous: "above" | "below" | "inside" | null;
}

const newScan = (): ZoneScan => ({
  touches: 0,
  breaks: 0,
  lastTouch: null,
  lastBreak: -Infinity,
  origin: null,
  previous: null,
});

function scanBar(scan: ZoneScan, zone: SrZone, bar: Bar) {
  if (bar.time < zone.start) return;
  const side = sideOf(bar.close, zone);
  const entered = bar.low <= zone.high && bar.high >= zone.low;
  if (scan.previous === null) {
    scan.previous = side;
    scan.origin = side === "inside" ? null : side;
    return;
  }
  if (side === "inside") {
    if (scan.previous !== "inside") scan.origin = scan.previous;
  } else {
    const from = scan.previous === "inside" ? scan.origin : scan.previous;
    if (from && from !== side) {
      scan.breaks += 1;
      scan.lastBreak = bar.time;
    } else if (entered || scan.previous === "inside") {
      // Wicked into the zone (or closed inside) and left on the same side: a rejection.
      scan.touches += 1;
      scan.lastTouch = bar.time;
    }
    scan.origin = side;
  }
  scan.previous = side;
}

function statsOf(zone: SrZone, scan: ZoneScan, last: Bar | undefined): ZoneStats {
  const position = last && last.time >= zone.start ? sideOf(last.close, zone) : "inside";
  const reference = position === "inside" ? (scan.origin ?? "above") : position;
  const role =
    zone.kind === "auto" ? (reference === "above" ? "support" : "resistance") : zone.kind;
  const status =
    position === "inside"
      ? "testing"
      : scan.lastBreak > (scan.lastTouch ?? -Infinity)
        ? "broken"
        : "holding";
  return {
    role,
    position,
    touches: scan.touches,
    breaks: scan.breaks,
    lastTouch: scan.lastTouch,
    status,
  };
}

/** A zone's behaviour over the candles since it was drawn. */
export function zoneStats(zone: SrZone, bars: readonly Bar[]): ZoneStats {
  const scan = newScan();
  for (const bar of bars) scanBar(scan, zone, bar);
  return statsOf(zone, scan, bars.at(-1));
}

/**
 * `zoneStats` for a live chart, where each tick only changes the forming (last) candle: the
 * scan over closed candles is kept per zone and extended, and only the last candle is redone.
 * Anything else (older history loaded, a zone edited) starts the scan over.
 */
export function zoneStatsTracker() {
  const kept = new Map<
    string,
    { zone: SrZone; firstTime: number; closed: number; lastClosedTime: number; scan: ZoneScan }
  >();
  const stats = (zone: SrZone, bars: readonly Bar[]): ZoneStats => {
    const closed = Math.max(0, bars.length - 1);
    const firstTime = bars[0]?.time ?? 0;
    let entry = kept.get(zone.id);
    const reusable =
      entry &&
      entry.zone === zone &&
      entry.firstTime === firstTime &&
      entry.closed <= closed &&
      (entry.closed === 0 || bars[entry.closed - 1]?.time === entry.lastClosedTime);
    if (!entry || !reusable) {
      entry = { zone, firstTime, closed: 0, lastClosedTime: 0, scan: newScan() };
      kept.set(zone.id, entry);
    }
    for (let i = entry.closed; i < closed; i += 1) scanBar(entry.scan, zone, bars[i]!);
    entry.closed = closed;
    entry.lastClosedTime = bars[closed - 1]?.time ?? 0;
    const scan = { ...entry.scan };
    const last = bars.at(-1);
    if (last) scanBar(scan, zone, last);
    return statsOf(zone, scan, last);
  };
  /** Forget zones that are gone. */
  const retain = (ids: ReadonlySet<string>) => {
    for (const id of kept.keys()) if (!ids.has(id)) kept.delete(id);
  };
  return { stats, retain };
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
