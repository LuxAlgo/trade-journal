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
  positionId?: string;
  executionId?: string;
  sequence?: string;
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
  const parsed = rowsToFills(
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
      positionId: mapping.positionId ? alias(mapping.positionId) : undefined,
      executionId: mapping.executionId ? alias(mapping.executionId) : undefined,
      sequence: mapping.sequence ? alias(mapping.sequence) : undefined,
    },
    options,
    { positionActions: true },
  );
  return { format: "generic", ...parsed };
};

/** Header names of a CSV, for building the mapping UI. */
export const readHeaders = (content: string): string[] => parseCsv(content)[0] ?? [];
