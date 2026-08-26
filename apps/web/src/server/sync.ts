import { connect, listBrokers, type BrokerId } from "@luxalgo/broker-sdk";
import { eq } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import { accounts, db } from "@/db";
import { decryptJson, encryptJson } from "./crypto";
import { nowIso } from "./ids";
import { insertExecutions, type InsertResult } from "./executions";

/** All broker connectivity goes through @luxalgo/broker-sdk — never direct API code. */
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

  const credentials = decryptJson<Record<string, string>>(account.credentialsEnc);
  const connection = connect({
    broker: account.broker as BrokerId,
    credentials,
    // Some brokers rotate tokens on every fetch (Questrade) — persist or die.
    onCredentialsRotated: (next: Record<string, string>) => {
      db.update(accounts)
        .set({ credentialsEnc: encryptJson(next) })
        .where(eq(accounts.id, accountId))
        .run();
    },
  } as Parameters<typeof connect>[0]);

  const snapshot = await connection.fetchSnapshot();
  const syncedAt = nowIso();

  const rows: ImportedExecution[] = snapshot.accounts.flatMap((brokerAccount) =>
    brokerAccount.trades.map((trade) => ({
      symbol: trade.symbol,
      side: trade.side,
      quantity: trade.quantity,
      price: trade.price,
      fee: trade.fee ?? 0,
      // The SDK omits unparseable timestamps; a fill with no time can't be
      // journaled meaningfully, so it is dropped rather than guessed at.
      executedAt: trade.executedAt ?? "",
    })),
  );
  const usable = rows.filter((row) => row.executedAt !== "");

  const result = insertExecutions(accountId, usable, "sync");

  const equity = snapshot.accounts.reduce((total, a) => total + a.equity, 0);
  const positions = snapshot.accounts.flatMap((a) => a.positions);
  db.update(accounts)
    .set({
      lastSyncAt: syncedAt,
      snapshotJson: JSON.stringify({ equity, positions, fetchedAt: snapshot.fetchedAt }),
    })
    .where(eq(accounts.id, accountId))
    .run();

  return { accountId, ...result, equity, positions: positions.length, syncedAt };
};
