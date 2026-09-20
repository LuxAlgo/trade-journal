import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  buildRoundTrips,
  computeMetrics,
  type Execution,
  type ImportMetadata,
  type ProfitCalcMethod,
} from "@luxalgo/journal-core";
import type { ImportedExecution, ParsedImport } from "@luxalgo/journal-importers";
import {
  db,
  accounts,
  executions,
  trades,
  importSources,
  importSourceAliases,
  importBatches,
} from "@/db";
import type { ImportReview, ImportReviewOptions } from "@/lib/import-review";
import { defaultFee } from "@/lib/journal-defaults";
import { requireValue } from "./api";
import { executionHash, newId, nowIso } from "./ids";
import { getMultipliers, getJournalDefaults, getTimeZone } from "./settings";
import { rebuildAccount } from "./rebuild";
import { orderNinjaTraderFills } from "./ninjatrader-order";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const FORMAT = "ninjatrader";
const facts = (fill: Execution) => fill.importMetadata?.ninjaTrader;
const identity = (fill: Execution) => {
  const source = facts(fill)!;
  return source.executionId
    ? JSON.stringify([source.sourceId, "id", source.executionId])
    : JSON.stringify([fill.importMetadata!.group, fill.importMetadata!.id]);
};
const economics = (
  fill: Pick<Execution, "symbol" | "side" | "quantity" | "price" | "executedAt">,
  instrument: string,
) =>
  JSON.stringify([instrument, fill.symbol, fill.side, fill.quantity, fill.price, fill.executedAt]);
const equalFee = (a: number | undefined, b: number | undefined) => a === b;

function readOptions(value: ImportReviewOptions): ImportReviewOptions {
  requireValue(
    value && typeof value === "object" && !Array.isArray(value),
    "Invalid import review options.",
  );
  for (const key of ["completeHistory", "approveFeeCorrections"] as const)
    requireValue(value[key] === undefined || typeof value[key] === "boolean", `Invalid ${key}.`);
  requireValue(
    value.previewToken === undefined || typeof value.previewToken === "string",
    "Invalid preview token.",
  );
  requireValue(
    value.sourceMappings === undefined ||
      (value.sourceMappings &&
        typeof value.sourceMappings === "object" &&
        !Array.isArray(value.sourceMappings) &&
        Object.entries(value.sourceMappings).length <= 500 &&
        Object.entries(value.sourceMappings).every(
          ([key, id]) => key.length <= 2000 && typeof id === "string" && id.length <= 200,
        )),
    "Invalid source mappings.",
  );
  return value;
}

type Source = typeof importSources.$inferInsert;
type Alias = typeof importSourceAliases.$inferInsert;
interface Plan {
  review: ImportReview;
  inserts: Execution[];
  updates: Execution[];
  sources: Source[];
  aliases: Alias[];
  batch: typeof importBatches.$inferInsert;
}

