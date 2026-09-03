import { and, eq, inArray } from "drizzle-orm";
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

  db.transaction((tx) => {
    for (const trip of trips) {
      obsolete.delete(trip.key);
      const computed = {
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
      };
      tx.insert(trades)
        .values({
          key: trip.key,
          ...computed,
          ...defaultRisk(trip.avgEntry, trip.direction, accountId, trip.symbol, defaults),
        })
        .onConflictDoUpdate({ target: trades.key, set: computed })
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
