import { and, eq, inArray } from "drizzle-orm";
import { resolveOptionInstrument, type AssetClass } from "@luxalgo/journal-core";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import { db, executions, accounts, trades } from "@/db";
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

export interface OptionNormalizationResult {
  normalized: number;
  duplicatesRemoved: number;
}

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
  const broker = meta?.broker;
  const brokerOk =
    broker === undefined ||
    ((source === "sync" || source === "import") &&
      broker.provider === "ibkr-flex" &&
      ["trade", "option-lifecycle"].includes(broker.kind) &&
      Object.entries(broker).every(
        ([, value]) =>
          value === undefined ||
          (typeof value === "string" && value.length <= 2000) ||
          (typeof value === "number" && Number.isFinite(value)),
      ));
  const metaOk =
    !meta ||
    ((source === "import" || source === "sync") &&
      typeof meta.id === "string" &&
      meta.id.length > 0 &&
      meta.id.length <= 2000 &&
      (meta.group === undefined ||
        (typeof meta.group === "string" && meta.group.length > 0 && meta.group.length <= 2000)) &&
      Number.isSafeInteger(meta.order) &&
      meta.order >= 0 &&
      (meta.reportedGrossPnl === undefined || Number.isFinite(meta.reportedGrossPnl)) &&
      (meta.preserveFee === undefined || typeof meta.preserveFee === "boolean") &&
      brokerOk);
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

const isIbkrFlexExecution = (row: ImportedExecution): boolean =>
  row.importMetadata?.broker?.provider === "ibkr-flex";

/**
 * IBKR's broker ID is stable across XML upload and live sync, so both paths
 * must use it. Other sync providers retain normalized-fill hashing because
 * their metadata may become richer between snapshots.
 */
const storedExecutionHash = (row: ImportedExecution, source: ExecutionSource): string =>
  executionHash(
    source === "import" || isIbkrFlexExecution(row) ? row : { ...row, importMetadata: undefined },
  );

/**
 * Upgrade option fills saved before contract normalization was introduced.
 *
 * Changing an OCC symbol also changes its dedup hash. If a later broker sync
 * already inserted the canonical form, keep that row and remove the legacy
 * twin before rebuilding round trips.
 */
