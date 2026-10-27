import type { Trade } from "@luxalgo/broker-sdk";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import { executionHash } from "./ids";

/**
 * SDK trades carry no fill ID, so one order filling in identical pieces (same
 * symbol, side, size, price and time) would collapse into one execution. Each
 * record is a separate fill: number the later copies so every one is kept. The
 * numbers count copies, not positions, so a reordered batch keeps its hashes.
 */
const numberIdenticalFills = (rows: ImportedExecution[]): ImportedExecution[] => {
  const copies = new Map<string, number>();
  return rows.map((row) => {
    const hash = executionHash(row);
    const occurrence = copies.get(hash) ?? 0;
    copies.set(hash, occurrence + 1);
    return occurrence ? { ...row, occurrence } : row;
  });
};

/**
 * SDK fills as journal executions. Broker sync and statement uploads share this
 * mapping so the same fill has the same content hash from either path.
 */
export const brokerTradesToExecutions = (
  trades: Trade[],
): {
  timed: ImportedExecution[];
  untimed: number;
  /** Whether each timed row opened or closed a position, where the broker says so. */
  positionEffects: Map<ImportedExecution, "open" | "close">;
} => {
  // The SDK omits unparseable timestamps; a fill with no time can't be
  // journaled meaningfully, so it is dropped rather than guessed at.
  const timedTrades = trades.filter((trade) => trade.executedAt);
  const timed = numberIdenticalFills(
    timedTrades.map((trade) => ({
      symbol: trade.symbol,
      side: trade.side,
      quantity: trade.quantity,
      price: trade.price,
      fee: trade.fee ?? 0,
      executedAt: trade.executedAt!,
      // The SDK's "cash" has no journal equivalent.
      ...(trade.assetClass && trade.assetClass !== "cash" ? { assetClass: trade.assetClass } : {}),
      // A hedge-mode side (Binance) is its own position, so it must not net with the other.
      ...(trade.positionSide
        ? { importMetadata: { id: "sync", group: `sync-hedge:${trade.positionSide}`, order: 0 } }
        : {}),
    })),
  );
  const positionEffects = new Map<ImportedExecution, "open" | "close">();
  timed.forEach((row, index) => {
    const effect = timedTrades[index]!.positionEffect;
    if (effect) positionEffects.set(row, effect);
  });
  return { timed, untimed: trades.length - timedTrades.length, positionEffects };
};

export const untimedFillsReason = (untimed: number, statementTimeZone: boolean): string =>
  statementTimeZone
    ? `${untimed} fill(s) had no usable timestamp. Check for missing or invalid dates, unsupported timezone suffixes, or ambiguous or nonexistent daylight-saving times.`
    : `${untimed} fill(s) had no usable timestamp.`;
