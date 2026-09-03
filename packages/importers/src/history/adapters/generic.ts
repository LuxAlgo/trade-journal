/* Adapted from ChristopherDownie/prop-firm-sim, commit 2aedb92208ab34ef7a1d0e42c290b8b78bae081f.
 * Copyright (c) 2026 LuxAlgo. MIT license: packages/importers/LICENSE.
 * Journal adaptation keeps history parsing separate from existing fill importers. */

/*
  Generic CSV adapter — the fallback for any tabular export we have no
  dedicated adapter for. Columns are resolved through the alias dictionary
  (plus the caller's manual overrides), then the ROW SHAPE decides how trades
  are built:

    "trade-per-row":  each row is one completed trade (journals, broker
                      round-trip reports).
    "event-rows":     rows are entry/exit records → pairEvents (ids first,
                      FIFO only as a labeled fallback).
    "executions":     rows are raw fills (side/qty/price/time, no exit or P&L
                      columns) → position-tracking reconstruction.

  The shape is chosen from which columns exist and what the values look like —
  and is reported in the diagnostics so the user can see (and veto) the
  interpretation.
*/

import { mapHeaders, normalizeHeader, parseDirectionValue } from "../aliases";
import { parseNumericCell, sanitizeRetainedText, type CsvRecord } from "../csv";
import {
  issue,
  sortTrades,
  type ColumnMapping,
  type ImportIssue,
  type ImportedTrade,
} from "../model";
import { pairEvents, type Execution, type TradeEvent } from "../reconstruct";
import { detectSlashDateOrder, parseImportTimestamp, type SlashDateOrder } from "../timestamps";
import type {
  AdapterContext,
  AdapterMatch,
  AdapterParseResult,
  CsvTable,
  SourceAdapter,
} from "./adapter";

export type GenericShape = "trade-per-row" | "event-rows" | "executions";

const ENTRY_EVENT = /^(entry|open|in|buytoopen|selltoopen)/i;
const EXIT_EVENT = /^(exit|close|out|buytoclose|selltoclose)/i;

function text(record: CsvRecord, mapping: ColumnMapping, field: keyof ColumnMapping): string {
  const index = mapping[field];
  return index === undefined ? "" : (record.cells[index] ?? "").trim();
}

function num(record: CsvRecord, mapping: ColumnMapping, field: keyof ColumnMapping): number {
  const raw = text(record, mapping, field);
  return raw === "" ? Number.NaN : parseNumericCell(raw);
}

function nOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** Decide how rows should be interpreted, from the mapping and sample values. */
export function decideShape(mapping: ColumnMapping, records: readonly CsvRecord[]): GenericShape {
  if (mapping.eventType !== undefined) return "event-rows";
  const hasExitInfo = mapping.exitTime !== undefined || mapping.exitPrice !== undefined;
  const hasOutcome = mapping.pnl !== undefined || mapping.r !== undefined;
  if (hasExitInfo || hasOutcome) return "trade-per-row";
  // Executions: per-fill rows with a single price + quantity and nothing that
  // smells like a completed trade. The side comes from a direction column or,
  // by the common generic-import convention, from a signed quantity.
  if (mapping.entryPrice !== undefined && mapping.quantity !== undefined && records.length > 0) {
    if (mapping.direction !== undefined) return "executions";
    const qtyIndex = mapping.quantity;
    const signed = records.slice(0, 50).some((r) => parseNumericCell(r.cells[qtyIndex] ?? "") < 0);
    if (signed) return "executions";
  }
  return "trade-per-row";
}

/** Rows whose status column marks them as never-filled are dropped up front. */
const NON_FILLED_STATUS = /^(cancel(l)?ed|rejected|expired|working|pending|inactive)$/i;

function filterByStatus(
  table: CsvTable,
  issues: ImportIssue[],
): { records: CsvRecord[]; skipped: number } {
  const statusIndex = table.header.findIndex((h) =>
    ["status", "state", "orderstatus"].includes(normalizeHeader(h)),
  );
  if (statusIndex === -1) return { records: [...table.records], skipped: 0 };
  const records: CsvRecord[] = [];
  let skipped = 0;
  for (const record of table.records) {
    const status = (record.cells[statusIndex] ?? "").trim();
    if (NON_FILLED_STATUS.test(status)) {
      skipped++;
      continue;
    }
    records.push(record);
  }
  if (skipped > 0) {
    issues.push(
      issue(
        "info",
        "cancelled-row-ignored",
        `${skipped} row(s) with a non-filled status (cancelled/rejected/working/...) were ignored.`,
      ),
    );
  }
  return { records, skipped };
}

