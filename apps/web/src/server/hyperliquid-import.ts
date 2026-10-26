import { and, eq } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import { accounts, db, executions } from "@/db";

const fillKey = (fill: Pick<ImportedExecution, "symbol" | "side" | "quantity" | "price">) =>
  [fill.symbol, fill.side, fill.quantity.toPrecision(12), fill.price.toPrecision(12)].join("|");

/**
 * Hyperliquid's export rounds fill times to the second, so a file's fills never
 * share a content hash with the same fills from broker sync, which keeps
 * milliseconds. Sync owns an account's history from its first synced fill
 * onward: it refetches recent fills and deduplicates them itself. A file
 * imported into a synced account therefore adds only the older fills sync
 * cannot reach. A file time is the start of its second, so a fill is older only
 * when that whole second ends by the first synced fill.
 *
 * If none of the file's fills inside the synced period match a synced fill, the
 * statement timezone (or the wallet) is wrong, and the boundary would land in
 * the wrong place. Nothing is saved in that case.
 */
export const reconcileHyperliquidSync = (
  accountId: string,
  incoming: ImportedExecution[],
): {
  executions: ImportedExecution[];
  covered: number;
  since: string | null;
  problem: string | null;
} => {
  const unchanged = { executions: incoming, covered: 0, since: null, problem: null };
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) return unchanged;
  if (account.kind === "sync" && account.broker !== "hyperliquid")
    return {
      ...unchanged,
      problem:
        "This account syncs from another broker. Import Hyperliquid history into its Hyperliquid account or into a separate journal account. Nothing was saved.",
    };
  const synced = db
    .select()
    .from(executions)
    .where(and(eq(executions.accountId, accountId), eq(executions.source, "sync")))
    .all();
  if (!synced.length)
    return account.kind === "sync"
      ? {
          ...unchanged,
          problem:
            "Sync this Hyperliquid account before importing its history from a file, so the file adds only the fills sync cannot reach. Nothing was saved.",
        }
      : unchanged;

  let first = Infinity;
  let last = -Infinity;
  const syncedTimes = new Map<string, number[]>();
  for (const fill of synced) {
    const time = Date.parse(fill.executedAt);
    first = Math.min(first, time);
    last = Math.max(last, time);
    const key = fillKey(fill);
    const keyTimes = syncedTimes.get(key);
    if (keyTimes) keyTimes.push(time);
    else syncedTimes.set(key, [time]);
  }
  const older = incoming.filter((fill) => Date.parse(fill.executedAt) + 1000 <= first);
  const covered = incoming.length - older.length;
  const since = new Date(first).toISOString();

  const inSyncedPeriod = incoming.filter((fill) => {
    const time = Date.parse(fill.executedAt);
    return time + 1000 > first && time < last + 1000;
  });
  const matches = inSyncedPeriod.some((fill) =>
    syncedTimes
      .get(fillKey(fill))
      ?.some((time) => Math.abs(time - Date.parse(fill.executedAt)) < 1000),
  );
  if (inSyncedPeriod.length && !matches)
    return {
      ...unchanged,
      problem: `None of this file's ${inSyncedPeriod.length} fill(s) from ${since} onward match the fills broker sync stored in this account. Check that the file is from this account's wallet and that the statement timezone is the timezone of the browser it was exported from. Nothing was saved.`,
    };
  return { executions: older, covered, since, problem: null };
};
