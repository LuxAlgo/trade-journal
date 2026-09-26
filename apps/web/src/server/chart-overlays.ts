import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { accounts, db, executions, missedTrades, trades } from "@/db";
import type { ChartOverlayData, ChartTrade } from "@/lib/chart-overlays";
import { matchingSymbols } from "@/lib/symbol-match";

const MAX_TRADES = 1000;
const parseIds = (json: string) => {
  try {
    const ids = JSON.parse(json) as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
};

/** Journal trades (newest first) and open missed trades matching a chart symbol. */
export function chartOverlayData(chartSymbol: string, extra: string[] = []): ChartOverlayData {
  const journalSymbols = [
    ...new Set([
      ...db
        .selectDistinct({ symbol: trades.symbol })
        .from(trades)
        .all()
        .map((r) => r.symbol),
      ...db
        .selectDistinct({ symbol: missedTrades.symbol })
        .from(missedTrades)
        .all()
        .map((r) => r.symbol),
    ]),
  ];
  const symbols = matchingSymbols(journalSymbols, chartSymbol, extra);
  if (!symbols.length) return { symbols, trades: [], missed: [] };
  const accountRows = new Map(
    db
      .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
      .from(accounts)
      .all()
      .map((a) => [a.id, a]),
  );
  const rows = db
    .select()
    .from(trades)
    .where(inArray(trades.symbol, symbols))
    .orderBy(desc(trades.openedAt))
    .limit(MAX_TRADES)
    .all();
  const fillIds = rows.flatMap((row) => parseIds(row.executionIdsJson));
  const fills = new Map<string, typeof executions.$inferSelect>();
  // Stay below SQLite's bind-parameter limit.
  for (let i = 0; i < fillIds.length; i += 500)
    for (const fill of db
      .select()
      .from(executions)
      .where(inArray(executions.id, fillIds.slice(i, i + 500)))
      .all())
      fills.set(fill.id, fill);
  const chartTrades: ChartTrade[] = rows.map((row) => ({
    key: row.key,
    account: accountRows.get(row.accountId)?.name ?? "",
    symbol: row.symbol,
    direction: row.direction,
    status: row.status,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    quantity: row.quantity,
    openQuantity: row.openQuantity,
    avgEntry: row.avgEntry,
    avgExit: row.avgExit,
    netPnl: row.netPnl,
    currency: accountRows.get(row.accountId)?.currency ?? "USD",
    stopLoss: row.stopLoss,
    profitTarget: row.profitTarget,
    fills: parseIds(row.executionIdsJson)
      .map((id) => fills.get(id))
      .filter((f) => f !== undefined)
      .map((f) => ({
        time: Date.parse(f.executedAt),
        side: f.side,
        quantity: f.quantity,
        price: f.price,
      }))
      .sort((a, b) => a.time - b.time),
  }));
  const missed = db
    .select()
    .from(missedTrades)
    .where(and(inArray(missedTrades.symbol, symbols), isNull(missedTrades.archivedAt)))
    .orderBy(desc(missedTrades.observedAt))
    .limit(MAX_TRADES)
    .all()
    .map((m) => ({
      id: m.id,
      symbol: m.symbol,
      direction: m.direction as "long" | "short",
      observedAt: m.observedAt,
      entry: m.entry,
      stop: m.stop,
      target: m.target,
      notes: m.notes,
    }));
  return { symbols, trades: chartTrades, missed };
}
