import type { AssetClass } from "@luxalgo/journal-core";
import { headerKey, hasHeaders, parseCsv, pick, toRecords, type Row } from "../csv";
import { parseTimestamp } from "../dates";
import { parseMoney, parseQuantity } from "../numbers";
import { readXlsx, type XlsxSheet } from "../xlsx";
import {
  tradeToExecutions,
  type ImportFormat,
  type ImportOptions,
  type ImportedExecution,
  type ImportedTrade,
  type ParsedImport,
} from "../types";

/** Marker rows in the reduced statement. They are not trades. */
const NOTE = "__xtb_note__";
const SECTION = "__xtb_section__";

const CLOSED_HEADERS: string[][] = [
  ["ticker", "symbol"],
  ["type"],
  ["volume"],
  ["openprice"],
  ["opentimeutc", "opentime"],
  ["closeprice"],
  ["closetimeutc", "closetime"],
  ["positionid"],
  ["profitloss", "grossprofit"],
];

const OPEN_HEADERS: string[][] = [
  ["ticker"],
  ["type"],
  ["volume"],
  ["openprice"],
  ["opentimeutc", "opentime"],
];

const csvField = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const sheetCsv = (rows: string[][]): string =>
  rows.map((row) => row.map((cell) => csvField(cell)).join(",")).join("\n");

const headerIndex = (rows: string[][]): number =>
  rows.findIndex((row) => hasHeaders(row, CLOSED_HEADERS));

const isClosedSheet = (sheet: XlsxSheet): boolean =>
  /closed positions/i.test(sheet.name) || headerIndex(sheet.rows) !== -1;

const openHeaderIndex = (rows: string[][]): number =>
  rows.findIndex((row) => hasHeaders(row, OPEN_HEADERS) && !hasHeaders(row, [["closeprice"]]));

const isOpenSheet = (sheet: XlsxSheet): boolean =>
  /open positions/i.test(sheet.name) ||
  (openHeaderIndex(sheet.rows) !== -1 && !isClosedSheet(sheet));

const countCashOperations = (sheet: XlsxSheet | undefined): number => {
  if (!sheet) return 0;
  const header = sheet.rows.findIndex((row) => hasHeaders(row, [["type"], ["amount"], ["time"]]));
  if (header === -1) return 0;
  const records = toRecords(sheet.rows.slice(header));
  return records.filter((row) => {
    const type = (pick(row, ["type"]) ?? "").trim();
    return type !== "" && !/^total$/i.test(type);
  }).length;
};

const countOpenLots = (sheet: XlsxSheet | undefined): number => {
  if (!sheet) return 0;
  const header = openHeaderIndex(sheet.rows);
  if (header === -1) return 0;
  return toRecords(sheet.rows.slice(header)).filter((row) =>
    /^(buy|sell)$/i.test(pick(row, ["type"]) ?? ""),
  ).length;
};

/**
 * Reduce one XTB account workbook to one statement: closed positions, then
 * open holdings. Cash operations are counted in a note and are not executions.
 * One workbook is one account.
 */
export const xtbWorkbookToStatement = async (data: ArrayBuffer | Uint8Array): Promise<string> => {
  const sheets = await readXlsx(data);
  const closed = sheets.find(isClosedSheet);
  if (!closed) throw new Error("This XTB workbook has no Closed Positions sheet.");
  const open = sheets.find(isOpenSheet);
  const openCount = countOpenLots(open);
  const cashCount = countCashOperations(
    sheets.find((sheet) => /cash operations/i.test(sheet.name)),
  );
  const note = [
    NOTE,
    `Imported ${openCount} open holding(s) as entry fills. Skipped ${cashCount} cash operation(s). Import each XTB account workbook into its own journal account.`,
  ];
  const parts = [sheetCsv(closed.rows)];
  if (open) parts.push([SECTION, "open"].join(","), sheetCsv(open.rows));
  parts.push(note.map(csvField).join(","));
  return parts.join("\n");
};

const assetClassOf = (category: string | undefined): AssetClass | undefined => {
  const text = (category ?? "").toLowerCase();
  if (/etf|stock|equit|share/.test(text)) return "equity";
  if (/forex|\bfx\b/.test(text)) return "forex";
  if (/cfd/.test(text)) return "cfd";
  if (/crypto/.test(text)) return "crypto";
  if (/future/.test(text)) return "futures";
  if (/option/.test(text)) return "option";
  return undefined;
};

