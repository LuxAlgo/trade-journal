import { connect, listBrokers, type BrokerId } from "@luxalgo/broker-sdk";
import { and, eq } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import { accounts, db, executions } from "@/db";
import { decryptJson, encryptJson } from "./crypto";
import { executionHash, nowIso } from "./ids";
import { brokerTradesToExecutions, untimedFillsReason } from "./broker-trades";
import { expiredOptionCloses, keepWithinHistory, type SyncedFill } from "./broker-history";
import { insertExecutions, type InsertResult } from "./executions";
import { getImportTimeZone, getMultipliers, setSetting } from "./settings";
import { requireValue } from "./api";
import {
  assertIbkrSyncTimeZone,
  canonicalImportTimeZone,
  isIbkrSyncAccount,
} from "./ibkr-sync-timezone";
import { withoutSummaryRows } from "./ibkr-flex-xml-import";

/** All broker connectivity goes through @luxalgo/broker-sdk, never direct API code. */
export { listBrokers };

/** The asset class whose fills a broker's complete position list can vouch for. */
const CHECKED_ASSET_CLASS: Record<string, string> = { webull: "equity" };
/** Later syncs re-read this much before the last one, for orders that filled after placement. */
const HISTORY_OVERLAP_MS = 30 * 86_400_000;

/**
 * The SDK reads every Flex `<Trade>` row as a fill. Keep execution rows only,
 * as file uploads do, so order and summary rows are not journaled as fills.
 */