/**
 * Decide the slash-date order once for the whole file from the mapped time
 * columns. An explicit option wins; otherwise the scan decides, and an
 * unprovable file is flagged (assumed month-first) instead of silently read.
 */
function resolveDateOrder(
  records: readonly CsvRecord[],
  mapping: ColumnMapping,
  explicit: SlashDateOrder | undefined,
  issues: ImportIssue[],
): SlashDateOrder {
  if (explicit !== undefined) return explicit;
  const samples: string[] = [];
  for (const record of records.slice(0, 500)) {
    for (const field of ["entryTime", "exitTime"] as const) {
      const index = mapping[field];
      if (index !== undefined) {
        const raw = (record.cells[index] ?? "").trim();
        if (raw !== "") samples.push(raw);
      }
    }
  }
  const { order, proven } = detectSlashDateOrder(samples);
  if (order !== null && !proven) {
    issues.push(
      issue(
        "warning",
        "timestamp-assumed-utc",
        'Dates like "03/04/2025" are ambiguous between month-first and day-first, and no value in the ' +
          'file settles it. Month-first (US) was assumed — pass dateOrder: "DMY" if the file is day-first.',
      ),
    );
  }
  return order ?? "MDY";
}

function parseTradePerRow(
  records: readonly CsvRecord[],
  mapping: ColumnMapping,
  dateOrder: SlashDateOrder,
  timeZone: string | undefined,
  issues: ImportIssue[],
): {
  closed: ImportedTrade[];
  open: ImportedTrade[];
  skippedRows: number;
  executions?: Execution[];
} {
  const closed: ImportedTrade[] = [];
  const open: ImportedTrade[] = [];
  let skippedRows = 0;
  let pricePnlNoted = false;

  for (const record of records) {
    if (record.cells.every((c) => c.trim() === "")) continue;

    const rRaw = text(record, mapping, "r");
    const r = rRaw === "" ? Number.NaN : parseNumericCell(rRaw);
    const pnl = num(record, mapping, "pnl");
    const entryTime = parseImportTimestamp(text(record, mapping, "entryTime"), dateOrder, timeZone);
    const exitTimeRaw = text(record, mapping, "exitTime");
    const exitTime = parseImportTimestamp(exitTimeRaw, dateOrder, timeZone);
    const entryPrice = num(record, mapping, "entryPrice");
    const exitPrice = num(record, mapping, "exitPrice");
    const quantity = num(record, mapping, "quantity");
    const fees = num(record, mapping, "fees");
    const swap = num(record, mapping, "swap");
    const riskAmount = num(record, mapping, "riskAmount");
    const stopPrice = num(record, mapping, "stopPrice");
    const direction = parseDirectionValue(text(record, mapping, "direction"));
    const idClean = sanitizeRetainedText(text(record, mapping, "tradeId"));
    const symbolClean = sanitizeRetainedText(text(record, mapping, "symbol"));
    if (idClean.wasFormulaLike || symbolClean.wasFormulaLike) {
      issues.push(
        issue(
          "warning",
          "formula-like-cell",
          `Line ${record.line}: a text cell starts with a spreadsheet formula character; it was neutralized.`,
          { row: record.line },
        ),
      );
    }

    const feesTotal =
      Number.isFinite(fees) || Number.isFinite(swap)
        ? (Number.isFinite(fees) ? Math.abs(fees) : 0) - (Number.isFinite(swap) ? swap : 0)
        : Number.NaN;

    let tradePnl = nOrNull(pnl);
    const hasPrices =
      Number.isFinite(entryPrice) &&
      Number.isFinite(exitPrice) &&
      Number.isFinite(quantity) &&
      direction !== null;
    if (tradePnl === null && hasPrices) {
      const sign = direction === "long" ? 1 : -1;
      tradePnl =
        (exitPrice - entryPrice) * sign * quantity -
        Math.abs(Number.isFinite(feesTotal) ? feesTotal : 0);
      if (!pricePnlNoted) {
        pricePnlNoted = true;
        issues.push(
          issue(
            "info",
            "pnl-derived-from-prices",
            "This file has no P&L column; P&L was computed from entry/exit prices × quantity " +
              "(assumes 1 currency unit per point per unit of quantity — correct for stocks/spot, " +
              "NOT for futures or CFDs with a contract multiplier).",
          ),
        );
      }
    }

    // A row with neither an outcome nor an open position's entry is unusable.
    const hasOutcome = Number.isFinite(r) || tradePnl !== null;
    const isOpenRow =
      !hasOutcome &&
      Number.isFinite(entryTime) &&
      (mapping.exitTime !== undefined ? exitTimeRaw === "" || /^open$/i.test(exitTimeRaw) : false);
    if (!hasOutcome && !isOpenRow) {
      skippedRows++;
      issues.push(
        issue(
          "warning",
          "row-skipped",
          `Line ${record.line}: no usable outcome (no R, no P&L, and entry/exit prices incomplete); skipped.`,
          { row: record.line },
        ),
      );
      continue;
    }

    const trade: ImportedTrade = {
      id: idClean.value === "" ? null : idClean.value,
      symbol: symbolClean.value === "" ? null : symbolClean.value,
      direction,
      entryTime: Number.isFinite(entryTime) ? entryTime : null,
      exitTime: Number.isFinite(exitTime) ? exitTime : null,
      entryPrice: nOrNull(entryPrice),
      exitPrice: nOrNull(exitPrice),
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
      pnl: tradePnl,
      pnlReported: Number.isFinite(pnl),
      fees: nOrNull(feesTotal),
      stopPrice: nOrNull(stopPrice),
      riskAmount: Number.isFinite(riskAmount) && riskAmount > 0 ? riskAmount : null,
      r: nOrNull(r),
      rSource: Number.isFinite(r) ? "explicit" : "unavailable",
      status: isOpenRow ? "open" : "closed",
      sourceRows: [record.line],
    };
    (trade.status === "open" ? open : closed).push(trade);
  }
  return { closed, open, skippedRows };
}

