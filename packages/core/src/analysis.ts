import type { AnnotatedTrade } from "./types";
import { dayKeyOf } from "./time";

export const FILTER_KEYS = [
  "accounts",
  "from",
  "to",
  "symbol",
  "excludeSymbol",
  "tag",
  "mistake",
  "playbookId",
  "direction",
  "status",
  "assetClass",
  "reviewed",
  "ratingMin",
  "ratingMax",
  "quantityMin",
  "quantityMax",
  "entryMin",
  "entryMax",
  "exitMin",
  "exitMax",
  "durationMin",
  "durationMax",
  "rMin",
  "rMax",
  "plannedRMin",
  "plannedRMax",
  "pnlMin",
  "pnlMax",
  "weekdays",
  "entryAfter",
  "entryBefore",
  "exitAfter",
  "exitBefore",
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type AnalysisFilters = Partial<Record<FilterKey, string>>;
export const readFilters = (params: { get(key: string): string | null }): AnalysisFilters =>
  Object.fromEntries(
    FILTER_KEYS.flatMap((key) => (params.get(key) ? [[key, params.get(key)!]] : [])),
  );

/** Planned risk uses the weighted entry and total entry quantity, not peak concurrent exposure. */
export function tradeRisk(trade: AnnotatedTrade): number | null {
  const stop = trade.annotations?.stopLoss;
  const multiplier =
    trade.contractMultiplier ??
    (["futures", "option", "cfd", "forex"].includes(trade.assetClass ?? "") ? null : 1);
  if (stop == null || multiplier == null || multiplier <= 0 || trade.quantity <= 0) return null;
  const distance = (trade.avgEntry - stop) * (trade.direction === "long" ? 1 : -1);
  return distance > 0 ? distance * trade.quantity * multiplier : null;
}
export function tradeR(trade: AnnotatedTrade): number | null {
  const risk = tradeRisk(trade);
  return risk && trade.status !== "open" ? trade.netPnl / risk : null;
}
export function plannedR(trade: AnnotatedTrade): number | null {
  const stop = trade.annotations?.stopLoss;
  const target = trade.annotations?.profitTarget;
  if (stop == null || target == null) return null;
  const sign = trade.direction === "long" ? 1 : -1;
  const risk = (trade.avgEntry - stop) * sign;
  const reward = (target - trade.avgEntry) * sign;
  return risk > 0 && reward >= 0 ? reward / risk : null;
}
const partsCache = new Map<string, Intl.DateTimeFormat>();
export function clockTime(iso: string, timeZone: string): string {
  let format = partsCache.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    partsCache.set(timeZone, format);
  }
  return format.format(new Date(iso));
}
const list = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const within = (value: number | null | undefined, min?: string, max?: string) => {
  if (!min && !max) return true;
  if (value == null || !Number.isFinite(value)) return false;
  return (
    (!min || (Number.isFinite(Number(min)) && value >= Number(min))) &&
    (!max || (Number.isFinite(Number(max)) && value <= Number(max)))
  );
};
function inTime(
  iso: string | undefined,
  after: string | undefined,
  before: string | undefined,
  tz: string,
) {
  if (!after && !before) return true;
  if (!iso) return false;
  const t = clockTime(iso, tz);
  return after && before && after > before
    ? t >= after || t <= before
    : (!after || t >= after) && (!before || t <= before);
}
export function matchesFilters(t: AnnotatedTrade, f: AnalysisFilters, tz = "UTC"): boolean {
  const a = t.annotations;
  if (f.accounts && !list(f.accounts).includes(t.accountId)) return false;
  if (f.from || f.to) {
    const day = dayKeyOf(t.closedAt ?? t.openedAt, tz);
    if ((f.from && day < f.from) || (f.to && day > f.to)) return false;
  }
  if (f.symbol && !list(f.symbol.toUpperCase()).includes(t.symbol.toUpperCase())) return false;
  if (list(f.excludeSymbol?.toUpperCase()).includes(t.symbol.toUpperCase())) return false;
  if (f.tag && !list(f.tag).every((tag) => a?.tags?.includes(tag))) return false;
  if (f.mistake && !list(f.mistake).every((tag) => a?.mistakes?.includes(tag))) return false;
  if (f.playbookId && a?.playbook !== f.playbookId) return false;
  if (f.direction && t.direction !== f.direction) return false;
  if (f.status && (f.status === "closed" ? t.status === "open" : t.status !== f.status))
    return false;
  if (f.assetClass && t.assetClass !== f.assetClass) return false;
  if (f.reviewed && Boolean(a?.reviewed) !== (f.reviewed === "yes")) return false;
  if (
    !within(a?.rating, f.ratingMin, f.ratingMax) ||
    !within(t.quantity, f.quantityMin, f.quantityMax) ||
    !within(t.avgEntry, f.entryMin, f.entryMax) ||
    !within(t.avgExit, f.exitMin, f.exitMax) ||
    !within(t.durationMs == null ? null : t.durationMs / 60000, f.durationMin, f.durationMax) ||
    ((f.rMin || f.rMax) && !within(tradeR(t), f.rMin, f.rMax)) ||
    ((f.plannedRMin || f.plannedRMax) && !within(plannedR(t), f.plannedRMin, f.plannedRMax)) ||
    !within(t.netPnl, f.pnlMin, f.pnlMax)
  )
    return false;
  if (f.weekdays) {
    const dayIndex = new Date(dayKeyOf(t.openedAt, tz) + "T12:00:00Z").getUTCDay();
    if (!list(f.weekdays).includes(String(dayIndex))) return false;
  }
  return (
    inTime(t.openedAt, f.entryAfter, f.entryBefore, tz) &&
    inTime(t.closedAt, f.exitAfter, f.exitBefore, tz)
  );
}
export const DIMENSIONS = {
  symbol: "Symbol",
  playbook: "Strategy",
  tag: "Tag",
  mistake: "Mistake",
  direction: "Direction",
  assetClass: "Asset class",
  weekday: "Weekday",
  month: "Month",
  entryHour: "Entry hour",
  exitHour: "Exit hour",
  entry15: "Entry · 15 minutes",
  exit15: "Exit · 15 minutes",
  duration: "Holding time",
  quantity: "Position size",
  entryPrice: "Entry price",
  exitPrice: "Exit price",
  realizedR: "Realized R",
  plannedR: "Planned R",
  outcome: "Outcome",
} as const;
export type Dimension = keyof typeof DIMENSIONS;
const bands = (n: number | undefined, bounds: number[], labels: string[]): string =>
  n == null || Number.isNaN(n)
    ? "Unspecified"
    : (labels[bounds.findIndex((b) => n < b)] ?? labels[labels.length - 1]!);
