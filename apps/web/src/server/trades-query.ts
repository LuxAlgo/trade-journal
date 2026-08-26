import { asc, eq } from "drizzle-orm";
import type { AnnotatedTrade } from "@luxalgo/journal-core";
import { db, trades } from "@/db";

export interface TradeFilters {
  accountIds?: string[];
  from?: string; // inclusive day key
  to?: string; // inclusive day key
  symbol?: string;
  tag?: string;
  playbookId?: string;
  direction?: "long" | "short";
  status?: "open" | "win" | "loss" | "breakeven";
}

export type TradeRow = typeof trades.$inferSelect;

const parseJsonArray = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
};

export const rowToTrade = (row: TradeRow): AnnotatedTrade => ({
  key: row.key,
  accountId: row.accountId,
  symbol: row.symbol,
  assetClass: (row.assetClass ?? undefined) as AnnotatedTrade["assetClass"],
  direction: row.direction,
  status: row.status,
  openedAt: row.openedAt,
  closedAt: row.closedAt ?? undefined,
  quantity: row.quantity,
  openQuantity: row.openQuantity,
  avgEntry: row.avgEntry,
  avgExit: row.avgExit ?? undefined,
  grossPnl: row.grossPnl,
  fees: row.fees,
  netPnl: row.netPnl,
  executionCount: row.executionCount,
  executionIds: parseJsonArray(row.executionIdsJson),
  exits: JSON.parse(row.exitsJson) as AnnotatedTrade["exits"],
  durationMs: row.durationMs ?? undefined,
  annotations: {
    tags: parseJsonArray(row.tagsJson),
    mistakes: parseJsonArray(row.mistakesJson),
    playbook: row.playbookId ?? undefined,
    rating: row.rating ?? undefined,
    stopLoss: row.stopLoss ?? undefined,
    profitTarget: row.profitTarget ?? undefined,
    reviewed: row.reviewedAt !== null,
  },
});

/**
 * Journals hold thousands of trades, not millions — rows are filtered in
 * process so filter semantics live in one testable place instead of SQL.
 */
export const queryTrades = (
  filters: TradeFilters = {},
): { rows: TradeRow[]; trades: AnnotatedTrade[] } => {
  const all = db.select().from(trades).orderBy(asc(trades.openedAt)).all();

  const rows = all.filter((row) => {
    if (
      filters.accountIds &&
      filters.accountIds.length > 0 &&
      !filters.accountIds.includes(row.accountId)
    )
      return false;
    if (filters.symbol && row.symbol !== filters.symbol.toUpperCase()) return false;
    if (filters.direction && row.direction !== filters.direction) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.playbookId && row.playbookId !== filters.playbookId) return false;
    if (filters.tag && !parseJsonArray(row.tagsJson).includes(filters.tag)) return false;
    const anchor = row.closedAt ?? row.openedAt;
    if (filters.from && anchor.slice(0, 10) < filters.from) return false;
    if (filters.to && anchor.slice(0, 10) > filters.to) return false;
    return true;
  });

  return { rows, trades: rows.map(rowToTrade) };
};

export const getTradeByKey = (key: string): TradeRow | undefined =>
  db.select().from(trades).where(eq(trades.key, key)).get();
