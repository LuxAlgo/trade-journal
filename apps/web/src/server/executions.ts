import { and, eq, inArray } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import { db, executions, accounts } from "@/db";
import { executionHash, newId, nowIso } from "./ids";
import { rebuildAccount } from "./rebuild";
import { getJournalDefaults } from "./settings";
import { defaultFee } from "@/lib/journal-defaults";
import { requireValue } from "./api";

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
  requireValue(
    db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).get(),
    "Account not found.",
  );
  for (const row of rows) {
    requireValue(
      row &&
        typeof row.symbol === "string" &&
        row.symbol.trim() &&
        ["buy", "sell"].includes(row.side) &&
        Number.isFinite(row.quantity) &&
        row.quantity > 0 &&
        Number.isFinite(row.price) &&
        Number.isFinite(row.fee ?? 0) &&
        typeof row.executedAt === "string" &&
        Number.isFinite(Date.parse(row.executedAt)),
      "Every execution needs a symbol, buy/sell side, finite positive quantity, price, fee and valid timestamp.",
    );
  }
  let inserted = 0;
  let duplicates = 0;
  const createdAt = nowIso();
  const defaults = getJournalDefaults();

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
          fee: defaultFee(row.fee, row.quantity, accountId, row.symbol, defaults),
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
    if (inserted > 0) rebuildAccount(accountId);
  });

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