const flexExecutionRowsOnly: typeof globalThis.fetch = async (input, init) => {
  const response = await fetch(input, init);
  return new Response(withoutSummaryRows(await response.text()).xml, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

export interface SyncOutcome extends InsertResult {
  accountId: string;
  equity: number | null;
  positions: number;
  syncedAt: string;
}

export const syncAccount = async (accountId: string): Promise<SyncOutcome> => {
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) throw new Error("Account not found");
  if (account.kind !== "sync" || !account.credentialsEnc) {
    throw new Error("Account is not broker-connected");
  }

  const statementTimeZone = isIbkrSyncAccount(account)
    ? canonicalImportTimeZone(getImportTimeZone())
    : undefined;
  if (statementTimeZone !== undefined) assertIbkrSyncTimeZone(account, statementTimeZone);

  const credentials = decryptJson<Record<string, string>>(account.credentialsEnc);
  // Brokers that page through trade history (Webull) only need recent fills
  // once history has landed; refetched fills dedupe by content hash.
  const hasSyncedFills = db
    .select({ id: executions.id })
    .from(executions)
    .where(and(eq(executions.accountId, accountId), eq(executions.source, "sync")))
    .get();
  const historySince =
    hasSyncedFills && account.lastSyncAt
      ? new Date(Date.parse(account.lastSyncAt) - HISTORY_OVERLAP_MS).toISOString()
      : undefined;
  const connection = connect({
    broker: account.broker as BrokerId,
    credentials,
    ...(historySince !== undefined ? { historySince } : {}),
    ...(statementTimeZone !== undefined ? { statementTimeZone } : {}),
    ...(isIbkrSyncAccount(account) ? { fetch: flexExecutionRowsOnly } : {}),
    // Some brokers rotate tokens on every fetch (Questrade): persist or die.
    onCredentialsRotated: (next: Record<string, string>) => {
      db.update(accounts)
        .set({ credentialsEnc: encryptJson(next) })
        .where(eq(accounts.id, accountId))
        .run();
    },
  } as Parameters<typeof connect>[0]);

  const snapshot = await connection.fetchSnapshot();
  const syncedAt = nowIso();

  const trades = snapshot.accounts.flatMap((brokerAccount) => brokerAccount.trades);
  // Option P&L needs the contract size; the broker's value never replaces the user's.
  const multipliers = getMultipliers();
  const stated = trades.filter(
    (trade) => trade.multiplier && multipliers[trade.symbol] === undefined,
  );
  for (const trade of stated) multipliers[trade.symbol] = trade.multiplier!;
  if (stated.length > 0) setSetting("multipliers", JSON.stringify(multipliers));
  const { timed, untimed, positionEffects } = brokerTradesToExecutions(trades);

  // A broker whose position list is complete for an asset class can show
  // which unlabeled fills reach back before the start of its history.
  const checked = CHECKED_ASSET_CLASS[account.broker ?? ""];
  const brokerQuantities = new Map<string, number>();
  for (const position of snapshot.accounts.flatMap((a) => a.positions)) {
    brokerQuantities.set(
      position.symbol,
      (brokerQuantities.get(position.symbol) ?? 0) + position.quantity,
    );
  }
  const brokerQuantity = (symbol: string) =>
    checked ? (brokerQuantities.get(symbol) ?? 0) : undefined;
  let dropped = 0;
  let trimmed = 0;
  const withinHistory = (fills: ImportedExecution[]): ImportedExecution[] => {
    const stored = db.select().from(executions).where(eq(executions.accountId, accountId)).all();
    const storedHashes = new Set(stored.map((row) => row.contentHash));
    const fresh = fills.filter((fill) => !storedHashes.has(executionHash(fill)));
    const groupOf = (json: string | null) =>
      json ? (JSON.parse(json) as { group?: string }).group : undefined;
    const keep = keepWithinHistory(
      stored.map((row) => ({
        ...row,
        side: row.side as "buy" | "sell",
        group: groupOf(row.importMetadataJson),
      })),
      fresh.map((fill) => ({
        ...fill,
        group: fill.importMetadata?.group,
        positionEffect: positionEffects.get(fill),
      })),
      brokerQuantity,
      checked,
    );
    const kept = new Map([...keep].map(([index, quantity]) => [fresh[index]!, quantity]));
    dropped = [...keep.values()].filter((quantity) => quantity < 1e-9).length;
    trimmed = keep.size - dropped;
    // Repeats of stored fills go through, so the insert counts them as duplicates.
    return fills.flatMap((fill) => {
      const quantity = kept.get(fill);
      if (quantity === undefined) return [fill];
      if (quantity < 1e-9) return [];
      // The kept part hashes as the broker's whole fill, so later syncs still match it.
      const fee = (fill.fee * quantity) / fill.quantity;
      return [{ ...fill, quantity, fee, hashQuantity: fill.quantity }];
    });
  };

  const equity = snapshot.accounts.reduce((total, a) => total + a.equity, 0);
  const positions = snapshot.accounts.flatMap((a) => a.positions);
  const result = db.transaction(
    () => {
      if (statementTimeZone !== undefined) {
        const current = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
        requireValue(
          current &&
            isIbkrSyncAccount(current) &&
            current.credentialsEnc === account.credentialsEnc,
          "The IBKR connection changed during sync. Try again.",
        );
        assertIbkrSyncTimeZone(current, statementTimeZone);
      }
      // Validation, history provenance, deduplication and sync status commit together.
      const inserted = insertExecutions(accountId, withinHistory(timed), "sync");
      if (account.broker === "webull") {
        const optionFills = db
          .select()
          .from(executions)
          .where(and(eq(executions.accountId, accountId), eq(executions.assetClass, "option")))
          .all()
          .map((row) => ({ ...row, side: row.side as "buy" | "sell" }));
        const expired = expiredOptionCloses(optionFills, syncedAt).map((fill) => ({
          ...fill,
          assetClass: "option" as const,
          price: 0,
          fee: 0,
        }));
        // An expiry has no commission, so default fee rules must not add one.
        if (expired.length > 0)
          inserted.inserted += insertExecutions(accountId, expired, "sync", undefined, {
            preserveFees: true,
          }).inserted;
      }
      db.update(accounts)
        .set({
          lastSyncAt: syncedAt,
          snapshotJson: JSON.stringify({ equity, positions, fetchedAt: snapshot.fetchedAt }),
          ...(statementTimeZone !== undefined && inserted.inserted > 0
            ? { ibkrSyncTimeZone: statementTimeZone }
            : {}),
        })
        .where(eq(accounts.id, accountId))
        .run();
      return inserted;
    },
    { behavior: "immediate" },
  );
  if (dropped > 0) {
    result.skipped += dropped;
    if (result.skippedReasons.length < 5)
      result.skippedReasons.push(
        `${dropped} fill(s) closed a position opened before the broker's available history and were skipped.`,
      );
  }
  if (trimmed > 0) {
    result.skipped += trimmed;
    if (result.skippedReasons.length < 5)
      result.skippedReasons.push(
        `${trimmed} fill(s) also closed a position opened before the broker's available history; only the part that history covers was kept.`,
      );
  }
  if (untimed > 0) {
    result.skipped += untimed;
    if (result.skippedReasons.length < 5)
      result.skippedReasons.push(untimedFillsReason(untimed, statementTimeZone !== undefined));
  }

  return { accountId, ...result, equity, positions: positions.length, syncedAt };
};