function parseEventRows(
  records: readonly CsvRecord[],
  mapping: ColumnMapping,
  dateOrder: SlashDateOrder,
  timeZone: string | undefined,
  issues: ImportIssue[],
): {
  closed: ImportedTrade[];
  open: ImportedTrade[];
  skippedRows: number;
  executions?: Execution[];
} {
  const events: TradeEvent[] = [];
  let skippedRows = 0;
  for (const record of records) {
    if (record.cells.every((c) => c.trim() === "")) continue;
    const eventRaw = text(record, mapping, "eventType");
    const isEntry = ENTRY_EVENT.test(eventRaw);
    const isExit = !isEntry && EXIT_EVENT.test(eventRaw);
    if (!isEntry && !isExit) {
      skippedRows++;
      issues.push(
        issue(
          "warning",
          "row-skipped",
          `Line ${record.line}: event "${eventRaw || "(empty)"}" is neither an entry nor an exit; skipped.`,
          { row: record.line },
        ),
      );
      continue;
    }
    // Direction: a dedicated column first, else the event text ("Entry short").
    const direction =
      parseDirectionValue(text(record, mapping, "direction")) ??
      (/(long|buy)/i.test(eventRaw) ? "long" : /(short|sell)/i.test(eventRaw) ? "short" : null);
    const time = parseImportTimestamp(text(record, mapping, "entryTime"), dateOrder, timeZone);
    const idClean = sanitizeRetainedText(text(record, mapping, "tradeId"));
    const symbolClean = sanitizeRetainedText(text(record, mapping, "symbol"));
    events.push({
      row: record.line,
      kind: isEntry ? "entry" : "exit",
      id: idClean.value === "" ? null : idClean.value,
      symbol: symbolClean.value === "" ? null : symbolClean.value,
      direction,
      time: Number.isFinite(time) ? time : null,
      price: nOrNull(num(record, mapping, "entryPrice")),
      quantity: nOrNull(num(record, mapping, "quantity")),
      pnl: nOrNull(num(record, mapping, "pnl")),
      fees: nOrNull(Math.abs(num(record, mapping, "fees"))),
      stopPrice: nOrNull(num(record, mapping, "stopPrice")),
      r: nOrNull(num(record, mapping, "r")),
    });
  }
  const { closed, open } = pairEvents(events, issues);
  return { closed, open, skippedRows };
}

