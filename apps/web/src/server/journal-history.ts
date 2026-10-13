import { and, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { dayKeyOf } from "@luxalgo/journal-core";
import {
  chartAnalysisSnapshots,
  chartPlanReviews,
  chartTradeLinks,
  db,
  journalDays,
  trades,
} from "@/db";
import { matchKeys, symbolKey } from "@/lib/symbol-match";
import {
  dayContext,
  trailingRanges,
  SHAPE_LABELS,
  VOLATILITY_LABELS,
  type DayContext,
} from "@/lib/day-context";
import { lessonsFrom, weekEnding } from "@/lib/journal-lessons";
import { OUTCOME_LABELS, isOutcome, parsePlan, type ScenarioOutcome } from "@/lib/analysis-plan";
import { candles, highImpactNews } from "./day-price-action";
import type { MarketBar } from "@/lib/market-data";
import { barsOfDay, dailyBarAt, dayWindow, journalDayOf } from "@/lib/day-window";

/**
 * The journal's past, for AI reviews: earlier days like a given one (same symbol, same day
 * type) with how your plans and trades went on them, and a week of days for a weekly review.
 */

const DAY_MS = 86_400_000;
const LOOKBACK_DAYS = 120;
const MAX_SIMILAR = 5;

/**
 * Graded scenario outcomes per journal day, optionally only for analyses on a symbol. A grade
 * counts only while its scenario is still in that day's plan (a removed scenario's grade
 * stays stored but no longer counts).
 */
function gradesByDay(days: string[], symbol?: string): Map<string, ScenarioOutcome[]> {
  const out = new Map<string, ScenarioOutcome[]>();
  if (!days.length) return out;
  const keys = symbol ? matchKeys(symbol) : null;
  const rows = db
    .select({
      day: chartPlanReviews.day,
      scenarioId: chartPlanReviews.scenarioId,
      outcome: chartPlanReviews.outcome,
      symbol: chartAnalysisSnapshots.symbol,
      planJson: chartAnalysisSnapshots.planJson,
    })
    .from(chartPlanReviews)
    .innerJoin(
      chartAnalysisSnapshots,
      and(
        eq(chartAnalysisSnapshots.analysisId, chartPlanReviews.analysisId),
        eq(chartAnalysisSnapshots.day, chartPlanReviews.day),
      ),
    )
    .where(inArray(chartPlanReviews.day, days))
    .all();
  for (const row of rows) {
    if (keys && !keys.has(symbolKey(row.symbol))) continue;
    if (!isOutcome(row.outcome)) continue;
    if (!parsePlan(row.planJson).scenarios.some((s) => s.id === row.scenarioId)) continue;
    out.set(row.day, [...(out.get(row.day) ?? []), row.outcome]);
  }
  return out;
}

/**
 * Closed trades on a symbol per daily candle they closed in, keyed by the journal day that
 * candle stands for (so they line up with plan grades, which are per journal day).
 */
function tradesByDay(symbol: string, bars: readonly MarketBar[], timeZone: string) {
  const keys = matchKeys(symbol);
  const out = new Map<string, { trades: number; wins: number; netPnl: number }>();
  const first = bars[0];
  const last = bars.at(-1);
  if (!first || !last) return out;
  for (const t of db
    .select({
      symbol: trades.symbol,
      closedAt: trades.closedAt,
      netPnl: trades.netPnl,
      status: trades.status,
    })
    .from(trades)
    .where(
      and(
        ne(trades.status, "open"),
        gte(trades.closedAt, new Date(first.time - DAY_MS).toISOString()),
        lt(trades.closedAt, new Date(last.time + 2 * DAY_MS).toISOString()),
      ),
    )
    .all()) {
    if (!t.closedAt || !keys.has(symbolKey(t.symbol))) continue;
    const bar = dailyBarAt(bars, Date.parse(t.closedAt));
    if (!bar) continue;
    const day = journalDayOf(bar, timeZone);
    const row = out.get(day) ?? { trades: 0, wins: 0, netPnl: 0 };
    row.trades += 1;
    if (t.status === "win") row.wins += 1;
    row.netPnl += t.netPnl;
    out.set(day, row);
  }
  return out;
}

/**
 * Earlier days on the same symbol with the same shape and volatility as `day`, newest
 * first, with your trades and graded scenarios on them. Every day, `day` included, is read
 * from the source's daily candles so they compare like with like; `context` (from the day's
 * intraday candles) stands in when the day has no daily candle yet.
 */
export async function similarPastDays(
  source: { provider: string; dataset: string | null; symbol: string },
  day: string,
  context: DayContext,
  timeZone: string,
  signal?: AbortSignal,
): Promise<string> {
  const window = dayWindow(day, timeZone);
  const from = window.from - LOOKBACK_DAYS * DAY_MS;
  const bars = await candles(source, "1d", from - 16 * DAY_MS, window.to + DAY_MS, signal);
  const averages = trailingRanges(bars, 14);
  const own = barsOfDay(bars, "1d", window)[0];
  const target = own ? dayContext(own, averages[bars.indexOf(own)] ?? null) : context;
  const matches: { day: string; context: DayContext }[] = [];
  bars.forEach((bar, i) => {
    // Only days whose candle had closed before this one began.
    if (bar.time < from || bar.time + DAY_MS > window.from) return;
    const past = dayContext(bar, averages[i] ?? null);
    if (past.shape === target.shape && past.volatility === target.volatility)
      matches.push({
        day: journalDayOf(bar, timeZone),
        context: { ...past, news: highImpactNews(source.symbol, bar.time, bar.time + DAY_MS) },
      });
  });
  const tradeDays = tradesByDay(source.symbol, bars, timeZone);
  const recent = matches.reverse().slice(0, MAX_SIMILAR * 3);
  const grades = gradesByDay(
    recent.map((m) => m.day),
    source.symbol,
  );
  // Days you traded or graded first: those say something about you, not only the market.
  const ranked = [
    ...recent.filter((m) => tradeDays.has(m.day) || grades.has(m.day)),
    ...recent.filter((m) => !tradeDays.has(m.day) && !grades.has(m.day)),
  ].slice(0, MAX_SIMILAR);
  if (!ranked.length) return "";
  const label = `${SHAPE_LABELS[target.shape].toLowerCase()}${target.volatility ? `, ${VOLATILITY_LABELS[target.volatility].toLowerCase()}` : ""}`;
  const lines = ranked.map((m) => {
    const t = tradeDays.get(m.day);
    const g = grades.get(m.day);
    const traded = t
      ? `${t.trades} trade${t.trades === 1 ? "" : "s"}, ${t.wins} won, net ${t.netPnl.toFixed(2)}`
      : "no trades";
    const graded = g?.length
      ? `; scenarios: ${g.map((o) => OUTCOME_LABELS[o].toLowerCase()).join(", ")}`
      : "";
    const news = m.context.news.length ? `; news: ${m.context.news.join(", ")}` : "";
    return `- ${m.day}: ${traded}${graded}${news}`;
  });
  return `Earlier days on ${source.symbol} of the same type (${label}), newest first:\n${lines.join("\n")}`;
}

/** A week of journal days for the weekly review: trades, plans, day types and lessons. */
export function weekContext(end: string, timeZone: string): { text: string; tradeCount: number } {
  const days = weekEnding(end);
  const closed = db
    .select({
      key: trades.key,
      symbol: trades.symbol,
      closedAt: trades.closedAt,
      netPnl: trades.netPnl,
      status: trades.status,
      direction: trades.direction,
    })
    .from(trades)
    .where(
      and(
        ne(trades.status, "open"),
        // A day of margin either side for the journal's time zone; days are matched exactly below.
        gte(trades.closedAt, new Date(Date.parse(`${days[0]}T00:00:00Z`) - DAY_MS).toISOString()),
        lt(trades.closedAt, new Date(Date.parse(`${end}T00:00:00Z`) + 2 * DAY_MS).toISOString()),
      ),
    )
    .all()
    .filter((t) => t.closedAt && days.includes(dayKeyOf(t.closedAt, timeZone)));
  const links = new Set(
    closed.length
      ? db
          .select({ key: chartTradeLinks.tradeKey })
          .from(chartTradeLinks)
          .where(
            inArray(
              chartTradeLinks.tradeKey,
              closed.map((t) => t.key),
            ),
          )
          .all()
          .map((l) => l.key)
      : [],
  );
  const notes = new Map(
    db
      .select({ date: journalDays.date, note: journalDays.note })
      .from(journalDays)
      .where(inArray(journalDays.date, days))
      .all()
      .map((n) => [n.date, n.note]),
  );
  const grades = gradesByDay(days);

  const sections = days.map((day) => {
    const dayTrades = closed.filter((t) => dayKeyOf(t.closedAt!, timeZone) === day);
    const net = dayTrades.reduce((sum, t) => sum + t.netPnl, 0);
    const wins = dayTrades.filter((t) => t.status === "win").length;
    const onPlan = dayTrades.filter((t) => links.has(t.key));
    const lessons = lessonsFrom(notes.get(day) ?? "");
    const g = grades.get(day) ?? [];
    const parts = [
      dayTrades.length
        ? `${dayTrades.length} trade${dayTrades.length === 1 ? "" : "s"} (${[...new Set(dayTrades.map((t) => t.symbol))].join(", ")}), ${wins} won, net ${net.toFixed(2)}; ${onPlan.length} from a plan (net ${onPlan.reduce((s, t) => s + t.netPnl, 0).toFixed(2)})`
        : "no closed trades",
      g.length
        ? `plan scenarios graded: ${g.map((o) => OUTCOME_LABELS[o].toLowerCase()).join(", ")}`
        : "",
      lessons.keep.length ? `Keep: ${lessons.keep.join("; ")}` : "",
      lessons.fix.length ? `Fix: ${lessons.fix.join("; ")}` : "",
    ].filter(Boolean);
    return `${day}: ${parts.join(" | ")}`;
  });
  return { text: sections.join("\n"), tradeCount: closed.length };
}
