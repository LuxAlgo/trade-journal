import { and, eq } from "drizzle-orm";
import { xtbWorkbookToStatement, type ImportedExecution } from "@luxalgo/journal-importers";
import { db, executions } from "@/db";
import { requireValue } from "./api";
import { XLSX_MAX_BYTES } from "@/lib/xlsx-import";
import { executionHash } from "./ids";

/** Decode an uploaded base64 .xlsx on the server; the browser never parses the workbook. */
export const xlsxStatement = async (base64: string): Promise<string> => {
  const tooLarge = "Excel uploads must be a .xlsx file of 5 MB or less.";
  requireValue(base64.length <= Math.ceil(XLSX_MAX_BYTES / 3) * 4, tooLarge);
  requireValue(/^[A-Za-z0-9+/]+={0,2}$/.test(base64), "This file is not an .xlsx workbook.");
  const bytes = Buffer.from(base64, "base64");
  requireValue(bytes.length <= XLSX_MAX_BYTES, tooLarge);
  try {
    return await xtbWorkbookToStatement(bytes);
  } catch (error) {
    // Reader and XTB layout errors describe the file, so they are the user's answer.
    if (error instanceof Error) requireValue(false, error.message);
    throw error;
  }
};

const isXtbEntry = (fill: ImportedExecution): boolean =>
  fill.importMetadata?.id === "entry" && Boolean(fill.importMetadata.group?.startsWith("xtb:"));

/** The same lot read from Open Positions and later from Closed Positions. */
const sameLot = (stored: ImportedExecution, incoming: ImportedExecution): boolean =>
  stored.symbol === incoming.symbol &&
  stored.side === incoming.side &&
  stored.quantity.toPrecision(12) === incoming.quantity.toPrecision(12) &&
  Math.abs(Date.parse(stored.executedAt) - Date.parse(incoming.executedAt)) < 1000 &&
  Math.abs(stored.price - incoming.price) <=
    1e-3 * Math.max(Math.abs(stored.price), Math.abs(incoming.price));

const describe = (fill: ImportedExecution) =>
  `${fill.side} ${fill.quantity} ${fill.symbol} at ${fill.price} on ${fill.executedAt}`;

/**
 * An XTB holding is stored as an entry fill keyed by its position id. When a
 * later workbook closes that position, its entry must be the stored one, or the
 * journal would keep a second, phantom open lot. A lot whose time or price
 * differ only by rounding is the same fill and is not inserted again; a lot
 * whose size or side changed (for example a partial close) is refused, because
 * which part was closed cannot be known. Nothing is saved in that case.
 */
export const reconcileXtbHoldings = (
  accountId: string,
  incoming: ImportedExecution[],
): { executions: ImportedExecution[]; matched: number; problem: string | null } => {
  const entries = incoming.filter(isXtbEntry);
  if (!entries.length) return { executions: incoming, matched: 0, problem: null };
  const stored = new Map<string, { fill: ImportedExecution; hash: string }>();
  for (const row of db
    .select()
    .from(executions)
    .where(and(eq(executions.accountId, accountId), eq(executions.source, "import")))
    .all()) {
    const importMetadata = row.importMetadataJson ? JSON.parse(row.importMetadataJson) : undefined;
    const fill: ImportedExecution = {
      symbol: row.symbol,
      side: row.side as "buy" | "sell",
      quantity: row.quantity,
      price: row.price,
      fee: row.fee,
      executedAt: row.executedAt,
      importMetadata,
    };
    if (isXtbEntry(fill)) stored.set(importMetadata.group, { fill, hash: row.contentHash });
  }

  const dropped = new Set<ImportedExecution>();
  for (const entry of entries) {
    const previous = stored.get(entry.importMetadata!.group!);
    if (!previous || previous.hash === executionHash(entry)) continue;
    if (!sameLot(previous.fill, entry)) {
      const position = entry.importMetadata!.group!.split(":").at(-1);
      return {
        executions: incoming,
        matched: 0,
        problem: `XTB position ${position} was imported earlier as ${describe(previous.fill)}, but this file reports ${describe(entry)}. The position changed, for example by a partial close, so the journal cannot tell which part this file closes. Nothing was saved. Export one workbook whose date range covers both the opening and the close of this position, and import it into a new journal account.`,
      };
    }
    dropped.add(entry);
  }
  return {
    executions: incoming.filter((fill) => !dropped.has(fill)),
    matched: dropped.size,
    problem: null,
  };
};
