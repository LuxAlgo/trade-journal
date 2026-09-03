/* Adapted from ChristopherDownie/prop-firm-sim, commit 2aedb92208ab34ef7a1d0e42c290b8b78bae081f.
 * Copyright (c) 2026 LuxAlgo. MIT license: packages/importers/LICENSE.
 * Journal adaptation keeps history parsing separate from existing fill importers. */

/*
  TradingView strategy-tester "List of trades" exports. Two generations:

    old:  Trade #,Type,Signal,Date/Time,Price,Contracts,Profit,Profit %,...
    new:  Trade number,Type,Date and time,Signal,Price USD,Size (qty),
          Size (value),Net PnL USD,Return %,Commission USD,...

  Each trade is TWO rows sharing a trade number: one "Entry long/short", one
  "Exit long/short" (order varies). Trade-level totals (P&L, commission) are
  mirrored on both rows, so they are read from the exit row only. A still-open
  trade has an exit row whose date reads "Open" with a placeholder price; the
  trade surfaces as open and is excluded from simulation inputs.

  The export has no stop-loss or risk column: R is NOT derivable from the file
  alone, and the pipeline says so instead of inventing it (a user-chosen
  RiskSpec can convert the P&L series downstream).
*/

import { parseImportTimestamp } from "../timestamps";
import { normalizeHeader, parseDirectionValue } from "../aliases";
import { parseNumericCell, sanitizeRetainedText } from "../csv";
import { issue, sortTrades, type ColumnMapping, type ImportIssue } from "../model";
import { pairEvents, type TradeEvent } from "../reconstruct";
import type {
  AdapterContext,
  AdapterMatch,
  AdapterParseResult,
  CsvTable,
  SourceAdapter,
} from "./adapter";

const EVENT_TYPE = /^(entry|exit)\s+(long|short)$/i;

interface Columns {
  symbol: number | null;
  tradeId: number;
  type: number;
  time: number;
  price: number;
  quantity: number | null;
  pnl: number | null;
  fees: number | null;
  signal: number | null;
}

function findColumns(header: string[]): Columns | null {
  const normalized = header.map(normalizeHeader);
  const find = (...names: string[]): number => normalized.findIndex((h) => names.includes(h));
  const findPrefix = (prefix: string, excludePct: boolean): number =>
    normalized.findIndex((h) => h.startsWith(prefix) && (!excludePct || !h.endsWith("pct")));

  const tradeId = find("tradenumber", "trade", "tradeid", "tradeno");
  const type = find("type");
  const time = find("dateandtime", "datetime", "date", "time");
  const price = findPrefix("price", true);
  if (tradeId === -1 || type === -1 || time === -1 || price === -1) return null;
  const quantity = find("contracts", "sizeqty", "quantity", "qty");
  let pnl = findPrefix("netpnl", true);
  if (pnl === -1) pnl = findPrefix("profit", true);
  const fees = findPrefix("commission", true);
  const signal = find("signal");
  const symbol = find("symbol", "ticker", "instrument");
  return {
    symbol: symbol === -1 ? null : symbol,
    tradeId,
    type,
    time,
    price,
    quantity: quantity === -1 ? null : quantity,
    pnl: pnl === -1 ? null : pnl,
    fees: fees === -1 ? null : fees,
    signal: signal === -1 ? null : signal,
  };
}

