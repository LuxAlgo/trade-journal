import { and, eq, inArray } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import { db, executions } from "@/db";
import { executionHash, newId, nowIso } from "./ids";
import { rebuildAccount } from "./rebuild";

export interface InsertResult {
  inserted: number;
  duplicates: number;
}

/** Insert executions with content-hash dedup, then rebuild the account's trades. */
export const insertExecutions = (
  accountId: string,
  rows: ImportedExecution[],
  source: "sync" | "import" | "manual",
): InsertResult => {
  let inserted = 0;
  let duplicates = 0;
  const createdAt = nowIso();

  db.transaction((tx) => {
    for (const row of rows) {
      const result = tx
        .insert(executions)
        .values({
          id: newId(),
          accountId,
          symbol: row.symbol,
          side: row.side,
          quantity: row.quantity,
          price: row.price,
          fee: row.fee,
          executedAt: row.executedAt,
          assetClass: row.assetClass ?? null,
          source,
          contentHash: executionHash(row),
          createdAt,
        })
        .onConflictDoNothing()
        .run();
      if (result.changes > 0) inserted++;
      else duplicates++;
    }
  });

  if (inserted > 0) rebuildAccount(accountId);
  return { inserted, duplicates };
};

export const deleteExecutionsForTrades = (accountId: string, executionIds: string[]): void => {
  if (executionIds.length === 0) return;
  db.delete(executions)
    .where(and(eq(executions.accountId, accountId), inArray(executions.id, executionIds)))
    .run();
  rebuildAccount(accountId);
};

export const listExecutions = (accountId: string, ids?: string[]) => {
  if (ids && ids.length > 0) {
    return db
      .select()
      .from(executions)
      .where(and(eq(executions.accountId, accountId), inArray(executions.id, ids)))
      .all();
  }
  return db.select().from(executions).where(eq(executions.accountId, accountId)).all();
};