/** Read-only plan used by both preview and the transaction that commits it. */
function planImport(
  accountId: string,
  parsed: ParsedImport,
  content: string,
  timeZone: string,
  rawOptions: ImportReviewOptions,
): Plan {
  const options = readOptions(rawOptions);
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  requireValue(account, "Account not found.");
  const savedSources = db
    .select()
    .from(importSources)
    .where(and(eq(importSources.accountId, accountId), eq(importSources.format, FORMAT)))
    .all();
  const savedAliases = db
    .select()
    .from(importSourceAliases)
    .where(
      and(eq(importSourceAliases.accountId, accountId), eq(importSourceAliases.format, FORMAT)),
    )
    .all();
  const batches = db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.accountId, accountId), eq(importBatches.format, FORMAT)))
    .all();
  const stored = db.select().from(executions).where(eq(executions.accountId, accountId)).all();
  const oldTrades = db.select().from(trades).where(eq(trades.accountId, accountId)).all();
  const defaults = getJournalDefaults(),
    multipliers = getMultipliers();
  const conflicts = new Set(parsed.errors ?? []),
    warnings = new Set<string>();
  if (parsed.skippedRows)
    conflicts.add(
      `${parsed.skippedRows} invalid execution rows were skipped. Correct the export before importing, so positions are not reconstructed from incomplete fills.`,
    );
  if (!parsed.executions.length) conflicts.add("No executions to import.");
  const sourceInputs = new Map(
    parsed.executions
      .filter((e) => e.ninjaTrader)
      .map((e) => [e.ninjaTrader!.sourceKey, e.ninjaTrader!]),
  );
  const sources: Source[] = [],
    aliases: Alias[] = [];
  const sourceChoices: ImportReview["sources"] = [];
  const resolved = new Map<string, string>();
  for (const [key, input] of sourceInputs) {
    const known = savedAliases.find((a) => a.aliasKey === key);
    const chosen = options.sourceMappings?.[key];
    const label = `${input.account || "Account not supplied"}${input.connection ? ` · ${input.connection}` : ""}`;
    let selected: string | null =
      known?.sourceId ?? chosen ?? (savedSources.length === 0 && input.account ? "new" : null);
    if (known && chosen && chosen !== known.sourceId)
      conflicts.add(
        `${label}: a saved source mapping cannot be reassigned. Use another destination account for a different source.`,
      );
    if (selected && selected !== "new" && !savedSources.some((s) => s.id === selected)) {
      conflicts.add(`${label}: select a source belonging to this destination account.`);
      selected = null;
    }
    sourceChoices.push({ key, label, selected, saved: !!known });
    if (!selected) {
      conflicts.add(
        `${label}: choose its saved source account, or explicitly create a new source.`,
      );
      continue;
    }
    const sourceId = selected === "new" ? `nt_${digest([accountId, key]).slice(0, 24)}` : selected;
    resolved.set(key, sourceId);
    if (selected === "new")
      sources.push({ id: sourceId, accountId, format: FORMAT, name: label, createdAt: nowIso() });
    if (!known)
      aliases.push({
        id: `alias_${digest([accountId, key]).slice(0, 24)}`,
        accountId,
        format: FORMAT,
        aliasKey: key,
        sourceId,
      });
  }
  const existing: Execution[] = stored.map((row) => ({
    id: row.id,
    accountId,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    price: row.price,
    fee: row.fee,
    executedAt: row.executedAt,
    assetClass: row.assetClass as Execution["assetClass"],
    source: row.source,
    importMetadata: row.importMetadataJson ? JSON.parse(row.importMetadataJson) : undefined,
  }));
  const oldByIdentity = new Map(existing.filter((e) => facts(e)).map((e) => [identity(e), e]));
  const legacyHashes = new Set(
    existing
      .filter((e) => e.source === "import" && !facts(e))
      // Earlier timestamp parsing could lose fractional seconds. Compare legacy
      // candidates at whole-second precision so an upgrade cannot insert them twice.
      .map((e) =>
        executionHash({
          ...e,
          executedAt: e.executedAt.replace(/\.\d{3}Z$/, ".000Z"),
          importMetadata: undefined,
        }),
      ),
  );
  const sortedInputs = [...parsed.executions].sort((a, b) =>
    JSON.stringify([
      a.ninjaTrader,
      a.symbol,
      a.side,
      a.quantity,
      a.price,
      a.executedAt,
    ]).localeCompare(
      JSON.stringify([b.ninjaTrader, b.symbol, b.side, b.quantity, b.price, b.executedAt]),
    ),
  );
  const occurrences = new Map<string, number>(),
    incoming = new Map<string, Execution>();
  let duplicates = 0,
    missingFees = 0;
  for (const row of sortedInputs) {
    const input = row.ninjaTrader;
    if (!input) {
      conflicts.add("Missing NinjaTrader source facts.");
      continue;
    }
    const sourceId = resolved.get(input.sourceKey);
    if (!sourceId) continue;
    const group = `ninjatrader-v2:${JSON.stringify([sourceId, input.instrument])}`;
    const signature = economics(row, input.instrument);
    const occurrenceKey = JSON.stringify([group, signature]);
    const index = occurrences.get(occurrenceKey) ?? 0;
    if (!input.executionId) occurrences.set(occurrenceKey, index + 1);
    const id = input.executionId
      ? `execution:${input.executionId}`
      : `fill:${digest(signature)}:${index}`;
    const meta: ImportMetadata = {
      id,
      group,
      order: 0,
      preserveFee: true,
      ninjaTrader: {
        sourceId,
        instrument: input.instrument,
        executionId: input.executionId,
        effect: input.effect,
        sequence: input.sequence,
        reportedFee: input.reportedFee,
      },
    };
    const effectiveFee =
      input.reportedFee ?? defaultFee(row.fee, row.quantity, accountId, row.symbol, defaults);
    if (input.reportedFee === undefined) missingFees++;
    const fill: Execution = {
      ...row,
      accountId,
      source: "import",
      id: `preview_${digest([group, id]).slice(0, 24)}`,
      fee: effectiveFee,
      importMetadata: meta,
    };
    if (
      legacyHashes.has(
        executionHash({
          ...row,
          executedAt: row.executedAt.replace(/\.\d{3}Z$/, ".000Z"),
          importMetadata: undefined,
        }),
      )
    )
      conflicts.add(
        "This account contains matching legacy fills without reliable source identity. Recover the complete export into a new journal account; the old account and annotations will remain unchanged.",
      );
    const key = identity(fill),
      prior = incoming.get(key);
    if (prior) {
      if (
        economics(prior, facts(prior)!.instrument) !== signature ||
        !equalFee(facts(prior)!.reportedFee, input.reportedFee) ||
        facts(prior)!.effect !== input.effect ||
        facts(prior)!.sequence !== input.sequence
      )
        conflicts.add(
          "One execution ID has contradictory values within this export. Correct the file before importing.",
        );
      duplicates++;
      continue;
    }
    incoming.set(key, fill);
  }
  const canonical = [...incoming.values()]
    .map((e) => [
      identity(e),
      economics(e, facts(e)!.instrument),
      facts(e)!.reportedFee ?? null,
      facts(e)!.effect ?? null,
      facts(e)!.sequence ?? null,
    ])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const fingerprint = digest(canonical);
  const seenBatch = batches.some((b) => b.fingerprint === fingerprint);
  const sourceIds = [...new Set(resolved.values())].sort();
  for (const batch of batches) {
    if (
      batch.timeZone !== timeZone &&
      (JSON.parse(batch.sourceIdsJson) as string[]).some((id) => sourceIds.includes(id))
    )
      conflicts.add(
        "This source has earlier imports using a different statement timezone. Use the original timezone or recover the corrected complete history into a new journal account.",
      );
  }
  const inserts: Execution[] = [],
    corrections: ImportReview["corrections"] = [];
  const proposed = new Map<string, Execution>(
    existing.map((e) => [
      e.id,
      { ...e, importMetadata: e.importMetadata ? structuredClone(e.importMetadata) : undefined },
    ]),
  );
  const schemes = new Map<string, Set<string>>();
  for (const fill of [...existing, ...incoming.values()]) {
    if (!facts(fill)) continue;
    const key = JSON.stringify([facts(fill)!.sourceId, economics(fill, facts(fill)!.instrument)]);
    const set = schemes.get(key) ?? new Set<string>();
    set.add(facts(fill)!.executionId ? "id" : "count");
    schemes.set(key, set);
  }
  if ([...schemes.values()].some((set) => set.size > 1))
    conflicts.add(
      "Matching fills use different execution-ID layouts. Keep the ID columns consistent or reconcile the complete history in a new journal account.",
    );
  for (const [key, fill] of incoming) {
    const previous = oldByIdentity.get(key);
    if (!previous) {
      inserts.push(fill);
      proposed.set(fill.id, fill);
      continue;
    }
    const before = facts(previous)!,
      after = facts(fill)!;
    if (
      economics(previous, before.instrument) !== economics(fill, after.instrument) ||
      before.effect !== after.effect ||
      before.sequence !== after.sequence
    ) {
      conflicts.add(
        `${fill.symbol}: an existing execution ID has changed quantity, price, side, instrument, time or ordering facts. Reconcile it separately; it will not be inserted again.`,
      );
      continue;
    }
    if (!equalFee(before.reportedFee, after.reportedFee)) {
      if (!after.executionId) {
        conflicts.add(
          "Fees changed on fills without execution IDs. Reconcile the complete history separately; occurrence numbers cannot reliably identify corrected fills.",
        );
        continue;
      }
      corrections.push({
        symbol: fill.symbol,
        executedAt: fill.executedAt,
        oldFee: previous.fee,
        newFee: fill.fee,
      });
      proposed.set(previous.id, { ...fill, id: previous.id });
    } else duplicates++;
  }
  let needsCompleteHistory = false;
  const noIdGroups = new Set(
    [...incoming.values()]
      .filter((e) => !facts(e)!.executionId)
      .map((e) => e.importMetadata!.group!),
  );
  for (const group of noIdGroups) {
    const current = [...incoming.values()].filter((e) => e.importMetadata!.group === group);
    const from = current.reduce(
      (min, e) => (e.executedAt < min ? e.executedAt : min),
      current[0]!.executedAt,
    );
    const to = current.reduce(
      (max, e) => (e.executedAt > max ? e.executedAt : max),
      current[0]!.executedAt,
    );
    const previous = existing.filter(
      (e) => e.importMetadata?.group === group && e.executedAt >= from && e.executedAt <= to,
    );
    if (previous.length && !seenBatch) {
      needsCompleteHistory = true;
      if (!options.completeHistory)
        conflicts.add(
          "This export overlaps earlier fills without execution IDs. Confirm it includes every execution for these source contracts between its first and last timestamp, or supply a complete export.",
        );
      else if (previous.some((e) => !incoming.has(identity(e))))
        conflicts.add(
          "The declared complete export omits or changes previously imported fills in its covered period. Reconcile the difference or recover into a new journal account; nothing will be removed automatically.",
        );
    }
  }
  if (noIdGroups.size)
    warnings.add(
      "Without execution IDs, identical-looking new fills cannot be distinguished from an exact repeated export. Complete exports retain their full counts; ambiguous partial overlaps require reconciliation.",
    );
  if (missingFees)
    warnings.add(
      `${missingFees} rows omit commission. The preview uses your configured default fees, or zero when none are configured.`,
    );
  const multiplierRows = [
    ...new Set(parsed.executions.filter((e) => e.assetClass === "futures").map((e) => e.symbol)),
  ].map((symbol) => ({ symbol, value: multipliers[symbol] ?? null }));
  for (const item of multiplierRows)
    if (!(item.value !== null && Number.isFinite(item.value) && item.value > 0))
      conflicts.add(
        `Set a positive contract multiplier for ${item.symbol} in Settings, then review this import again.`,
      );
  const all = [...proposed.values()];
  for (const error of orderNinjaTraderFills(all)) conflicts.add(error);
  const projected = buildRoundTrips(all, {
    method: account.profitCalcMethod as ProfitCalcMethod,
    multipliers,
  });
  const keys = new Set(projected.map((t) => t.key));
  if (oldTrades.some((t) => !keys.has(t.key)))
    conflicts.add(
      "This import would replace existing trade identities and could orphan reviews or attachments. Recover the complete history into a new journal account instead.",
    );
  const metrics = computeMetrics(projected, { timeZone: getTimeZone() });
  const storedById = new Map(stored.map((row) => [row.id, row]));
  const updates = all.filter((e) => {
    const old = storedById.get(e.id);
    return (
      old &&
      (old.fee !== e.fee ||
        old.importMetadataJson !== (e.importMetadata ? JSON.stringify(e.importMetadata) : null))
    );
  });
  const review: ImportReview = {
    sources: sourceChoices,
    savedSources: savedSources.map((s) => ({ id: s.id, name: s.name })),
    inserted: inserts.length,
    duplicates,
    corrections,
    conflicts: [...conflicts],
    warnings: [...warnings],
    needsCompleteHistory,
    totals: conflicts.size
      ? null
      : {
          closedTrades: metrics.closedTrades,
          openTrades: projected.filter((t) => t.status === "open").length,
          netPnl: metrics.netPnl,
          fees: metrics.fees,
        },
    multipliers: multiplierRows,
    currency: account.currency,
    token: null,
  };
  if (!conflicts.size && (!corrections.length || options.approveFeeCorrections))
    review.token = digest({
      version: 2,
      account,
      stored,
      oldTrades,
      savedSources,
      savedAliases,
      batches,
      defaults,
      multipliers,
      timeZone,
      contentHash: digest(content),
      canonical,
      options: {
        sourceMappings: options.sourceMappings ?? {},
        completeHistory: !!options.completeHistory,
        approveFeeCorrections: !!options.approveFeeCorrections,
      },
    });
  const times = [...incoming.values()].map((e) => e.executedAt).sort();
  return {
    review,
    inserts,
    updates,
    sources,
    aliases,
    batch: {
      id: newId(),
      accountId,
      format: FORMAT,
      fingerprint,
      rawHash: digest(content),
      timeZone,
      sourceIdsJson: JSON.stringify(sourceIds),
      fromTime: times[0] ?? "",
      toTime: times.at(-1) ?? "",
      snapshotJson: JSON.stringify(canonical),
      createdAt: nowIso(),
    },
  };
}

