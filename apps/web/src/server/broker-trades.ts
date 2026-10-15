import type { Trade } from "@luxalgo/broker-sdk";
import type { ImportedExecution } from "@luxalgo/journal-importers";

/**
 * SDK fills as journal executions. Broker sync and statement uploads share this
 * mapping so the same fill has the same content hash from either path.
 */
export const brokerTradesToExecutions = (
  trades: Trade[],
): { timed: ImportedExecution[]; untimed: number } => {
  const rows: ImportedExecution[] = trades.map((trade) => ({
    symbol: trade.symbol,
    side: trade.side,
    quantity: trade.quantity,
    price: trade.price,
    fee: trade.fee ?? 0,
    // The SDK omits unparseable timestamps; a fill with no time can't be
    // journaled meaningfully, so it is dropped rather than guessed at.
    executedAt: trade.executedAt ?? "",
  }));
  const timed = rows.filter((row) => row.executedAt !== "");
  return { timed, untimed: rows.length - timed.length };
};

export const untimedFillsReason = (untimed: number, statementTimeZone: boolean): string =>
  statementTimeZone
    ? `${untimed} fill(s) had no usable timestamp. Check for missing or invalid dates, unsupported timezone suffixes, or ambiguous or nonexistent daylight-saving times.`
    : `${untimed} fill(s) had no usable timestamp.`;
