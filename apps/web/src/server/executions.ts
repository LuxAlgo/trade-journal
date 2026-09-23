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

/** Group plus id. History legs reuse ids like "entry"; the group tells them apart. */
const brokerIdentity = (metadata: { id?: string; group?: string } | undefined): string | null =>
  metadata?.id?.trim() ? `${metadata.group ?? ""}\0${metadata.id}` : null;

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
 *
 * Fills with a broker id stay keyed by that id, so distinct partials are not
 * collapsed. A twin saved before ids were stored still matches on economics,
 * and is removed when exactly one broker id shares that print.
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
    const normalized = {
      symbol: instrument.symbol,
      side: row.side,
      quantity: row.quantity,
      price: row.price,
      fee: row.fee,
      executedAt: row.executedAt,
      assetClass: (row.assetClass ?? undefined) as AssetClass | undefined,
      ...(importMetadata ? { importMetadata } : {}),
    };
    return [
      {
        row,
        symbol: instrument.symbol,
        contentHash: storedExecutionHash(normalized, row.source),
        economicHash: executionHash({ ...normalized, importMetadata: undefined }),
        brokerId: brokerIdentity(importMetadata),
      },
    ];
  });

  const parent = candidates.map((_, index) => index);
  const findRoot = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    let cursor = index;
    while (cursor !== root) {
      const next = parent[cursor]!;
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  const union = (left: number, right: number) => {
    const leftRoot = findRoot(left);
    const rightRoot = findRoot(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const byPersisted = new Map<string, number>();
  for (let index = 0; index < candidates.length; index++) {
    const hash = candidates[index]!.contentHash;
    const prior = byPersisted.get(hash);
    if (prior === undefined) byPersisted.set(hash, index);
    else union(prior, index);
  }
  const byEconomic = new Map<string, number[]>();
  for (let index = 0; index < candidates.length; index++) {
    const hash = candidates[index]!.economicHash;
    const group = byEconomic.get(hash);
    if (group) group.push(index);
    else byEconomic.set(hash, [index]);
  }
  for (const indexes of byEconomic.values()) {
    const unidentified = indexes.filter((index) => !candidates[index]!.brokerId);
    if (unidentified.length === 0) continue;
    for (const index of unidentified.slice(1)) union(unidentified[0]!, index);
    const identities = new Set(
      indexes
        .map((index) => candidates[index]!.brokerId)
        .filter((id): id is string => Boolean(id)),
    );
    if (identities.size !== 1) continue;
    const identified = indexes.find((index) => candidates[index]!.brokerId);
    if (identified !== undefined) union(unidentified[0]!, identified);
  }
  const byHash = new Map<number, typeof candidates>();
  for (let index = 0; index < candidates.length; index++) {
    const root = findRoot(index);
    const group = byHash.get(root);
    if (group) group.push(candidates[index]!);
    else byHash.set(root, [candidates[index]!]);
  }

  const duplicateIds: string[] = [];
  const updates: (typeof candidates)[number][] = [];
  for (const group of byHash.values()) {
    const alreadyCanonical = ({ row, symbol, contentHash }: (typeof candidates)[number]) =>
      row.symbol === symbol && row.contentHash === contentHash && row.assetClass === "option";
    const keeper =
      group.find((candidate) => candidate.brokerId && alreadyCanonical(candidate)) ??
      group.find(alreadyCanonical) ??
      group.find((candidate) => candidate.brokerId) ??
      group[0]!;
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
    interface StoredFill {
      id: string;
      contentHash: string;
      quantity: number;
      price: number;
      fee: number;
      executedAt: string;
      assetClass: string | null;
      importMetadataJson: string | null;
      brokerId: string | null;
      brokerProvider: string | null;
      source: ExecutionSource;
    }
    const byHash = new Map<string, StoredFill>();
    const byBrokerId = new Map<string, StoredFill>();
    const remember = (fill: StoredFill) => {
      byHash.set(fill.contentHash, fill);
      if (fill.brokerId) byBrokerId.set(fill.brokerId, fill);
    };
    const forget = (fill: StoredFill) => {
      if (byHash.get(fill.contentHash)?.id === fill.id) byHash.delete(fill.contentHash);
      if (fill.brokerId && byBrokerId.get(fill.brokerId)?.id === fill.id) {
        byBrokerId.delete(fill.brokerId);
      }
    };
    const identityOf = (
      json: string | null,
    ): { brokerId: string | null; brokerProvider: string | null } => {
      if (!json) return { brokerId: null, brokerProvider: null };
      try {
        const parsed = JSON.parse(json) as {
          id?: unknown;
          group?: unknown;
          broker?: { provider?: unknown };
        };
        return {
          brokerId: brokerIdentity({
            id: typeof parsed.id === "string" ? parsed.id : undefined,
            group: typeof parsed.group === "string" ? parsed.group : undefined,
          }),
          brokerProvider:
            typeof parsed.broker?.provider === "string" ? parsed.broker.provider : null,
        };
      } catch {
        return { brokerId: null, brokerProvider: null };
      }
    };
    for (const row of tx
      .select({
        id: executions.id,
        contentHash: executions.contentHash,
        quantity: executions.quantity,
        price: executions.price,
        fee: executions.fee,
        executedAt: executions.executedAt,
        assetClass: executions.assetClass,
        importMetadataJson: executions.importMetadataJson,
        source: executions.source,
      })
      .from(executions)
      .where(eq(executions.accountId, accountId))
      .all()) {
      remember({ ...row, ...identityOf(row.importMetadataJson) });
    }

    const noteExecutionIds = new Set<string>();
    const resolvedFee = (row: ImportedExecution) =>
      row.importMetadata?.preserveFee
        ? row.fee
        : defaultFee(row.fee, row.quantity, accountId, row.symbol, defaults);
    const isLegacySyncFill = (fill: StoredFill | undefined): fill is StoredFill =>
      Boolean(
        fill &&
          fill.source === "sync" &&
          !fill.brokerId &&
          (fill.brokerProvider === null || fill.brokerProvider === "ibkr-flex"),
      );
    for (const row of usable) {
      const brokerId = brokerIdentity(row.importMetadata);
      const contentHash = storedExecutionHash(row, source);
      const economicHash = executionHash({ ...row, importMetadata: undefined });
      const importMetadataJson = row.importMetadata ? JSON.stringify(row.importMetadata) : null;
      const fee = resolvedFee(row);
      const ibkr = isIbkrFlexExecution(row);

      // A pre-id sync row and the broker-id copy of the same fill can both
      // already be stored. Drop the pre-id row instead of inserting a third.
      if (ibkr && economicHash !== contentHash) {
        const legacy = byHash.get(economicHash);
        const canonical = byHash.get(contentHash);
        if (isLegacySyncFill(legacy) && canonical && canonical.id !== legacy.id) {
          forget(legacy);
          tx.delete(executions).where(eq(executions.id, legacy.id)).run();
          const metadataChanged =
            importMetadataJson !== null && importMetadataJson !== canonical.importMetadataJson;
          const assetClass = row.assetClass ?? null;
          if (metadataChanged || assetClass !== canonical.assetClass) {
            const nextMetadata = metadataChanged
              ? importMetadataJson
              : canonical.importMetadataJson;
            tx.update(executions)
              .set({ importMetadataJson: nextMetadata, assetClass })
              .where(eq(executions.id, canonical.id))
              .run();
            forget(canonical);
            canonical.importMetadataJson = nextMetadata;
            canonical.assetClass = assetClass;
            canonical.brokerId = brokerId ?? canonical.brokerId;
            canonical.brokerProvider =
              row.importMetadata?.broker?.provider ?? canonical.brokerProvider;
            remember(canonical);
          }
          duplicates++;
          enriched++;
          if (note) noteExecutionIds.add(canonical.id);
          continue;
        }
      }

      let existing = byHash.get(contentHash);
      if (!existing && ibkr && brokerId) existing = byBrokerId.get(brokerId);
      if (!existing && ibkr) {
        const legacy = byHash.get(economicHash);
        if (isLegacySyncFill(legacy)) existing = legacy;
      }

      if (!existing) {
        const id = newId();
        const result = tx
          .insert(executions)
          .values({
            id,
            accountId,
            symbol: row.symbol,
            side: row.side,
            quantity: row.quantity,
            price: row.price,
            fee,
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
          remember({
            id,
            contentHash,
            quantity: row.quantity,
            price: row.price,
            fee,
            executedAt: row.executedAt,
            assetClass: row.assetClass ?? null,
            importMetadataJson,
            brokerId,
            brokerProvider: row.importMetadata?.broker?.provider ?? null,
            source,
          });
          if (note) noteExecutionIds.add(id);
        } else {
          duplicates++;
          const conflict = byHash.get(contentHash);
          if (note && conflict) noteExecutionIds.add(conflict.id);
        }
        continue;
      }

      duplicates++;
      if (note) noteExecutionIds.add(existing.id);
      // A later short sync must not shrink a close that a full file already raised.
      if (ibkr && brokerId !== null && row.quantity < existing.quantity) continue;
      const upgradeQuantity = ibkr && brokerId !== null && row.quantity > existing.quantity;
      const attachIdentity =
        ibkr &&
        brokerId !== null &&
        (existing.brokerId === null || existing.contentHash === economicHash);
      const nextHash = upgradeQuantity || attachIdentity ? contentHash : existing.contentHash;
      const occupant = byHash.get(nextHash);
      if (occupant && occupant.id !== existing.id) continue;
      const metadataChanged =
        importMetadataJson !== null && importMetadataJson !== existing.importMetadataJson;
      const assetClass = row.assetClass ?? null;
      const assetChanged = assetClass !== existing.assetClass;
      const shouldWrite =
        upgradeQuantity || attachIdentity || (ibkr && (metadataChanged || assetChanged));
      if (!shouldWrite) continue;

      const next = {
        quantity: upgradeQuantity ? row.quantity : existing.quantity,
        price: upgradeQuantity ? row.price : existing.price,
        fee: upgradeQuantity ? fee : existing.fee,
        executedAt: upgradeQuantity ? row.executedAt : existing.executedAt,
        assetClass,
        importMetadataJson:
          upgradeQuantity || metadataChanged ? importMetadataJson : existing.importMetadataJson,
        contentHash: nextHash,
      };
      forget(existing);
      tx.update(executions).set(next).where(eq(executions.id, existing.id)).run();
      existing.quantity = next.quantity;
      existing.price = next.price;
      existing.fee = next.fee;
      existing.executedAt = next.executedAt;
      existing.assetClass = next.assetClass;
      existing.importMetadataJson = next.importMetadataJson;
      existing.contentHash = next.contentHash;
      existing.brokerId = brokerId ?? existing.brokerId;
      existing.brokerProvider = row.importMetadata?.broker?.provider ?? existing.brokerProvider;
      remember(existing);
      enriched++;
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
