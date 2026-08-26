import { hasHeaders, parseCsv, pick, toRecords, type Row } from "../csv";
import { parseTimestamp, parseDateAndTime } from "../dates";
import { parseMoney, parseQuantity } from "../numbers";
import type { ImportFormat, ImportOptions, ImportedExecution, ParsedImport } from "../types";

export interface FillsColumnMap {
  symbol: string[];
  side: string[];
  quantity: string[];
  price: string[];
  /** Each alias group is summed (commission + fees, etc.). */
  fees?: string[][];
  timestamp?: string[];
  date?: string[];
  time?: string[];
}

export interface FillsFormatSpec {
  id: string;
  label: string;
  /** Header alias groups that must ALL be present for detection. */
  required: string[][];
  columns: FillsColumnMap;
  /** Skip rows that aren't fills (unfilled orders, section noise). */
  rowFilter?: (row: Row) => boolean;
  normalizeSymbol?: (symbol: string) => string;
}

export const parseSide = (value: string | undefined): "buy" | "sell" | null => {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  // "bid"/"ask" per TopstepX fills exports: bid = buy interest, ask = sell.
  if (
    /^(buy|bot|bought|long|b|bid|btc|buytoopen|buytoclose|buy to open|buy to close)$/.test(text) ||
    /^buy/.test(text)
  )
    return "buy";
  if (
    /^(sell|sld|sold|short|s|ask|stc|selltoopen|selltoclose|sell to open|sell to close)$/.test(
      text,
    ) ||
    /^sell/.test(text)
  )
    return "sell";
  return null;
};

export const rowsToFills = (
  records: Row[],
  columns: FillsColumnMap,
  options: ImportOptions,
  spec: Pick<FillsFormatSpec, "rowFilter" | "normalizeSymbol"> = {},
): { executions: ImportedExecution[]; skippedRows: number } => {
  const executions: ImportedExecution[] = [];
  let skippedRows = 0;

  for (const row of records) {
    if (spec.rowFilter && !spec.rowFilter(row)) {
      skippedRows++;
      continue;
    }
    const symbolRaw = pick(row, columns.symbol);
    const side = parseSide(pick(row, columns.side));
    const quantity = parseQuantity(pick(row, columns.quantity));
    const price = parseMoney(pick(row, columns.price));
    // Try the single timestamp column first; fall back to separate date+time
    // columns (some exports put only a wall-clock time in their "time" field).
    let executedAt = columns.timestamp
      ? parseTimestamp(pick(row, columns.timestamp), options.timeZone)
      : null;
    if (!executedAt && (columns.date || columns.time)) {
      executedAt = parseDateAndTime(
        pick(row, columns.date ?? []),
        pick(row, columns.time ?? []),
        options.timeZone,
      );
    }

    if (
      !symbolRaw ||
      !side ||
      !executedAt ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(price)
    ) {
      skippedRows++;
      continue;
    }

    const fee = (columns.fees ?? [])
      .map((aliases) => Math.abs(parseMoney(pick(row, aliases))))
      .filter((value) => Number.isFinite(value))
      .reduce((total, value) => total + value, 0);

    const symbol = (spec.normalizeSymbol ?? ((s: string) => s.trim().toUpperCase()))(symbolRaw);
    executions.push({ symbol, side, quantity, price, fee, executedAt });
  }
  return { executions, skippedRows };
};

/** Build an ImportFormat from a declarative column spec — the path for most broker CSVs. */
export const makeFillsFormat = (spec: FillsFormatSpec): ImportFormat => ({
  id: spec.id,
  label: spec.label,
  detect: (headers) => hasHeaders(headers, spec.required),
  parse: (content, options): ParsedImport => {
    const records = toRecords(parseCsv(content));
    const { executions, skippedRows } = rowsToFills(records, spec.columns, options, spec);
    return { format: spec.id, executions, skippedRows, warnings: [] };
  },
});
