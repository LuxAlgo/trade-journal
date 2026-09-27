import { and, desc, gte, lt, ne } from "drizzle-orm";
import { chartAnalyses, db, trades } from "@/db";
import { matchKeys, symbolKey } from "@/lib/symbol-match";
import {
  dayContext,
  dayTypeStats,
  trailingRanges,
  type DayContext,
  type DayTypeRow,
} from "@/lib/day-context";
import { candles, highImpactNews } from "./day-price-action";

/**
 * Your closed trades split by the kind of day they closed on (trend or range, quiet or
 * volatile, news or not). Day types come from the source's daily candles, one request per
 * symbol, through the market source of your latest chart of that symbol; days follow those
 * candles (UTC for crypto sources).
 */

const DAY_MS = 86_400_000;
const MAX_SYMBOLS = 8;
const AVERAGE_DAYS = 14;

export interface DayTypeBreakdown {
  from: number;
  to: number;
  rows: DayTypeRow[];
  symbols: { symbol: string; trades: number; source: string | null; problem: string | null }[];
}

const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);

export async function dayTypeBreakdown(
  days: number,
  signal?: AbortSignal,
): Promise<DayTypeBreakdown> {
  const to = Date.now();
  const from = to - days * DAY_MS;
  const closed = db
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
        gte(trades.closedAt, new Date(from - DAY_MS).toISOString()),
        lt(trades.closedAt, new Date(to + DAY_MS).toISOString()),
      ),
    )
    .all()
    .flatMap((t) => {
      const time = t.closedAt ? Date.parse(t.closedAt) : NaN;
      return time >= from && time < to ? [{ ...t, day: utcDay(time) }] : [];
    });
  const counts = new Map<string, number>();
  for (const t of closed) counts.set(t.symbol, (counts.get(t.symbol) ?? 0) + 1);
  const symbols = [...counts].sort((a, b) => b[1] - a[1]).slice(0, MAX_SYMBOLS);
  const analyses = db
    .select({
      symbol: chartAnalyses.symbol,
      provider: chartAnalyses.provider,
      dataset: chartAnalyses.dataset,
    })
    .from(chartAnalyses)
    .orderBy(desc(chartAnalyses.updatedAt))
    .all();
  const contexts = new Map<string, DayContext>();
  const report: DayTypeBreakdown["symbols"] = [];
  for (const [symbol, count] of symbols) {
    const source = analyses.find((a) => matchKeys(a.symbol).has(symbolKey(symbol)));
    if (!source) {
      report.push({ symbol, trades: count, source: null, problem: "No chart of it yet." });
      continue;
    }
    try {
      const bars = await candles(source, "1d", from - (AVERAGE_DAYS + 1) * DAY_MS, to, signal);
      const averages = trailingRanges(bars, AVERAGE_DAYS);
      bars.forEach((bar, i) => {
        if (bar.time < from - DAY_MS) return;
        contexts.set(
          `${symbol}|${utcDay(bar.time)}`,
          dayContext(
            bar,
            averages[i] ?? null,
            highImpactNews(source.symbol, bar.time, bar.time + DAY_MS),
          ),
        );
      });
      report.push({
        symbol,
        trades: count,
        source: `${source.provider} ${source.symbol}`,
        problem: null,
      });
    } catch (error) {
      report.push({
        symbol,
        trades: count,
        source: `${source.provider} ${source.symbol}`,
        problem: error instanceof Error ? error.message : "Market data is unavailable.",
      });
    }
  }
  const rows = dayTypeStats(closed, (symbol, day) => contexts.get(`${symbol}|${day}`));
  return { from, to, rows, symbols: report };
}