function parseExecutions(
  records: readonly CsvRecord[],
  mapping: ColumnMapping,
  dateOrder: SlashDateOrder,
  timeZone: string | undefined,
  issues: ImportIssue[],
): {
  closed: ImportedTrade[];
  open: ImportedTrade[];
  skippedRows: number;
  executions?: Execution[];
} {
  const fills: Execution[] = [];
  let skippedRows = 0;
  for (const record of records) {
    if (record.cells.every((c) => c.trim() === "")) continue;
    const signedMode = mapping.direction === undefined;
    const direction = parseDirectionValue(text(record, mapping, "direction"));
    const quantity = num(record, mapping, "quantity");
    const price = num(record, mapping, "entryPrice");
    const time = parseImportTimestamp(text(record, mapping, "entryTime"), dateOrder, timeZone);
    // Generic-import convention: with no side column, a negative quantity is a sell.
    const side =
      direction !== null ? (direction === "long" ? "buy" : "sell") : quantity < 0 ? "sell" : "buy";
    if (
      (!signedMode && direction === null) ||
      !Number.isFinite(quantity) ||
      quantity === 0 ||
      !Number.isFinite(price)
    ) {
      skippedRows++;
      issues.push(
        issue(
          "warning",
          "row-skipped",
          `Line ${record.line}: an execution needs a side (or signed quantity) and a price; skipped.`,
          { row: record.line },
        ),
      );
      continue;
    }
    const symbolClean = sanitizeRetainedText(text(record, mapping, "symbol"));
    fills.push({
      id: text(record, mapping, "tradeId") || text(record, mapping, "orderId") || undefined,
      row: record.line,
      symbol: symbolClean.value === "" ? null : symbolClean.value,
      side,
      quantity: Math.abs(quantity),
      price,
      time: Number.isFinite(time) ? time : null,
      fees: nOrNull(Math.abs(num(record, mapping, "fees"))),
    });
  }
  return { closed: [], open: [], executions: fills, skippedRows };
}

export const genericCsvAdapter: SourceAdapter = {
  id: "generic-csv",
  label: "Generic trade-history CSV (column mapping by header aliases)",

  // The generic adapter never claims a file; the orchestrator uses it as the
  // designated fallback and grades confidence from the mapping coverage.
  detect(): AdapterMatch | null {
    return null;
  },

  parse(table: CsvTable, ctx: AdapterContext): AdapterParseResult {
    const issues: ImportIssue[] = [];
    const { mapping, unmapped } = mapHeaders(table.header, table.records);
    if (ctx.mappingOverride !== undefined) {
      for (const [field, index] of Object.entries(ctx.mappingOverride)) {
        if (typeof index === "number" && index >= 0 && index < table.header.length) {
          mapping[field as keyof ColumnMapping] = index;
        }
      }
    }
    if (unmapped.length > 0) {
      issues.push(
        issue(
          "info",
          "ambiguous-mapping",
          `Columns not recognized (ignored): ${unmapped.map((h) => `"${h}"`).join(", ")}. ` +
            "If one of them holds the R-multiple, risk, P&L, or a timestamp, map it explicitly.",
        ),
      );
    }

    const filtered = filterByStatus(table, issues);
    let records = filtered.records;
    const statusSkipped = filtered.skipped;

    // TradeZella/Tradervue-style split "Date" + "Time" columns: merge them
    // into the time cell so one timestamp parser handles both layouts.
    const entryIdx = mapping.entryTime;
    if (entryIdx !== undefined && /date/.test(normalizeHeader(table.header[entryIdx] ?? ""))) {
      const used = new Set(Object.values(mapping));
      const timeIdx = table.header.findIndex(
        (h, i) => !used.has(i) && normalizeHeader(h) === "time",
      );
      if (timeIdx !== -1) {
        records = records.map((record) => {
          const cells = [...record.cells];
          const date = (cells[entryIdx] ?? "").trim();
          const time = (cells[timeIdx] ?? "").trim();
          if (date !== "" && time !== "") cells[entryIdx] = `${date} ${time}`;
          return { ...record, cells };
        });
      }
    }

    const dateOrder = resolveDateOrder(records, mapping, ctx.dateOrder, issues);
    const shape = decideShape(mapping, records);
    const parsed =
      shape === "event-rows"
        ? parseEventRows(records, mapping, dateOrder, ctx.timeZone, issues)
        : shape === "executions"
          ? parseExecutions(records, mapping, dateOrder, ctx.timeZone, issues)
          : parseTradePerRow(records, mapping, dateOrder, ctx.timeZone, issues);

    return {
      closed: sortTrades(parsed.closed),
      open: parsed.open,
      issues,
      mapping,
      executions: parsed.executions,
      skippedRows: parsed.skippedRows + statusSkipped,
      dedupeSafe: shape !== "executions",
    };
  },
};