export function dimensionKeys(t: AnnotatedTrade, dimension: Dimension, tz: string): string[] {
  const bucketTime = (iso: string | undefined, step: number) => {
    if (!iso) return "Open";
    const time = clockTime(iso, tz);
    return (
      time.slice(0, 3) + String(Math.floor(Number(time.slice(3)) / step) * step).padStart(2, "0")
    );
  };
  switch (dimension) {
    case "tag":
      return t.annotations?.tags?.length ? t.annotations.tags : ["Untagged"];
    case "mistake":
      return t.annotations?.mistakes?.length ? t.annotations.mistakes : ["None"];
    case "playbook":
      return [t.annotations?.playbook ?? "Unassigned"];
    case "symbol":
      return [t.symbol];
    case "direction":
      return [t.direction];
    case "outcome":
      return [t.status];
    case "assetClass":
      return [t.assetClass ?? "Unspecified"];
    case "month":
      return [dayKeyOf(t.closedAt ?? t.openedAt, tz).slice(0, 7)];
    case "weekday":
      return [
        ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
          new Date(dayKeyOf(t.openedAt, tz) + "T12:00:00Z").getUTCDay()
        ]!,
      ];
    case "entryHour":
      return [bucketTime(t.openedAt, 60)];
    case "exitHour":
      return [bucketTime(t.closedAt, 60)];
    case "entry15":
      return [bucketTime(t.openedAt, 15)];
    case "exit15":
      return [bucketTime(t.closedAt, 15)];
    case "duration":
      return [
        bands(
          t.durationMs == null ? undefined : t.durationMs / 60000,
          [1, 5, 15, 60, 240, 1440],
          ["<1m", "1–5m", "5–15m", "15–60m", "1–4h", "4–24h", "1d+"],
        ),
      ];
    case "quantity":
      return [
        bands(t.quantity, [1, 10, 100, 1000], ["<1", "1–10", "10–100", "100–1,000", "1,000+"]),
      ];
    case "entryPrice":
    case "exitPrice":
      return [
        bands(
          dimension === "entryPrice" ? t.avgEntry : t.avgExit,
          [1, 10, 50, 100, 500],
          ["<1", "1–10", "10–50", "50–100", "100–500", "500+"],
        ),
      ];
    case "realizedR":
    case "plannedR":
      return [
        bands(
          (dimension === "realizedR" ? tradeR(t) : plannedR(t)) ?? undefined,
          [-2, -1, 0, 1, 2, 3],
          ["<-2R", "-2 to -1R", "-1 to 0R", "0–1R", "1–2R", "2–3R", "3R+"],
        ),
      ];
  }
}
export interface GroupSummary {
  trades: number;
  netPnl: number;
  winRate: number | null;
  avgRealizedR: number | null;
  avgPlannedR: number | null;
  avgDurationMs: number | null;
  volume: number;
  profitFactor: number | null;
  noLosses: boolean;
}
export function summarizeGroup(all: AnnotatedTrade[]): GroupSummary {
  const ts = all.filter((t) => t.status !== "open");
  const mean = (ns: (number | null | undefined)[]) => {
    const vs = ns.filter((x): x is number => x != null && Number.isFinite(x));
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  };
  const profit = ts.reduce((s, t) => s + Math.max(0, t.netPnl), 0),
    loss = ts.reduce((s, t) => s - Math.min(0, t.netPnl), 0);
  return {
    trades: ts.length,
    netPnl: ts.reduce((s, t) => s + t.netPnl, 0),
    winRate: ts.length ? ts.filter((t) => t.status === "win").length / ts.length : null,
    avgRealizedR: mean(ts.map(tradeR)),
    avgPlannedR: mean(ts.map(plannedR)),
    avgDurationMs: mean(ts.map((t) => t.durationMs)),
    volume: ts.reduce((s, t) => s + t.quantity, 0),
    profitFactor: loss ? profit / loss : null,
    noLosses: profit > 0 && loss === 0,
  };
}
export function analyzeGroups(
  trades: AnnotatedTrade[],
  primary: Dimension,
  secondary?: Dimension,
  tz = "UTC",
) {
  const groups = new Map<string, { row: string; column: string; trades: AnnotatedTrade[] }>();
  for (const t of trades.filter((t) => t.status !== "open"))
    for (const row of new Set(dimensionKeys(t, primary, tz)))
      for (const column of new Set(secondary ? dimensionKeys(t, secondary, tz) : [""])) {
        const key = JSON.stringify([row, column]);
        if (!groups.has(key)) groups.set(key, { row, column, trades: [] });
        groups.get(key)!.trades.push(t);
      }
  return [...groups.values()]
    .map((g) => ({ row: g.row, column: g.column, ...summarizeGroup(g.trades) }))
    .sort((a, b) => b.netPnl - a.netPnl || a.row.localeCompare(b.row));
}
