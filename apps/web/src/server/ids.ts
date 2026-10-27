import { createHash, randomBytes } from "node:crypto";

export const newId = (): string => randomBytes(9).toString("base64url");

export const nowIso = (): string => new Date().toISOString();

/**
 * Content hash for execution dedup: the same fill inserts once per account.
 * Numbered copies of an identical fill hash apart; the first copy keeps the
 * plain hash, so fills stored before numbering existed still deduplicate. A
 * fill kept only in part hashes with the quantity the broker reported.
 */
export const executionHash = (execution: {
  symbol: string;
  side: string;
  quantity: number;
  hashQuantity?: number;
  price: number;
  executedAt: string;
  importMetadata?: { id: string; group?: string };
  occurrence?: number;
}): string =>
  createHash("sha256")
    .update(
      [
        execution.symbol,
        execution.side,
        (execution.hashQuantity ?? execution.quantity).toPrecision(12),
        execution.price.toPrecision(12),
        execution.executedAt,
        ...(execution.importMetadata
          ? ["history", execution.importMetadata.group ?? "", execution.importMetadata.id]
          : []),
        ...(execution.occurrence ? ["occurrence", String(execution.occurrence)] : []),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);