export const normalizeStoredOptionExecutions = (accountId: string): OptionNormalizationResult => {
  const rows = db.select().from(executions).where(eq(executions.accountId, accountId)).all();
  const annotationMoves = db
    .select()
    .from(trades)
    .where(eq(trades.accountId, accountId))
    .all()
    .flatMap((trade) => {
      const instrument = resolveOptionInstrument({
        symbol: trade.symbol,
        assetClass: (trade.assetClass ?? undefined) as AssetClass | undefined,
      });
      if (instrument.assetClass !== "option" || instrument.symbol === trade.symbol) return [];
      const sourcePrefix = `${accountId}|${trade.symbol}|`;
      if (!trade.key.startsWith(sourcePrefix)) return [];
      return [
        {
          source: trade,
          targetKey: `${accountId}|${instrument.symbol}|${trade.key.slice(sourcePrefix.length)}`,
        },
      ];
    });
  const candidates = rows.flatMap((row) => {
    const instrument = resolveOptionInstrument({
      symbol: row.symbol,
      assetClass: (row.assetClass ?? undefined) as AssetClass | undefined,
    });
    if (instrument.assetClass !== "option" || instrument.missingContract) return [];
    const importMetadata = row.importMetadataJson
      ? (JSON.parse(row.importMetadataJson) as ImportedExecution["importMetadata"])
      : undefined;
    const contentHash = storedExecutionHash(
      {
        symbol: instrument.symbol,
        side: row.side,
        quantity: row.quantity,
        price: row.price,
        fee: row.fee,
        executedAt: row.executedAt,
        assetClass: (row.assetClass ?? undefined) as AssetClass | undefined,
        ...(importMetadata ? { importMetadata } : {}),
      },
      row.source,
    );
    return [{ row, symbol: instrument.symbol, contentHash }];
  });

  const byHash = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const group = byHash.get(candidate.contentHash);
    if (group) group.push(candidate);
    else byHash.set(candidate.contentHash, [candidate]);
  }

  const duplicateIds: string[] = [];
  const updates: (typeof candidates)[number][] = [];
  for (const group of byHash.values()) {
    // Prefer the already-canonical row so its stable trade key and annotations survive.
    const keeper =
      group.find(
        ({ row, symbol, contentHash }) =>
          row.symbol === symbol && row.contentHash === contentHash && row.assetClass === "option",
      ) ?? group[0]!;
    duplicateIds.push(
      ...group.filter(({ row }) => row.id !== keeper.row.id).map(({ row }) => row.id),
    );
    if (
      keeper.row.symbol !== keeper.symbol ||
      keeper.row.contentHash !== keeper.contentHash ||
      keeper.row.assetClass !== "option"
    ) {
      updates.push(keeper);
    }
  }

  if (duplicateIds.length === 0 && updates.length === 0) {
    return { normalized: 0, duplicatesRemoved: 0 };
  }

  db.transaction((tx) => {
    for (let index = 0; index < duplicateIds.length; index += 500) {
      tx.delete(executions)
        .where(inArray(executions.id, duplicateIds.slice(index, index + 500)))
        .run();
    }
    for (const { row, symbol, contentHash } of updates) {
      tx.update(executions)
        .set({ symbol, assetClass: "option", contentHash })
        .where(eq(executions.id, row.id))
        .run();
    }
  });
  rebuildAccount(accountId);
  for (const { source, targetKey } of annotationMoves) {
    const target = db.select().from(trades).where(eq(trades.key, targetKey)).get();
    if (!target) continue;
    const mergeArrayJson = (left: string | null, right: string | null): string | null => {
      if (!left) return right;
      if (!right) return left;
      return JSON.stringify([
        ...new Set([...(JSON.parse(left) as string[]), ...(JSON.parse(right) as string[])]),
      ]);
    };
    const notes =
      !target.notes || target.notes === source.notes
        ? (target.notes ?? source.notes)
        : source.notes
          ? `${target.notes}\n\n${source.notes}`
          : target.notes;
    db.update(trades)
      .set({
        notes,
        tagsJson: mergeArrayJson(target.tagsJson, source.tagsJson),
        mistakesJson: mergeArrayJson(target.mistakesJson, source.mistakesJson),
        playbookId: target.playbookId ?? source.playbookId,
        rating: target.rating ?? source.rating,
        stopLoss: target.stopLoss ?? source.stopLoss,
        profitTarget: target.profitTarget ?? source.profitTarget,
        reviewedAt: target.reviewedAt ?? source.reviewedAt,
      })
      .where(eq(trades.key, targetKey))
      .run();
  }
  return { normalized: updates.length, duplicatesRemoved: duplicateIds.length };
};

