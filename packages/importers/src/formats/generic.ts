import { headerKey, parseCsv, toRecords } from "../csv";
import { rowsToFills } from "./fills";
import type { ImportOptions, ParsedImport } from "../types";

export interface GenericMapping {
  symbol: string;
  side: string;
  quantity: string;
  price: string;
  fee?: string;
  timestamp?: string;
  date?: string;
  time?: string;
}

/**
 * The escape hatch for the long tail: the user maps their file's columns in the
 * UI and any tabular export becomes importable. `mapping` values are the file's
 * own header names.
 */
export const parseWithMapping = (
  content: string,
  mapping: GenericMapping,
  options: ImportOptions = {},
): ParsedImport => {
  const records = toRecords(parseCsv(content));
  const alias = (name: string | undefined) => (name ? [headerKey(name)] : []);
  const { executions, skippedRows } = rowsToFills(
    records,
    {
      symbol: alias(mapping.symbol),
      side: alias(mapping.side),
      quantity: alias(mapping.quantity),
      price: alias(mapping.price),
      fees: mapping.fee ? [alias(mapping.fee)] : [],
      timestamp: mapping.timestamp ? alias(mapping.timestamp) : undefined,
      date: alias(mapping.date),
      time: alias(mapping.time),
    },
    options,
  );
  return { format: "generic", executions, skippedRows, warnings: [] };
};

/** Header names of a CSV, for building the mapping UI. */
export const readHeaders = (content: string): string[] => parseCsv(content)[0] ?? [];