export const previewNinjaTraderImport = (
  accountId: string,
  parsed: ParsedImport,
  content: string,
  timeZone: string,
  options: ImportReviewOptions = {},
) => db.transaction(() => planImport(accountId, parsed, content, timeZone, options).review);

export const commitNinjaTraderImport = (
  accountId: string,
  parsed: ParsedImport,
  content: string,
  timeZone: string,
  options: ImportReviewOptions = {},
) =>
  db.transaction(
    (tx) => {
      const plan = planImport(accountId, parsed, content, timeZone, options);
      requireValue(plan.review.conflicts.length === 0, plan.review.conflicts.join(" "));
      requireValue(
        !plan.review.corrections.length || options.approveFeeCorrections,
        "Review and approve the commission corrections before importing.",
      );
      requireValue(
        options.previewToken && options.previewToken === plan.review.token,
        "The import or journal changed since preview. Review the import again before saving.",
      );
      for (const source of plan.sources)
        tx.insert(importSources).values(source).onConflictDoNothing().run();
      for (const alias of plan.aliases)
        tx.insert(importSourceAliases).values(alias).onConflictDoNothing().run();
      for (const fill of plan.inserts)
        tx.insert(executions)
          .values({
            id: newId(),
            accountId,
            symbol: fill.symbol,
            side: fill.side,
            quantity: fill.quantity,
            price: fill.price,
            fee: fill.fee,
            executedAt: fill.executedAt,
            assetClass: fill.assetClass ?? null,
            source: "import",
            contentHash: executionHash(fill),
            importMetadataJson: JSON.stringify(fill.importMetadata),
            createdAt: nowIso(),
          })
          .run();
      for (const fill of plan.updates)
        tx.update(executions)
          .set({ fee: fill.fee, importMetadataJson: JSON.stringify(fill.importMetadata) })
          .where(eq(executions.id, fill.id))
          .run();
      if (plan.inserts.length || plan.updates.length) rebuildAccount(accountId);
      tx.insert(importBatches).values(plan.batch).onConflictDoNothing().run();
      return {
        inserted: plan.inserts.length,
        duplicates: plan.review.duplicates,
        corrected: plan.review.corrections.length,
        skipped: 0,
        skippedReasons: [],
        warnings: plan.review.warnings,
      };
    },
    { behavior: "immediate" },
  );