const accountFrom = (rows: string[][]): string | undefined => {
  for (const row of rows) {
    if (headerKey(row[0] ?? "") === "accountnumber" && row[1]?.trim()) return row[1].trim();
  }
  return undefined;
};

const positionGroup = (
  account: string | undefined,
  positionId: string,
  symbol: string,
  openedAt: string,
) => `xtb:${account ?? "account"}:${positionId || `${symbol}:${openedAt}`}`;

/**
 * A row with a type other than BUY or SELL is a trade this importer does not
 * understand. Rows without a type are layout: totals, symbol rollups, notes.
 */
const isUnknownTrade = (row: Row): boolean => (pick(row, ["type"]) ?? "").trim() !== "";

const splitSections = (table: string[][]): { closed: string[][]; open: string[][] } => {
  const marker = table.findIndex((row) => row[0] === SECTION);
  if (marker === -1) return { closed: table, open: [] };
  return { closed: table.slice(0, marker), open: table.slice(marker + 1) };
};

/**
 * XTB xStation account history. Closed positions become an entry and an exit.
 * Open holdings become the entry only, tagged with the same XTB position id, so
 * a later closed-position report adds the exit and skips the entry already
 * stored. Prices stay in the instrument currency. Gross Profit on a close is
 * the account-currency result and is stored as reported P&L. Unrealized profit
 * on an open holding is not a journal result.
 */
export const xtb: ImportFormat = {
  id: "xtb",
  label: "XTB (account statement)",
  detect: (_headers, content) => headerIndex(parseCsv(content)) !== -1,
  parse: (content, _options: ImportOptions): ParsedImport => {
    const table = parseCsv(content);
    const { closed, open } = splitSections(table);
    const headerAt = headerIndex(closed);
    const records = headerAt === -1 ? [] : toRecords(closed.slice(headerAt));
    const account = accountFrom(closed.slice(0, Math.max(headerAt, 0)));
    const executions: ImportedExecution[] = [];
    const warnings = [
      "XTB closed positions are trade-level. Each row becomes an entry and an exit at the reported prices. Account-currency Gross Profit is kept as the position result, because price × volume is not the P&L when a conversion rate applies.",
      "Open holdings are entry fills tagged with their XTB position id. A later report that closes the same id adds the exit and skips this entry.",
      "Open Time and Close Time are labeled UTC and are imported as UTC.",
    ];
    const errors: string[] = [];
    let skippedRows = 0;
    const accounts = new Set<string>();
    if (account) accounts.add(account);
    const entryGroups = new Set<string>();

    const note = table.find((row) => row[0] === NOTE)?.[1];
    if (note) warnings.push(note);

    for (const row of records) {
      if (row[Object.keys(row)[0] ?? ""] === NOTE || Object.values(row).includes(NOTE)) continue;
      const parsed = closedRow(row, account, accounts);
      if (parsed === "skip") {
        if (isUnknownTrade(row)) skippedRows++;
        continue;
      }
      if (parsed === "invalid") {
        skippedRows++;
        continue;
      }
      entryGroups.add(parsed.entry.importMetadata!.group!);
      executions.push(parsed.entry, parsed.exit);
    }

    const openHeader = openHeaderIndex(open);
    const openAccount =
      accountFrom(openHeader === -1 ? open : open.slice(0, openHeader)) ?? account;
    if (openAccount) accounts.add(openAccount);
    const openRecords = openHeader === -1 ? [] : toRecords(open.slice(openHeader));
    // Lot rows leave Category empty; the ticker's rollup row above them carries it.
    const categories = new Map<string, string>();
    for (const row of openRecords) {
      const ticker = pick(row, ["ticker"])?.trim().toUpperCase();
      const category = pick(row, ["category"])?.trim();
      if (ticker && category && !categories.has(ticker)) categories.set(ticker, category);
    }
    for (const row of openRecords) {
      const holding = openRow(row, openAccount, accounts, categories);
      if (holding === "skip") {
        if (isUnknownTrade(row)) skippedRows++;
        continue;
      }
      if (holding === "invalid") {
        skippedRows++;
        continue;
      }
      if (entryGroups.has(holding.importMetadata!.group!)) continue;
      entryGroups.add(holding.importMetadata!.group!);
      executions.push(holding);
    }

    if (accounts.size > 1)
      errors.push(
        "This file contains more than one XTB account. Import one account workbook at a time.",
      );
    if (executions.length === 0)
      errors.push("This XTB report has no closed or open positions to import.");

    return {
      format: "xtb",
      executions,
      skippedRows,
      warnings,
      ...(errors.length ? { errors } : {}),
    };
  },
};

