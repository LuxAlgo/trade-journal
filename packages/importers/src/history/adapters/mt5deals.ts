/* Adapted from ChristopherDownie/prop-firm-sim, commit 2aedb92208ab34ef7a1d0e42c290b8b78bae081f.
 * Copyright (c) 2026 LuxAlgo. MIT license: packages/importers/LICENSE.
 * Journal adaptation keeps history parsing separate from existing fill importers. */

/*
  MetaTrader 5 "Deals" tables - the fill-level section of MT5 reports. The
  account-history report carries a Positions section (handled by the plain
  metatrader adapter, preferred because it has S/L), but the STRATEGY TESTER
  report has no Positions table at all: its trades only exist as deals:

    Time, Deal, Symbol, Type, Direction, Volume, Price, Order,
    [Cost,] Commission, [Fee,] Swap, Profit, Balance, Comment

  Semantics that make a generic reading WRONG (and why this adapter exists):
  - Type (buy/sell) is the side of the FILL, not the position: an "out" deal
    that sells is closing a LONG. Position direction inverts on exits.
  - Direction is the position event: "in" opens, "out" closes, "in/out"
    reverses (closes the old position and opens a new one in one fill).
  - Profit sits on "out" deals and is gross; Commission (on both legs), Fee,
    and Swap are signed adjustments netted into P&L afterwards.
  - "balance" rows are deposits, not trades.

  Deals carry no position id, so entries and exits pair FIFO within
  (symbol, direction) - correct under MT5 netting, which is what the strategy
  tester uses. No stop-loss exists at the deal level: R is honestly
  needs-risk unless the user supplies a RiskSpec.
*/

import { parseImportTimestamp } from "../timestamps";
import { normalizeHeader, parseDirectionValue } from "../aliases";
import { parseNumericCell, sanitizeRetainedText } from "../csv";
import { issue, type ColumnMapping, type ImportIssue } from "../model";
import { type Execution } from "../reconstruct";
import type {
  AdapterContext,
  AdapterMatch,
  AdapterParseResult,
  CsvTable,
  SourceAdapter,
} from "./adapter";

const EVENT_VALUES = /^(in|out|in\/out|out by)$/i;
const NON_TRADE_TYPES = /^(balance|credit|deposit|withdrawal|correction|commission|)$/i;

interface Columns {
  time: number;
  deal: number;
  symbol: number;
  type: number;
  direction: number;
  volume: number;
  price: number;
  commission: number | null;
  fee: number | null;
  swap: number | null;
  profit: number;
}

function findColumns(header: string[]): Columns | null {
  const normalized = header.map(normalizeHeader);
  const find = (name: string): number => normalized.indexOf(name);
  const time = find("time");
  const deal = find("deal");
  const symbol = find("symbol");
  const type = find("type");
  const direction = find("direction");
  const volume = find("volume");
  const price = find("price");
  const profit = find("profit");
  if ([time, deal, symbol, type, direction, volume, price, profit].some((i) => i === -1))
    return null;
  const commission = find("commission");
  const fee = find("fee");
  const swap = find("swap");
  return {
    time,
    deal,
    symbol,
    type,
    direction,
    volume,
    price,
    commission: commission === -1 ? null : commission,
    fee: fee === -1 ? null : fee,
    swap: swap === -1 ? null : swap,
    profit,
  };
}

/** MT5 tester volumes sometimes render "0.06 / 0.06" (filled/total). */
function parseVolume(raw: string): number {
  return parseNumericCell(raw.split("/")[0] ?? "");
}

export const mt5DealsAdapter: SourceAdapter = {
  id: "mt5-deals",
  label: "MetaTrader 5 deals (strategy tester / history report)",

  detect(table: CsvTable): AdapterMatch | null {
    const columns = findColumns(table.header);
    if (columns === null) return null;
    const sample = table.records.slice(0, 20);
    if (sample.length === 0) return null;
    const eventish = sample.filter((r) =>
      EVENT_VALUES.test((r.cells[columns.direction] ?? "").trim()),
    );
    const balanceish = sample.filter((r) =>
      /^balance$/i.test((r.cells[columns.type] ?? "").trim()),
    );
    if (eventish.length + balanceish.length < Math.max(1, sample.length * 0.8)) return null;
    return {
      confidence: "exact",
      signals: [
        'header carries Deal, Direction, Volume, and Profit columns (MetaTrader 5 "Deals" layout)',
        'rows are in/out fill events; "out" rows carry the trade profit',
      ],
    };
  },

  parse(table: CsvTable, ctx: AdapterContext): AdapterParseResult {
    const issues: ImportIssue[] = [];
    const columns = findColumns(table.header)!;
    const executions: Execution[] = [];
    let skippedRows = 0;
    for (const record of table.records) {
      const cells = record.cells;
      const type = (cells[columns.type] ?? "").trim();
      const effect = (cells[columns.direction] ?? "").trim().toLowerCase();
      if (NON_TRADE_TYPES.test(type)) {
        skippedRows++;
        continue;
      }
      const direction = parseDirectionValue(type);
      const time = parseImportTimestamp(cells[columns.time] ?? "", ctx.dateOrder, ctx.timeZone);
      const price = parseNumericCell(cells[columns.price] ?? "");
      const quantity = parseVolume(cells[columns.volume] ?? "");
      const symbol = sanitizeRetainedText(cells[columns.symbol] ?? "").value;
      if (
        !direction ||
        !EVENT_VALUES.test(effect) ||
        !Number.isFinite(time) ||
        !Number.isFinite(price) ||
        !(quantity > 0) ||
        !symbol
      ) {
        skippedRows++;
        issues.push(
          issue(
            "warning",
            "row-skipped",
            `Line ${record.line}: invalid deal side, symbol, quantity, price or timestamp.`,
            { row: record.line },
          ),
        );
        continue;
      }
      const adjustments = [columns.commission, columns.fee, columns.swap].reduce<number>(
        (total, index) => total + (index === null ? 0 : parseNumericCell(cells[index] ?? "") || 0),
        0,
      );
      const gross = parseNumericCell(cells[columns.profit] ?? "");
      executions.push({
        row: record.line,
        id: sanitizeRetainedText(cells[columns.deal] ?? "").value,
        symbol,
        side: direction === "long" ? "buy" : "sell",
        quantity,
        price,
        time,
        fees: -adjustments,
        effect: effect === "out by" ? "out" : (effect as "in" | "out" | "in/out"),
        ...(effect !== "in" && Number.isFinite(gross) ? { reportedGrossPnl: gross } : {}),
      });
    }
    const mapping: ColumnMapping = {
      entryTime: columns.time,
      tradeId: columns.deal,
      symbol: columns.symbol,
      direction: columns.type,
      eventType: columns.direction,
      quantity: columns.volume,
      entryPrice: columns.price,
      pnl: columns.profit,
    };
    // The journal already handles partial exits and reversals. Keep each deal
    // intact instead of collapsing it into simulator-only round trips.
    return { closed: [], open: [], executions, issues, mapping, skippedRows, dedupeSafe: false };
  },
};
