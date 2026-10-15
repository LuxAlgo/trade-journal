import { hasHeaders, parseCsv, pick, toRecords, type Row } from "../csv";
import { parseTimestamp, parseDateAndTime } from "../dates";
import { parseMoney, parseQuantity } from "../numbers";
import type { ImportFormat, ImportOptions, ImportedExecution, ParsedImport } from "../types";
import { parsePositionAction, positionGroup } from "../position-fills";

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
  positionId?: string[];
  executionId?: string[];
  sequence?: string[];
  /** Exact contract, when a legacy format normally uses a root product symbol. */
  contract?: string[];
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
  spec: Pick<FillsFormatSpec, "rowFilter" | "normalizeSymbol"> & { positionActions?: boolean } = {},
): Pick<ParsedImport, "executions" | "skippedRows" | "warnings" | "errors"> => {
  const executions: ImportedExecution[] = [];
  let skippedRows = 0;
  const errors: string[] = [];
  const activeRows = records.filter((row) => !spec.rowFilter || spec.rowFilter(row));
  const action = (row: Row) =>
    spec.positionActions ? parsePositionAction(pick(row, columns.side)) : undefined;
  const symbolOf = (row: Row) => {
    const raw = pick(row, columns.symbol);
    return raw ? (spec.normalizeSymbol ?? ((s: string) => s.trim().toUpperCase()))(raw) : "";
  };
  const positionSymbols = new Set(activeRows.filter((row) => action(row)).map(symbolOf));
  const optional = (row: Row, aliases: string[]) => ({
    present: aliases.some((key) => key in row),
    value: pick(row, aliases),
  });
  const sourceAccounts = new Set<string>();

  for (const row of records) {
    if (spec.rowFilter && !spec.rowFilter(row)) {
      skippedRows++;
      continue;
    }
    const position = action(row);
    const symbol = symbolOf(row);
    const side = position
      ? (position.direction === "long") === (position.effect === "open")
        ? "buy"
        : "sell"
      : parseSide(pick(row, columns.side));
    if (!position && positionSymbols.has(symbol))
      errors.push(
        `${symbol}: this file mixes Open/Close position labels with other actions. Export explicit Open/Close Long/Short labels for every fill of this contract.`,
      );
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
      !symbol ||
      !side ||
      !executedAt ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(price)
    ) {
      skippedRows++;
      if (position)
        errors.push(
          `${symbol || "Position row"}: an Open/Close fill needs a symbol, positive quantity, price and valid timestamp.`,
        );
      continue;
    }

    const fee = (columns.fees ?? [])
      .map((aliases) => Math.abs(parseMoney(pick(row, aliases))))
      .filter((value) => Number.isFinite(value))
      .reduce((total, value) => total + value, 0);

    const fill: ImportedExecution = { symbol, side, quantity, price, fee, executedAt };
    if (position) {
      const contract = optional(row, columns.contract ?? ["contract", "contractname"]);
      if (contract.present && (!contract.value || contract.value.length > 500))
        errors.push(
          `${symbol}: Contract must be present on every position row and no longer than 500 characters.`,
        );
      if (contract.value) position.contract = contract.value.trim().toUpperCase();
      const positionId = optional(row, columns.positionId ?? ["positionid"]);
      const executionId = optional(row, columns.executionId ?? ["executionid", "fillid"]);
      const sequence = optional(
        row,
        columns.sequence ?? ["sequence", "executionsequence", "fillsequence"],
      );
      for (const [label, field] of [
        ["Position ID", positionId],
        ["Execution ID", executionId],
      ] as const)
        if (field.present && (!field.value || field.value.length > 500))
          errors.push(
            `${symbol}: ${label} must be present on every position row and no longer than 500 characters.`,
          );
      if (positionId.value) position.positionId = positionId.value;
      if (executionId.value) position.executionId = executionId.value;
      if (sequence.present) {
        const value = Number(sequence.value);
        if (!sequence.value || !/^\d+$/.test(sequence.value) || !Number.isSafeInteger(value))
          errors.push(
            `${symbol}: Sequence must be a non-negative whole number on every position row.`,
          );
        else position.sequence = value;
      }
      const feeValues = (columns.fees ?? []).map((aliases) => pick(row, aliases));
      if (feeValues.some((value) => value !== undefined && !Number.isFinite(parseMoney(value))))
        errors.push(`${symbol}: invalid fee on an Open/Close fill.`);
      if (!Number.isFinite(fee)) errors.push(`${symbol}: total fees are too large.`);
      fill.importMetadata = {
        id: position.executionId ? `execution:${position.executionId}` : position.effect,
        group: positionGroup(position),
        order: position.sequence ?? 0,
        position,
        preserveFee: feeValues.some((value) => value !== undefined),
      };
      const source = pick(row, ["account", "accountid", "accountname", "clientaccountid"]);
      if (source) sourceAccounts.add(source);
    }
    executions.push(fill);
  }
  if (sourceAccounts.size > 1)
    errors.push(
      "These position rows contain multiple source accounts. Export and import one account at a time.",
    );
  return {
    executions,
    skippedRows,
    warnings: positionSymbols.size
      ? [
          "Open/Close position labels keep long and short positions separate. Closes are checked against the selected account when saving. For futures, configure the multiplier for each imported symbol in Settings.",
        ]
      : [],
    ...(errors.length ? { errors: [...new Set(errors)] } : {}),
  };
};

/** Build an ImportFormat from a declarative column spec — the path for most broker CSVs. */
export const makeFillsFormat = (spec: FillsFormatSpec): ImportFormat => ({
  id: spec.id,
  label: spec.label,
  detect: (headers) => hasHeaders(headers, spec.required),
  parse: (content, options): ParsedImport => {
    const records = toRecords(parseCsv(content));
    return {
      format: spec.id,
      ...rowsToFills(records, spec.columns, options, { ...spec, positionActions: true }),
    };
  },
});
