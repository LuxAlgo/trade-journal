import type { MarketBar, Resolution } from "@/lib/market-data";
import type { LayersDocument } from "@/lib/chart-layers";
import type { StoredDrawing } from "@/lib/chart-analysis";
import type { SrZone } from "@/lib/sr-zones";
import { zonedToUtc } from "@/lib/market-sessions";
import {
  analysisLevels,
  describeDay,
  levelOutcome,
  sessionSummary,
  type LevelOutcome,
  type SessionSummary,
} from "@/lib/day-levels";
import { connectionKey, providerFor } from "./market-data/connections";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { db, economicEvents } from "@/db";
import { currenciesFor } from "@/lib/economic-calendar";
import { dayContext, describeContext, type DayContext } from "@/lib/day-context";
import { suggestOutcome, type AnalysisPlan, type OutcomeSuggestion } from "@/lib/analysis-plan";

/**
 * A journal day's price action against a chart analysis, from the day's candles (fetched
 * from the analysis's own source). Used by AI reviews and the journal day page; nothing is
 * stored, since candles can always be fetched again.
 */

export interface DayPriceAction {
  day: string;
  /** Candle size the facts were computed from. */
  resolution: Resolution;
  /** The day is still running: facts so far. */
  partial: boolean;
  summary: SessionSummary;
  averageRange: number | null;
  levels: LevelOutcome[];
  /** What the candles say about each plan scenario, by scenario id. */
  scenarios: Record<string, OutcomeSuggestion>;
  /** Trend or range, quiet or volatile, and high-impact news that day. */
  context: DayContext;
  text: string;
}

interface Source {
  provider: string;
  dataset: string | null;
  symbol: string;
  resolution: Resolution;
  drawings: { drawings: StoredDrawing[] };
  layers: LayersDocument;
  zones: SrZone[];
  plan?: AnalysisPlan;
}

const DAY_MS = 86_400_000;
const AVERAGE_DAYS = 14;
/** Fine enough to judge a level, coarse enough for one request per day. */
const INTRADAY: Resolution = "15m";

/** A journal day's start and end in UTC, in the journal's time zone. */
export function dayWindow(day: string, timeZone: string) {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const from = zonedToUtc(year, month, date, 0, 0, timeZone);
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  const to = zonedToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    0,
    0,
    timeZone,
  );
  return { from, to };
}

/** High-impact events stored from the economic calendar, on the symbol's currencies. */
export function highImpactNews(symbol: string, from: number, to: number): string[] {
  const currencies = currenciesFor(symbol);
  return db
    .select({
      currency: economicEvents.currency,
      title: economicEvents.title,
      time: economicEvents.time,
    })
    .from(economicEvents)
    .where(
      and(
        gte(economicEvents.time, from),
        lt(economicEvents.time, to),
        eq(economicEvents.impact, "High"),
        inArray(economicEvents.currency, currencies),
      ),
    )
    .orderBy(asc(economicEvents.time))
    .all()
    .map((e) => `${e.currency} ${e.title}`);
}

const cache = new Map<string, { at: number; bars: MarketBar[] }>();
const MAX_CACHED = 200;

/** Candles for a window; finished days are kept an hour, today's a minute. */
export async function candles(
  source: Pick<Source, "provider" | "dataset" | "symbol">,
  resolution: Resolution,
  from: number,
  to: number,
  signal?: AbortSignal,
): Promise<MarketBar[]> {
  const key = [source.provider, source.dataset ?? "", source.symbol, resolution, from, to].join(
    "|",
  );
  const hit = cache.get(key);
  const maxAge = to < Date.now() ? 3_600_000 : 60_000;
  if (hit && Date.now() - hit.at < maxAge) return hit.bars;
  const history = await providerFor(source.provider).history(
    {
      symbol: source.symbol,
      dataset: source.dataset ?? undefined,
      resolution,
      from,
      to: Math.min(to, Date.now()),
      signal,
    },
    connectionKey(source.provider),
  );
  const bars = history.bars.filter((bar) => bar.time >= from && bar.time < to);
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), bars });
  return bars;
}

/** Null when the day is in the future or its source returned no candles. */
export async function dayPriceAction(
  source: Source,
  day: string,
  timeZone: string,
  signal?: AbortSignal,
): Promise<DayPriceAction | null> {
  const { from, to } = dayWindow(day, timeZone);
  if (from > Date.now()) return null;
  let resolution: Resolution = INTRADAY;
  let bars: MarketBar[];
  try {
    bars = await candles(source, INTRADAY, from, to, signal);
  } catch {
    // Some sources (a candle file) only have their own candle size.
    resolution = source.resolution;
    bars = await candles(source, resolution, from, to, signal);
  }
  const summary = sessionSummary(bars);
  if (!summary) return null;
  let averageRange: number | null = null;
  try {
    const daily = await candles(source, "1d", from - AVERAGE_DAYS * DAY_MS, from, signal);
    if (daily.length)
      averageRange = daily.reduce((sum, bar) => sum + (bar.high - bar.low), 0) / daily.length;
  } catch {
    // The comparison is optional.
  }
  const levels = analysisLevels(source, to).map((level) => levelOutcome(level, bars));
  const scenarios = Object.fromEntries(
    (source.plan?.scenarios ?? []).map((s) => [s.id, suggestOutcome(s, bars)]),
  );
  const partial = to > Date.now();
  const context = dayContext(summary, averageRange, highImpactNews(source.symbol, from, to));
  const text = `${partial ? "So far today" : `On ${day}`} (journal time zone ${timeZone}, ${resolution} candles):\n${describeContext(context)}\n${describeDay(summary, levels, averageRange)}`;
  return { day, resolution, partial, summary, averageRange, levels, scenarios, context, text };
}
