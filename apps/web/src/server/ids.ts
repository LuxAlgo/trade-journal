import { createHash, randomBytes } from "node:crypto";

export const newId = (): string => randomBytes(9).toString("base64url");

export const nowIso = (): string => new Date().toISOString();

/** Content hash for execution dedup: identical fills insert once per account. */
export const executionHash = (execution: {
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  executedAt: string;
}): string =>
  createHash("sha256")
    .update(
      [
        execution.symbol,
        execution.side,
        execution.quantity.toPrecision(12),
        execution.price.toPrecision(12),
        execution.executedAt,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);
