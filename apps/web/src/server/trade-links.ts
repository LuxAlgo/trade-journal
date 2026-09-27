import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { chartTradeLinks, db, trades } from "@/db";
import { matchKeys, symbolKey } from "@/lib/symbol-match";
import { suggestScenario, type AnalysisPlan } from "@/lib/analysis-plan";
import { dayWindow } from "./day-price-action";
import { nowIso } from "./ids";

const DAY_MS = 86_400_000;

/**
 * Trades you marked as taken from a chart analysis's plan. A trade belongs to at most one
 * analysis (and optionally one of its scenarios); links follow the trade's rebuild-stable key.
 */

export interface DayTrade {
  key: string;
  symbol: string;
  direction: "long" | "short";
  status: string;
  openedAt: string;
  avgEntry: number;
  netPnl: number;
  /** The analysis and scenario it is linked to, if any. */
  link: { analysisId: string; scenarioId: string | null } | null;
  /** The scenario of this plan its entry points to, when not linked yet. */
  suggestedScenario: string | null;
}

/** Trades opened on a journal day on the analysis's symbol, with their links. */
export function dayTradesFor(
  analysis: { symbol: string; plan: AnalysisPlan },
  day: string,
  timeZone: string,
): DayTrade[] {
  const { from, to } = dayWindow(day, timeZone);
  const keys = matchKeys(analysis.symbol);
  const rows = db
    .select({
      key: trades.key,
      symbol: trades.symbol,
      direction: trades.direction,
      status: trades.status,
      openedAt: trades.openedAt,
      avgEntry: trades.avgEntry,
      netPnl: trades.netPnl,
    })
    .from(trades)
    // A day either side in SQL (stored times vary in precision), exact in code.
    .where(
      and(
        gte(trades.openedAt, new Date(from - DAY_MS).toISOString()),
        lt(trades.openedAt, new Date(to + DAY_MS).toISOString()),
      ),
    )
    .all()
    .filter((t) => {
      const opened = Date.parse(t.openedAt);
      return opened >= from && opened < to && keys.has(symbolKey(t.symbol));
    });
  const links = new Map(
    (rows.length
      ? db
          .select()
          .from(chartTradeLinks)
          .where(
            inArray(
              chartTradeLinks.tradeKey,
              rows.map((r) => r.key),
            ),
          )
          .all()
      : []
    ).map((l) => [l.tradeKey, l]),
  );
  return rows.map((row) => {
    const link = links.get(row.key);
    return {
      ...row,
      link: link ? { analysisId: link.analysisId, scenarioId: link.scenarioId } : null,
      suggestedScenario: link ? null : suggestScenario(analysis.plan, row),
    };
  });
}

/** Link a trade to an analysis (and scenario), or unlink it with null. */
export function setTradeLink(
  tradeKey: string,
  link: { analysisId: string; scenarioId: string | null } | null,
) {
  if (!link) {
    db.delete(chartTradeLinks).where(eq(chartTradeLinks.tradeKey, tradeKey)).run();
    return;
  }
  db.insert(chartTradeLinks)
    .values({ tradeKey, ...link, createdAt: nowIso() })
    .onConflictDoUpdate({ target: chartTradeLinks.tradeKey, set: link })
    .run();
}
