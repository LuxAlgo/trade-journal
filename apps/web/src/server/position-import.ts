import { eq } from "drizzle-orm";
import { positionFillProblem, type ImportedExecution } from "@luxalgo/journal-importers";
import { db, executions } from "@/db";
import { executionHash } from "./ids";

/** Facts which a repeat import may not silently correct or reinterpret. */
const facts = (fill: ImportedExecution) =>
  JSON.stringify([
    fill.symbol,
    fill.side,
    fill.quantity,
    fill.price,
    Date.parse(fill.executedAt),
    fill.importMetadata?.group,
    fill.importMetadata?.position?.contract,
    fill.importMetadata?.position?.direction,
    fill.importMetadata?.position?.effect,
    fill.importMetadata?.position?.positionId,
    fill.importMetadata?.position?.executionId,
    fill.importMetadata?.position?.sequence,
    Boolean(fill.importMetadata?.preserveFee),
    fill.importMetadata?.preserveFee ? fill.fee : null,
  ]);

/** Validate the combined, deduplicated history inside the insertion transaction. */
export function positionImportErrors(accountId: string, incoming: ImportedExecution[]): string[] {
  if (!incoming.length) return [];
  const symbols = new Set(incoming.map((fill) => fill.symbol));
  const existing: ImportedExecution[] = db
    .select()
    .from(executions)
    .where(eq(executions.accountId, accountId))
    .all()
    .filter((row) => symbols.has(row.symbol))
    .map((row) => ({
      symbol: row.symbol,
      side: row.side as "buy" | "sell",
      quantity: row.quantity,
      price: row.price,
      fee: row.fee,
      executedAt: row.executedAt,
      importMetadata: row.importMetadataJson ? JSON.parse(row.importMetadataJson) : undefined,
    }));
  const combined = [...existing, ...incoming];
  const positionSymbols = new Set(
    combined.filter((fill) => fill.importMetadata?.position).map((fill) => fill.symbol),
  );
  if (!positionSymbols.size) return [];
  const errors: string[] = [];
  for (const symbol of positionSymbols) {
    const relevant = combined.filter((fill) => fill.symbol === symbol);
    if (relevant.some((fill) => !fill.importMetadata?.position)) {
      errors.push(
        `${symbol}: Open/Close position fills cannot be mixed with Buy/Sell-only or other import histories for this contract. Import its complete position-labelled history into a separate journal account and compare it before retiring the original. Nothing was saved.`,
      );
    }
    for (const key of ["contract", "positionId", "executionId"] as const) {
      if (
        new Set(
          relevant
            .filter((fill) => fill.importMetadata?.position)
            .map((fill) => Boolean(fill.importMetadata!.position![key])),
        ).size > 1
      )
        errors.push(
          `${symbol}: the ${{ contract: "Contract", positionId: "Position ID", executionId: "Execution ID" }[key]} columns differ from the saved history. Use a consistent export, or import the complete history into a separate journal account. Nothing was saved.`,
        );
    }
  }
  const nativeIds = new Map<string, ImportedExecution>();
  const merged = new Map<string, ImportedExecution>();
  const incomingHashes = new Set<string>();
  for (const [index, fill] of combined.entries()) {
    const position = fill.importMetadata?.position;
    if (!position) continue;
    const problem = positionFillProblem(fill);
    if (problem) {
      errors.push(problem);
      continue;
    }
    const hash = executionHash(fill);
    if (index >= existing.length) {
      if (!position.executionId && incomingHashes.has(hash))
        errors.push(
          `${fill.symbol}: indistinguishable position fills need an Execution ID column. Repeated rows without fill IDs cannot safely be counted or discarded.`,
        );
      incomingHashes.add(hash);
    }
    if (position.executionId) {
      const identity = JSON.stringify([fill.symbol, position.contract, position.executionId]);
      const old = nativeIds.get(identity);
      if (old && facts(old) !== facts(fill))
        errors.push(
          `${fill.symbol}: Execution ID ${position.executionId} has changed facts. Import the corrected complete history into a separate journal account; existing trades were not changed.`,
        );
      nativeIds.set(identity, fill);
    }
    const duplicate = merged.get(hash);
    if (duplicate && facts(duplicate) !== facts(fill))
      errors.push(
        `${fill.symbol}: a previously imported fill has different fees, position information or ordering. Import the corrected complete history into a separate journal account.`,
      );
    if (!duplicate) merged.set(hash, fill);
  }
  if (errors.length) return [...new Set(errors)];

  const groups = new Map<string, ImportedExecution[]>();
  for (const fill of merged.values()) {
    const key = JSON.stringify([fill.symbol, fill.importMetadata!.group]);
    const group = groups.get(key) ?? [];
    group.push(fill);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        Date.parse(a.executedAt) - Date.parse(b.executedAt) ||
        a.importMetadata!.order - b.importMetadata!.order,
    );
    let quantity = 0;
    for (let i = 0; i < group.length;) {
      const time = Date.parse(group[i]!.executedAt);
      const tied: ImportedExecution[] = [];
      while (i < group.length && Date.parse(group[i]!.executedAt) === time) tied.push(group[i++]!);
      const sequences = tied.map((fill) => fill.importMetadata!.position!.sequence);
      const sequenced =
        sequences.every((sequence) => sequence !== undefined) &&
        new Set(sequences).size === tied.length;
      const economicOrders = new Set(
        tied.map((fill) =>
          JSON.stringify([
            fill.importMetadata!.position!.effect,
            fill.price,
            fill.importMetadata!.preserveFee ? fill.fee / fill.quantity : null,
          ]),
        ),
      );
      if (tied.length > 1 && !sequenced && economicOrders.size > 1) {
        errors.push(
          `${group[0]!.symbol} at ${group[i - 1]!.executedAt}: position fill order is ambiguous. Export a reliable Sequence column or more precise timestamps; CSV row order is not assumed.`,
        );
        break;
      }
      let invalid = false;
      for (const fill of tied) {
        const position = fill.importMetadata!.position!;
        if (position.effect === "close" && fill.quantity > quantity + 1e-9) {
          errors.push(
            `${fill.symbol}: Close ${position.direction} at ${fill.executedAt} exceeds the matching open quantity (${quantity}). Include the missing opening fills, or select the account containing them. Nothing was saved.`,
          );
          invalid = true;
          break;
        }
        quantity += position.effect === "open" ? fill.quantity : -fill.quantity;
        if (!Number.isFinite(quantity)) {
          errors.push(`${fill.symbol}: position quantity is too large.`);
          invalid = true;
          break;
        }
        if (Math.abs(quantity) < 1e-9) quantity = 0;
      }
      if (invalid) break;
    }
  }
  return [...new Set(errors)];
}
