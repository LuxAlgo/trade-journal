import { and, eq, inArray, sql } from "drizzle-orm";
import { buildRoundTrips, type Execution, type ProfitCalcMethod } from "@luxalgo/journal-core";
import { db, executions, trades, accounts } from "@/db";
import { getMultipliers, getJournalDefaults } from "./settings";
import { defaultRisk } from "@/lib/journal-defaults";

/**
 * Rebuild the materialized round trips for an account from its executions.
 * Computed columns are overwritten; annotation columns are untouched because
 * rows are upserted by their rebuild-stable key. Trades whose key no longer
 * exists (their executions were deleted) are removed.
 */
export const rebuildAccount = (accountId: string): void => {
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) return;

  const rows = db.select().from(executions).where(eq(executions.accountId, accountId)).all();
  const executionInputs: Execution[] = rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    price: row.price,
    fee: row.fee,
    executedAt: row.executedAt,
    assetClass: (row.assetClass ?? undefined) as Execution["assetClass"],
    source: row.source,
    importMetadata: row.importMetadataJson ? JSON.parse(row.importMetadataJson) : undefined,
  }));

  const trips = buildRoundTrips(executionInputs, {
    method: account.profitCalcMethod as ProfitCalcMethod,
    multipliers: getMultipliers(),
  });
  const obsolete = new Set(
    db
      .select({ key: trades.key })
      .from(trades)
      .where(eq(trades.accountId, accountId))
      .all()
      .map((row) => row.key),
  );
  const defaults = getJournalDefaults();
  const values = trips.map((trip) => {
    obsolete.delete(trip.key);
    return {
      key: trip.key,
      accountId: trip.accountId,
      symbol: trip.symbol,
      assetClass: trip.assetClass ?? null,
      direction: trip.direction,
      status: trip.status,
      openedAt: trip.openedAt,
      closedAt: trip.closedAt ?? null,
      quantity: trip.quantity,
      openQuantity: trip.openQuantity,
      avgEntry: trip.avgEntry,
      avgExit: trip.avgExit ?? null,
      grossPnl: trip.grossPnl,
      fees: trip.fees,
      netPnl: trip.netPnl,
      executionCount: trip.executionCount,
      executionIdsJson: JSON.stringify(trip.executionIds),
      exitsJson: JSON.stringify(trip.exits),
      durationMs: trip.durationMs ?? null,
      ...defaultRisk(trip.avgEntry, trip.direction, accountId, trip.symbol, defaults),
    };
  });

  db.transaction((tx) => {
    // Keep batches below SQLite's bind-parameter limit. User annotations are
    // intentionally absent from the conflict update and therefore survive.
    for (let i = 0; i < values.length; i += 25) {
      tx.insert(trades)
        .values(values.slice(i, i + 25))
        .onConflictDoUpdate({
          target: trades.key,
          set: {
            accountId: sql`excluded.account_id`,
            symbol: sql`excluded.symbol`,
            assetClass: sql`excluded.asset_class`,
            direction: sql`excluded.direction`,
            status: sql`excluded.status`,
            openedAt: sql`excluded.opened_at`,
            closedAt: sql`excluded.closed_at`,
            quantity: sql`excluded.quantity`,
            openQuantity: sql`excluded.open_quantity`,
            avgEntry: sql`excluded.avg_entry`,
            avgExit: sql`excluded.avg_exit`,
            grossPnl: sql`excluded.gross_pnl`,
            fees: sql`excluded.fees`,
            netPnl: sql`excluded.net_pnl`,
            executionCount: sql`excluded.execution_count`,
            executionIdsJson: sql`excluded.execution_ids_json`,
            exitsJson: sql`excluded.exits_json`,
            durationMs: sql`excluded.duration_ms`,
          },
        })
        .run();
    }
    const vanished = [...obsolete];
    // Keep each statement below SQLite's bind-parameter limit, even for long histories.
    for (let i = 0; i < vanished.length; i += 500) {
      tx.delete(trades)
        .where(
          and(eq(trades.accountId, accountId), inArray(trades.key, vanished.slice(i, i + 500))),
        )
        .run();
    }
  });
};
