import { connect, listBrokers, type BrokerId } from "@luxalgo/broker-sdk";
import { and, eq } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import { accounts, db, executions } from "@/db";
import { decryptJson, encryptJson } from "./crypto";
import { executionHash, nowIso } from "./ids";
import { insertExecutions, type InsertResult } from "./executions";
import { getImportTimeZone, getMultipliers, setSetting } from "./settings";
import { requireValue } from "./api";
import { expiredOptionCloses, orphanFills, type HistoryFill } from "./sync-history";
import {
  assertIbkrSyncTimeZone,
  canonicalImportTimeZone,
  isIbkrSyncAccount,
} from "./ibkr-sync-timezone";

/** All broker connectivity goes through @luxalgo/broker-sdk, never direct API code. */
export { listBrokers };

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
  // Once history has landed, adapters that page through it (Webull) only need
  // recent orders. The 30-day overlap catches orders placed earlier that filled
  // since, in case the broker filters by placement time; content-hash dedupe
  // absorbs the refetched fills.
  const hasSyncedFills = db
    .select({ id: executions.id })
    .from(executions)
    .where(and(eq(executions.accountId, accountId), eq(executions.source, "sync")))
    .get();
  const historySince =
    hasSyncedFills && account.lastSyncAt
      ? new Date(Date.parse(account.lastSyncAt) - 30 * 86_400_000).toISOString()
      : undefined;
  const connection = connect({
    broker: account.broker as BrokerId,
    credentials,
    ...(historySince !== undefined ? { historySince } : {}),
    ...(statementTimeZone !== undefined ? { statementTimeZone } : {}),
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
  const rows: ImportedExecution[] = trades.map((trade) => ({
    symbol: trade.symbol,
    side: trade.side,
    quantity: trade.quantity,
    price: trade.price,
    fee: trade.fee ?? 0,
    // The SDK omits unparseable timestamps; a fill with no time can't be
    // journaled meaningfully, so it is dropped rather than guessed at.
    executedAt: trade.executedAt ?? "",
    ...(trade.assetClass && trade.assetClass !== "cash" ? { assetClass: trade.assetClass } : {}),
  }));
  // Option contracts need their contract size for P&L; keep any user override.
  const multipliers = getMultipliers();
  let multipliersChanged = false;
  for (const trade of trades) {
    if (trade.multiplier && multipliers[trade.symbol] === undefined) {
      multipliers[trade.symbol] = trade.multiplier;
      multipliersChanged = true;
    }
  }
  if (multipliersChanged) setSetting("multipliers", JSON.stringify(multipliers));
  const timed = rows.filter((row) => row.executedAt !== "");
  const untimed = rows.length - timed.length;
  const effects = new Map(trades.map((trade, index) => [rows[index]!, trade.positionEffect]));

  // Webull's position list is complete, so it can arbitrate unlabeled fills
  // that close a position opened before the history floor.
  const brokerQuantities = new Map<string, number>();
  for (const position of snapshot.accounts.flatMap((a) => a.positions))
    brokerQuantities.set(
      position.symbol,
      (brokerQuantities.get(position.symbol) ?? 0) + position.quantity,
    );
  const brokerQuantity = (symbol: string) =>
    account.broker === "webull" ? (brokerQuantities.get(symbol) ?? 0) : undefined;
  let orphaned = 0;
  const withoutOrphans = (id: string, fills: ImportedExecution[]) => {
    const knownRows = db.select().from(executions).where(eq(executions.accountId, id)).all();
    const knownHashes = new Set(knownRows.map((row) => row.contentHash));
    const fresh = fills.filter((fill) => !knownHashes.has(executionHash(fill)));
    const dropped = orphanFills(
      knownRows as HistoryFill[],
      fresh.map((fill) => ({ ...fill, positionEffect: effects.get(fill) })),
      brokerQuantity,
    );
    orphaned = dropped.size;
    const orphans = new Set([...dropped].map((index) => fresh[index]));
    // Duplicates still go through so the insert reports them as such.
    return fills.filter((fill) => !orphans.has(fill));
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
      const inserted = insertExecutions(accountId, withoutOrphans(accountId, timed), "sync");
      if (account.broker === "webull") {
        const optionFills = db
          .select()
          .from(executions)
          .where(and(eq(executions.accountId, accountId), eq(executions.assetClass, "option")))
          .all() as HistoryFill[];
        const expired = expiredOptionCloses(optionFills, syncedAt).map((fill) => ({
          ...fill,
          assetClass: "option" as const,
          price: 0,
          fee: 0,
        }));
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
  if (orphaned > 0) {
    result.skipped += orphaned;
    if (result.skippedReasons.length < 5)
      result.skippedReasons.push(
        `${orphaned} fill(s) closed a position opened before the broker's available history and were skipped.`,
      );
  }
  if (untimed > 0) {
    result.skipped += untimed;
    if (result.skippedReasons.length < 5)
      result.skippedReasons.push(
        statementTimeZone !== undefined
          ? `${untimed} fill(s) had no usable timestamp. Check for missing or invalid dates, unsupported timezone suffixes, or ambiguous or nonexistent daylight-saving times.`
          : `${untimed} fill(s) had no usable timestamp.`,
      );
  }

  return { accountId, ...result, equity, positions: positions.length, syncedAt };
};