const closedRow = (
  row: Row,
  account: string | undefined,
  accounts: Set<string>,
): { entry: ImportedExecution; exit: ImportedExecution } | "skip" | "invalid" => {
  const type = (pick(row, ["type"]) ?? "").trim().toLowerCase();
  if (type !== "buy" && type !== "sell") return "skip";
  const symbol = pick(row, ["ticker", "symbol"])?.trim().toUpperCase();
  const quantity = parseQuantity(pick(row, ["volume"]));
  const entryPrice = parseMoney(pick(row, ["openprice"]));
  const exitPrice = parseMoney(pick(row, ["closeprice"]));
  const openedAt = parseTimestamp(pick(row, ["opentimeutc", "opentime"]), "UTC");
  const closedAt = parseTimestamp(pick(row, ["closetimeutc", "closetime"]), "UTC");
  const positionId = pick(row, ["positionid"])?.trim() ?? "";
  const rowAccount = pick(row, ["account", "accountnumber"])?.trim() || account;
  if (rowAccount) accounts.add(rowAccount);
  if (
    !symbol ||
    !openedAt ||
    !closedAt ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(exitPrice)
  )
    return "invalid";

  const gross = parseMoney(pick(row, ["grossprofit"]));
  const net = parseMoney(pick(row, ["profitloss"]));
  let reportedGrossPnl: number | undefined;
  let fees = 0;
  if (Number.isFinite(gross) && Number.isFinite(net)) {
    const cost = gross - net;
    if (cost >= 0) {
      reportedGrossPnl = gross;
      fees = cost;
    } else {
      reportedGrossPnl = net;
    }
  } else if (Number.isFinite(gross)) {
    reportedGrossPnl = gross;
  } else if (Number.isFinite(net)) {
    reportedGrossPnl = net;
  }

  const trade: ImportedTrade = {
    symbol,
    direction: type === "buy" ? "long" : "short",
    quantity,
    entryPrice,
    exitPrice,
    openedAt,
    closedAt,
    fees,
    assetClass: assetClassOf(pick(row, ["category"])),
  };
  const [entry, exit] = tradeToExecutions(trade);
  const group = positionGroup(rowAccount, positionId, symbol, openedAt);
  entry.importMetadata = { id: "entry", group, order: 0, preserveFee: true };
  exit.importMetadata = {
    id: "exit",
    group,
    order: 1,
    preserveFee: true,
    ...(reportedGrossPnl !== undefined ? { reportedGrossPnl } : {}),
  };
  return { entry, exit };
};

const openRow = (
  row: Row,
  account: string | undefined,
  accounts: Set<string>,
  categories: Map<string, string>,
): ImportedExecution | "skip" | "invalid" => {
  const type = (pick(row, ["type"]) ?? "").trim().toLowerCase();
  if (type !== "buy" && type !== "sell") return "skip";
  const symbol = pick(row, ["ticker"])?.trim().toUpperCase();
  const quantity = parseQuantity(pick(row, ["volume"]));
  const price = parseMoney(pick(row, ["openprice"]));
  const openedAt = parseTimestamp(pick(row, ["opentimeutc", "opentime"]), "UTC");
  const positionId = (pick(row, ["positionid", "instrumentposition"]) ?? "").trim();
  const rowAccount = pick(row, ["account", "accountnumber"])?.trim() || account;
  if (rowAccount) accounts.add(rowAccount);
  if (
    !symbol ||
    !openedAt ||
    !/^\d+$/.test(positionId) ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(price)
  )
    return "invalid";
  const commission = parseMoney(pick(row, ["opencommission"]));
  return {
    symbol,
    side: type === "buy" ? "buy" : "sell",
    quantity,
    price,
    fee: Number.isFinite(commission) ? Math.abs(commission) : 0,
    executedAt: openedAt,
    assetClass: assetClassOf(pick(row, ["category"])?.trim() || categories.get(symbol)),
    importMetadata: {
      id: "entry",
      group: positionGroup(rowAccount, positionId, symbol, openedAt),
      order: 0,
      preserveFee: true,
    },
  };
};
