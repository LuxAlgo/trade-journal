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
  /** Rows dropped because a broker or file record was unusable (sync/import only). */
  skipped: number;
  /** A few plain-language reasons for skipped rows, capped so payloads stay small. */
  skippedReasons: string[];
}

export type ExecutionSource = "sync" | "import" | "manual";

const MAX_SKIP_REASONS = 5;

const isFiniteNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Plain-language reason a row can't be journaled, or null when the row is valid. */
export const executionProblem = (row: unknown, source: ExecutionSource): string | null => {
  if (!row || typeof row !== "object") return "Execution is missing.";
  const r = row as Partial<ImportedExecution>;
  const label = typeof r.symbol === "string" && r.symbol.trim() ? r.symbol.trim() : "execution";
  if (typeof r.symbol !== "string" || !r.symbol.trim()) return "An execution has no symbol.";
  if (!["buy", "sell"].includes(r.side as string)) return `${label}: side must be buy or sell.`;
  if (!isFiniteNumber(r.quantity) || r.quantity <= 0)
    return `${label}: quantity must be a finite positive number.`;
  if (!isFiniteNumber(r.price)) return `${label}: price must be a finite number.`;
  if (!isFiniteNumber(r.fee ?? 0)) return `${label}: fee must be a finite number.`;
  if (typeof r.executedAt !== "string" || !Number.isFinite(Date.parse(r.executedAt)))
    return `${label}: timestamp is missing or invalid.`;
  const meta = r.importMetadata;
  const metaOk =
    !meta ||
    (source === "import" &&
      typeof meta.id === "string" &&
      meta.id.length > 0 &&
      meta.id.length <= 2000 &&
      (meta.group === undefined ||
        (typeof meta.group === "string" && meta.group.length > 0 && meta.group.length <= 2000)) &&
      Number.isSafeInteger(meta.order) &&
      meta.order >= 0 &&
      (meta.reportedGrossPnl === undefined || Number.isFinite(meta.reportedGrossPnl)) &&
      (meta.preserveFee === undefined || typeof meta.preserveFee === "boolean"));
  if (!metaOk) return `${label}: invalid imported execution metadata.`;
  return null;
};

/**
 * Split a batch into usable rows and skip reasons. Manual entry is strict: the
 * whole batch is rejected on the first bad row. Broker syncs and file imports
 * are lenient: one odd record must not fail the entire batch, so bad rows are
 * dropped and counted for the caller to report.
 */
export const partitionExecutions = (
  rows: ImportedExecution[],
  source: ExecutionSource,
): { usable: ImportedExecution[]; skipped: number; skippedReasons: string[] } => {
  const usable: ImportedExecution[] = [];
  const skippedReasons: string[] = [];
  let skipped = 0;
  for (const row of rows) {
    const problem = executionProblem(row, source);
    if (problem === null) {
      usable.push(row);
      continue;
    }
    if (source === "manual") {
      requireValue(
        false,
        "Every execution needs a symbol, buy/sell side, finite positive quantity, price, fee and valid timestamp.",
      );
    }
    skipped++;
    if (skippedReasons.length < MAX_SKIP_REASONS) skippedReasons.push(problem);
  }
  return { usable, skipped, skippedReasons };
};

/** Insert executions with content-hash dedup, then rebuild the account's trades. */
export const insertExecutions = (
  accountId: string,
  rows: ImportedExecution[],
  source: ExecutionSource,
): InsertResult => {
  requireValue(
    db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).get(),
    "Account not found.",
  );
  const { usable, skipped, skippedReasons } = partitionExecutions(rows, source);
  let inserted = 0;
  let duplicates = 0;
  const createdAt = nowIso();
  const defaults = getJournalDefaults();

  db.transaction((tx) => {
    for (const row of usable) {
      const result = tx
        .insert(executions)
        .values({
          id: newId(),
          accountId,
          symbol: row.symbol,
          side: row.side,
          quantity: row.quantity,
          price: row.price,
          fee: row.importMetadata?.preserveFee
            ? row.fee
            : defaultFee(row.fee, row.quantity, accountId, row.symbol, defaults),
          executedAt: row.executedAt,
          assetClass: row.assetClass ?? null,
          source,
          importMetadataJson: row.importMetadata ? JSON.stringify(row.importMetadata) : null,
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

  return { inserted, duplicates, skipped, skippedReasons };
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