/** Insert fills, rebuild trades, and attach optional manual notes in one transaction. */
export const insertExecutions = (
  accountId: string,
  rows: ImportedExecution[],
  source: ExecutionSource,
  manualNotes?: string,
): InsertResult => {
  requireValue(
    manualNotes === undefined ||
      (source === "manual" && typeof manualNotes === "string" && manualNotes.length <= 100000),
    "Manual trade notes must be at most 100,000 characters.",
  );
  requireValue(
    db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).get(),
    "Account not found.",
  );
  const { usable, skipped, skippedReasons } = partitionExecutions(rows, source);
  requireValue(
    !usable.some((row) => row.ninjaTrader || row.importMetadata?.group?.startsWith("ninjatrader")),
    "NinjaTrader fills require the reviewed import endpoint.",
  );
  let inserted = 0;
  let duplicates = 0;
  let enriched = 0;
  const createdAt = nowIso();
  const defaults = getJournalDefaults();
  const note = manualNotes?.trim() ? manualNotes : undefined;

  db.transaction((tx) => {
    if (source === "import") {
      const existingHashes = new Set(
        tx
          .select({ hash: executions.contentHash })
          .from(executions)
          .where(and(eq(executions.accountId, accountId), eq(executions.source, "import")))
          .all()
          .map((row) => row.hash),
      );
      for (const row of usable) {
        if (existingHashes.has(executionHash(row))) continue;
        const candidates = [row.legacyExecutedAt, row.executedAt.replace(/\.\d{3}Z$/, ".000Z")];
        requireValue(
          !candidates.some(
            (executedAt) =>
              executedAt &&
              executedAt !== row.executedAt &&
              existingHashes.has(executionHash({ ...row, executedAt })),
          ),
          "Matching imported fills have timestamps from an older parser or indistinguishable whole-second executions. Import the complete corrected history into a new journal account and compare it before retiring the old account; nothing was saved.",
        );
      }
    }
    const noteExecutionIds = new Set<string>();
    for (const row of usable) {
      const id = newId();
      const contentHash = storedExecutionHash(row, source);
      const importMetadataJson = row.importMetadata ? JSON.stringify(row.importMetadata) : null;

      // Earlier Flex syncs used the normalized-fill hash. Migrate that row to
      // its broker ID before inserting so an XML upload and a live sync cannot
      // store the same transaction twice. Only sync rows are eligible: a
      // same-priced non-IBKR file import may be a genuinely separate fill.
      if (isIbkrFlexExecution(row)) {
        const legacyHash = executionHash({ ...row, importMetadata: undefined });
        if (legacyHash !== contentHash) {
          const legacy = tx
            .select({
              id: executions.id,
              source: executions.source,
              importMetadataJson: executions.importMetadataJson,
            })
            .from(executions)
            .where(and(eq(executions.accountId, accountId), eq(executions.contentHash, legacyHash)))
            .get();
          const legacyMetadata = legacy?.importMetadataJson
            ? (JSON.parse(legacy.importMetadataJson) as ImportedExecution["importMetadata"])
            : undefined;
          if (
            legacy?.source === "sync" &&
            (!legacyMetadata || legacyMetadata.broker?.provider === "ibkr-flex")
          ) {
            const canonical = tx
              .select({ id: executions.id })
              .from(executions)
              .where(
                and(eq(executions.accountId, accountId), eq(executions.contentHash, contentHash)),
              )
              .get();
            if (canonical) {
              tx.delete(executions).where(eq(executions.id, legacy.id)).run();
              tx.update(executions)
                .set({ importMetadataJson, assetClass: row.assetClass ?? null })
                .where(eq(executions.id, canonical.id))
                .run();
            } else {
              tx.update(executions)
                .set({
                  contentHash,
                  importMetadataJson,
                  assetClass: row.assetClass ?? null,
                })
                .where(eq(executions.id, legacy.id))
                .run();
            }
            duplicates++;
            enriched++;
            continue;
          }
        }
      }

      const result = tx
        .insert(executions)
        .values({
          id,
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
          importMetadataJson,
          contentHash,
          createdAt,
        })
        .onConflictDoNothing()
        .run();
      if (result.changes > 0) {
        inserted++;
        if (note) noteExecutionIds.add(id);
      } else {
        duplicates++;
        if (isIbkrFlexExecution(row) && importMetadataJson) {
          const existing = tx
            .select({
              id: executions.id,
              assetClass: executions.assetClass,
              importMetadataJson: executions.importMetadataJson,
            })
            .from(executions)
            .where(
              and(eq(executions.accountId, accountId), eq(executions.contentHash, contentHash)),
            )
            .get();
          if (
            existing &&
            (existing.importMetadataJson !== importMetadataJson ||
              existing.assetClass !== (row.assetClass ?? null))
          ) {
            tx.update(executions)
              .set({ importMetadataJson, assetClass: row.assetClass ?? null })
              .where(eq(executions.id, existing.id))
              .run();
            enriched++;
          }
        }
        if (note) {
          const existing = tx
            .select({ id: executions.id })
            .from(executions)
            .where(
              and(eq(executions.accountId, accountId), eq(executions.contentHash, contentHash)),
            )
            .get();
          if (existing) noteExecutionIds.add(existing.id);
        }
      }
    }
    if (inserted > 0 || enriched > 0) rebuildAccount(accountId);
    if (note) {
      const affected = tx
        .select({
          key: trades.key,
          notes: trades.notes,
          executionIdsJson: trades.executionIdsJson,
        })
        .from(trades)
        .where(eq(trades.accountId, accountId))
        .all();
      for (const trade of affected) {
        const ids = JSON.parse(trade.executionIdsJson) as string[];
        if (!ids.some((id) => noteExecutionIds.has(id))) continue;
        // Keep prior annotations when these fills extend or close an existing position.
        // Retrying the same submission must not append the note a second time.
        if (trade.notes === note || trade.notes?.endsWith(`\n\n${note}`)) continue;
        const notes = trade.notes?.trim() ? `${trade.notes}\n\n${note}` : note;
        requireValue(
          notes.length <= 100000,
          "Combined trade notes must be at most 100,000 characters.",
        );
        tx.update(trades).set({ notes }).where(eq(trades.key, trade.key)).run();
      }
    }
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
