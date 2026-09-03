/* Adapted from ChristopherDownie/prop-firm-sim, commit 2aedb92208ab34ef7a1d0e42c290b8b78bae081f.
 * Copyright (c) 2026 LuxAlgo. MIT license: packages/importers/LICENSE.
 * Journal adaptation keeps history parsing separate from existing fill importers. */

/*
  MetaTrader 4/5 account-history exports (CSV saved from the statement or via
  common export tools): one row per CLOSED POSITION with duplicated Time/Price
  column pairs (first = open leg, second = close leg):

    Ticket,Open Time,Type,Size,Symbol,Price,S/L,T/P,Close Time,Price,
    Commission,Swap,Profit
    — or MT5-style: Time,Position,Symbol,Type,Volume,Price,S/L,T/P,Time,
    Price,Commission,Swap,Profit

  Non-position rows (balance ops, cancelled/pending orders like "buy limit")
  are ignored with a diagnostic. Profit is gross; Commission and Swap are
  signed adjustments (usually ≤ 0), so net P&L = Profit + Commission + Swap.

  R-multiples: when the row carries a non-zero S/L, initial risk is derived
  from the trade's own currency-per-price-unit rate (gross P&L ÷ signed price
  move), which stays correct for FX/CFDs without knowing contract sizes. Rows
  with no stop (S/L = 0) honestly get no R.
*/

import { parseImportTimestamp } from "../timestamps";
import { mapHeaders, normalizeHeader, parseDirectionValue } from "../aliases";
import { parseNumericCell, sanitizeRetainedText } from "../csv";
import { issue, sortTrades, type ImportIssue, type ImportedTrade } from "../model";
import type {
  AdapterContext,
  AdapterMatch,
  AdapterParseResult,
  CsvTable,
  SourceAdapter,
} from "./adapter";

const POSITION_TYPES = /^(buy|sell)$/i;
const PENDING_TYPES = /^(buy|sell)\s*(limit|stop|stop\s*limit)$/i;
const NON_TRADE_TYPES = /^(balance|credit|deposit|withdrawal|correction)$/i;

export const metaTraderAdapter: SourceAdapter = {
  id: "metatrader",
  label: "MetaTrader 4/5 account history",

  detect(table: CsvTable): AdapterMatch | null {
    const normalized = table.header.map(normalizeHeader);
    const has = (name: string): boolean => normalized.includes(name);
    const idish = has("ticket") || has("position") || has("deal") || has("order");
    const timeCount = normalized.filter(
      (h) => h === "time" || h === "opentime" || h === "closetime",
    ).length;
    const priceCount = normalized.filter(
      (h) => h === "price" || h === "openprice" || h === "closeprice",
    ).length;
    if (!idish || !has("profit") || !has("swap")) return null;
    if (timeCount < 2 || priceCount < 2) return null;
    return {
      confidence: "exact",
      signals: [
        "header carries a Ticket/Position id with Swap and Profit columns",
        "open and close Time/Price column pairs are both present (MetaTrader statement layout)",
      ],
    };
  },

  parse(table: CsvTable, ctx: AdapterContext): AdapterParseResult {
    const issues: ImportIssue[] = [];
    const { mapping } = mapHeaders(table.header, table.records);
    if (ctx.mappingOverride !== undefined) Object.assign(mapping, ctx.mappingOverride);
    const cell = (record: { cells: string[] }, field: keyof typeof mapping): string => {
      const index = mapping[field];
      return index === undefined ? "" : (record.cells[index] ?? "").trim();
    };

    const closed: ImportedTrade[] = [];
    const open: ImportedTrade[] = [];
    let skippedRows = 0;

    // The Type column is found by name: its values mix buy/sell with balance
    // and pending-order rows, which defeats value-driven inspection.
    const typeIndex =
      table.header.findIndex((h) => normalizeHeader(h) === "type") !== -1
        ? table.header.findIndex((h) => normalizeHeader(h) === "type")
        : (mapping.direction ?? mapping.eventType);

    for (const record of table.records) {
      const typeRaw = typeIndex === undefined ? "" : (record.cells[typeIndex] ?? "").trim();
      if (NON_TRADE_TYPES.test(typeRaw)) {
        skippedRows++;
        issues.push(
          issue(
            "info",
            "non-trade-row-ignored",
            `Line ${record.line}: "${typeRaw}" row (not a trade); ignored.`,
            {
              row: record.line,
            },
          ),
        );
        continue;
      }
      if (PENDING_TYPES.test(typeRaw)) {
        skippedRows++;
        issues.push(
          issue(
            "info",
            "cancelled-row-ignored",
            `Line ${record.line}: pending order "${typeRaw}" (never a position); ignored.`,
            { row: record.line },
          ),
        );
        continue;
      }
      if (!POSITION_TYPES.test(typeRaw)) {
        skippedRows++;
        issues.push(
          issue(
            "warning",
            "row-skipped",
            `Line ${record.line}: unrecognized type "${typeRaw || "(empty)"}"; skipped.`,
            { row: record.line },
          ),
        );
        continue;
      }

      const direction = parseDirectionValue(typeRaw);
      const entryTime = parseImportTimestamp(
        cell(record, "entryTime"),
        ctx.dateOrder,
        ctx.timeZone,
      );
      const exitTime = parseImportTimestamp(cell(record, "exitTime"), ctx.dateOrder, ctx.timeZone);
      const entryPrice = parseNumericCell(cell(record, "entryPrice"));
      const exitPrice = parseNumericCell(cell(record, "exitPrice"));
      const quantity = parseNumericCell(cell(record, "quantity"));
      const profit = parseNumericCell(cell(record, "pnl"));
      const commission = parseNumericCell(cell(record, "fees"));
      const swap = parseNumericCell(cell(record, "swap"));
      const stop = parseNumericCell(cell(record, "stopPrice"));

      if (!Number.isFinite(entryTime) || !Number.isFinite(entryPrice)) {
        skippedRows++;
        issues.push(
          issue(
            "warning",
            "row-skipped",
            `Line ${record.line}: unparseable open time or price; skipped.`,
            {
              row: record.line,
            },
          ),
        );
        continue;
      }

      const adjustments =
        (Number.isFinite(commission) ? commission : 0) + (Number.isFinite(swap) ? swap : 0);
      const grossPnl = Number.isFinite(profit) ? profit : null;
      const stillOpen = !Number.isFinite(exitTime) || !Number.isFinite(exitPrice);

      const symbolRaw = sanitizeRetainedText(cell(record, "symbol")).value;
      const idRaw = sanitizeRetainedText(cell(record, "tradeId")).value;
      const trade: ImportedTrade = {
        id: idRaw === "" ? null : idRaw,
        symbol: symbolRaw === "" ? null : symbolRaw,
        direction,
        entryTime,
        exitTime: stillOpen ? null : exitTime,
        entryPrice,
        exitPrice: stillOpen ? null : exitPrice,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
        pnl: grossPnl !== null ? grossPnl + adjustments : null,
        pnlReported: grossPnl !== null,
        // Reported as a cost: positive when commission+swap net negative.
        fees: adjustments !== 0 ? -adjustments : null,
        stopPrice: Number.isFinite(stop) && stop !== 0 ? stop : null,
        riskAmount: null,
        r: null,
        rSource: "unavailable",
        status: stillOpen ? "open" : "closed",
        sourceRows: [record.line],
      };
      (stillOpen ? open : closed).push(trade);
    }

    return { closed: sortTrades(closed), open, issues, mapping, skippedRows, dedupeSafe: true };
  },
};