export const tradingViewAdapter: SourceAdapter = {
  id: "tradingview",
  label: "TradingView strategy export (list of trades)",

  detect(table: CsvTable): AdapterMatch | null {
    const columns = findColumns(table.header);
    if (columns === null) return null;
    const sample = table.records.slice(0, 20);
    if (sample.length === 0) return null;
    const eventish = sample.filter((r) => EVENT_TYPE.test((r.cells[columns.type] ?? "").trim()));
    if (eventish.length < Math.max(1, sample.length * 0.8)) return null;
    return {
      confidence: "exact",
      signals: [
        `header carries "${table.header[columns.tradeId]!.trim()}", "${table.header[columns.type]!.trim()}", ` +
          `and "${table.header[columns.time]!.trim()}" columns`,
        'rows are paired "Entry long/short" / "Exit long/short" events sharing a trade number',
      ],
    };
  },

  parse(table: CsvTable, ctx: AdapterContext): AdapterParseResult {
    const issues: ImportIssue[] = [];
    const columns = findColumns(table.header)!;
    const events: TradeEvent[] = [];
    let skippedRows = 0;

    for (const record of table.records) {
      const cells = record.cells;
      const typeRaw = (cells[columns.type] ?? "").trim();
      const match = typeRaw.match(EVENT_TYPE);
      if (match === null) {
        skippedRows++;
        issues.push(
          issue(
            "warning",
            "row-skipped",
            `Line ${record.line}: "${typeRaw || "(empty)"}" is not an Entry/Exit row; skipped.`,
            { row: record.line, column: table.header[columns.type]! },
          ),
        );
        continue;
      }
      const kind = match[1]!.toLowerCase() === "entry" ? "entry" : "exit";
      const direction = parseDirectionValue(match[2]!);
      const id = sanitizeRetainedText(cells[columns.tradeId] ?? "").value;
      const timeRaw = (cells[columns.time] ?? "").trim();
      const time = parseImportTimestamp(timeRaw, ctx.dateOrder, ctx.timeZone);

      // A still-open trade: the exit row reads "Open" with a placeholder price.
      if (kind === "exit" && !Number.isFinite(time)) {
        if (/^open$/i.test(timeRaw)) continue; // the entry-only group becomes an open trade
        skippedRows++;
        issues.push(
          issue(
            "warning",
            "row-skipped",
            `Line ${record.line}: unparseable exit date "${timeRaw}"; the trade will surface as open.`,
            { row: record.line, column: table.header[columns.time]! },
          ),
        );
        continue;
      }
      if (kind === "entry" && !Number.isFinite(time)) {
        skippedRows++;
        issues.push(
          issue(
            "warning",
            "row-skipped",
            `Line ${record.line}: unparseable entry date "${timeRaw}"; the whole trade ${id} was skipped.`,
            { row: record.line, column: table.header[columns.time]! },
          ),
        );
        continue;
      }

      const price = parseNumericCell(cells[columns.price] ?? "");
      const quantity =
        columns.quantity !== null ? parseNumericCell(cells[columns.quantity] ?? "") : Number.NaN;
      // Trade totals are mirrored on both rows; read them from the exit row only.
      const pnl =
        kind === "exit" && columns.pnl !== null
          ? parseNumericCell(cells[columns.pnl] ?? "")
          : Number.NaN;
      const fees =
        kind === "exit" && columns.fees !== null
          ? parseNumericCell(cells[columns.fees] ?? "")
          : Number.NaN;

      events.push({
        row: record.line,
        kind,
        id: id === "" ? null : id,
        symbol:
          columns.symbol === null
            ? null
            : sanitizeRetainedText(cells[columns.symbol] ?? "").value || null,
        direction,
        time,
        price: Number.isFinite(price) ? price : null,
        quantity: Number.isFinite(quantity) ? quantity : null,
        pnl: Number.isFinite(pnl) ? pnl : null,
        fees: Number.isFinite(fees) && fees !== 0 ? fees : null,
        stopPrice: null,
        r: null,
      });
    }

    const { closed, open } = pairEvents(events, issues);
    const mapping: ColumnMapping = {
      tradeId: columns.tradeId,
      eventType: columns.type,
      entryTime: columns.time,
      entryPrice: columns.price,
      ...(columns.quantity !== null ? { quantity: columns.quantity } : {}),
      ...(columns.pnl !== null ? { pnl: columns.pnl } : {}),
      ...(columns.fees !== null ? { fees: columns.fees } : {}),
    };
    return {
      closed: sortTrades(closed),
      open,
      issues,
      mapping,
      skippedRows,
      dedupeSafe: true,
    };
  },
};
