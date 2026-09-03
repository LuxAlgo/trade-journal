/* Adapted from ChristopherDownie/prop-firm-sim, commit 2aedb92208ab34ef7a1d0e42c290b8b78bae081f.
 * Copyright (c) 2026 LuxAlgo. MIT license: packages/importers/LICENSE.
 * Journal adaptation keeps history parsing separate from existing fill importers. */

/* History parsing adapted from the simulator: text -> sections/headers ->
 * source adapters -> validated trades or raw fills. Existing journal fill
 * importers run before this module. Simulation and R-series entry points are
 * deliberately omitted from the journal integration. */

import type {
  AdapterContext,
  AdapterParseResult,
  CsvTable,
  SourceAdapter,
} from "./adapters/adapter";
import { genericCsvAdapter } from "./adapters/generic";
import { metaTraderAdapter } from "./adapters/metatrader";
import { mt5DealsAdapter } from "./adapters/mt5deals";
import { tradingViewAdapter } from "./adapters/tradingview";
import { matchHeader } from "./aliases";
import {
  normalizeImportText,
  parseCsv,
  parseNumericCell,
  type CsvLimits,
  type CsvRecord,
} from "./csv";
import {
  extractHtmlTables,
  looksLikeHtml,
  truncateAtSectionBoundary,
  type HtmlTable,
} from "./html";
import {
  GENERIC_FORMAT_ADVICE,
  issue,
  sortTrades,
  type ColumnMapping,
  type DetectedFormat,
  type ImportIssue,
  type ImportResult,
  type ImportedTrade,
} from "./model";
import type { SlashDateOrder } from "./timestamps";

/** Registered source adapters, checked in order; the generic adapter is the fallback. */
export const ADAPTERS: readonly SourceAdapter[] = [
  tradingViewAdapter,
  metaTraderAdapter,
  mt5DealsAdapter,
  genericCsvAdapter,
];

export interface ImportOptions extends CsvLimits {
  /** Force a specific adapter (an id from ADAPTERS) instead of detection. */
  adapterId?: string;
  /** Manual column-mapping overrides (canonical field → 0-based column index). */
  mapping?: ColumnMapping;
  /** Slash-date order for ambiguous "03/04/2025"-style dates. */
  dateOrder?: SlashDateOrder;
  timeZone?: string;
}

function emptyResult(format: DetectedFormat, issues: ImportIssue[]): ImportResult {
  return {
    ok: false,
    format,
    mapping: null,
    header: null,
    trades: [],
    openTrades: [],
    issues,
    stats: { rows: 0, parsedTrades: 0, skippedRows: 0, duplicatesRemoved: 0 },
  };
}

/** Does this row look like a header: mostly non-numeric cells, some of them known aliases? */
function headerScore(cells: readonly string[]): number {
  let aliasHits = 0;
  let numeric = 0;
  for (const cell of cells) {
    const trimmed = cell.trim();
    if (trimmed === "") continue;
    if (Number.isFinite(parseNumericCell(trimmed))) numeric++;
    else if (matchHeader(trimmed) !== null) aliasHits++;
  }
  return numeric > 0 ? 0 : aliasHits;
}

/**
 * Find the header row. Usually record 0; broker statements sometimes bury the
 * table under a disclaimer/summary preamble, so the first 30 records are
 * scanned for the row that matches the most canonical aliases (min 2).
 */
function locateHeader(
  records: readonly CsvRecord[],
): { headerIndex: number; score: number } | null {
  let best: { headerIndex: number; score: number } | null = null;
  const limit = Math.min(records.length, 30);
  for (let i = 0; i < limit; i++) {
    const score = headerScore(records[i]!.cells);
    if (score >= 2 && (best === null || score > best.score)) best = { headerIndex: i, score };
    if (best !== null && i > best.headerIndex + 5) break; // don't wander past a good header
  }
  if (best !== null) return best;
  // A first row that is all text across 2+ columns with at least one known
  // alias still reads as a header (e.g. "symbol,notes").
  const first = records[0]!;
  if (first.cells.length >= 2 && headerScore(first.cells) >= 1) return { headerIndex: 0, score: 1 };
  return null;
}

/** Duplicate-trade key: id when present, else the full field tuple. */
function tradeKey(trade: ImportedTrade): string {
  if (trade.id !== null) return `id:${trade.id}|${trade.symbol ?? ""}`;
  return [
    trade.symbol,
    trade.direction,
    trade.entryTime,
    trade.exitTime,
    trade.entryPrice,
    trade.exitPrice,
    trade.quantity,
    trade.pnl,
  ].join("|");
}

/** Cross-field sanity checks that catch a WRONG interpretation, not just bad cells. */
function validateTrades(trades: ImportedTrade[], issues: ImportIssue[]): void {
  let mismatches = 0;
  for (const trade of trades) {
    if (
      trade.direction !== null &&
      trade.entryPrice !== null &&
      trade.exitPrice !== null &&
      trade.pnl !== null
    ) {
      const sign = trade.direction === "long" ? 1 : -1;
      const move = (trade.exitPrice - trade.entryPrice) * sign;
      const gross = trade.pnl + Math.abs(trade.fees ?? 0);
      const materialMove = Math.abs(move) > Math.abs(trade.entryPrice) * 1e-4;
      if (materialMove && gross !== 0 && Math.sign(move) !== Math.sign(gross)) {
        mismatches++;
        if (mismatches <= 3) {
          issues.push(
            issue(
              "warning",
              "direction-pnl-mismatch",
              `Trade ${trade.id ?? `at line ${trade.sourceRows[0] ?? "?"}`}: a ${trade.direction} from ` +
                `${trade.entryPrice} to ${trade.exitPrice} should ${move > 0 ? "win" : "lose"}, but P&L is ` +
                `${trade.pnl}. The direction or price columns may be mapped wrong.`,
              trade.sourceRows[0] !== undefined ? { row: trade.sourceRows[0] } : {},
            ),
          );
        }
      }
    }
  }
  if (mismatches > 3) {
    issues.push(
      issue(
        "warning",
        "direction-pnl-mismatch",
        `${mismatches} trades total have a P&L sign that contradicts their direction and prices — ` +
          "review the column mapping before trusting this import.",
      ),
    );
  }
}

/**
 * The trades section of an HTML statement, chosen adapter-first: every header
 * candidate row (strong alias score) opens a section that runs to the next
 * section boundary; the first section a signature adapter claims wins, so a
 * report's Positions section beats its Orders/Deals sections and a tester
 * report's Deals section is read with MT5 deal semantics. With no signature
 * match, the best-scoring section goes to the generic mapper.
 */
function chooseStatementSection(
  tables: readonly HtmlTable[],
  issues: ImportIssue[],
): {
  header: string[];
  records: CsvRecord[];
  adapter: SourceAdapter | null;
  signals: string[];
} | null {
  interface Candidate {
    table: HtmlTable;
    index: number;
    score: number;
  }
  // Scan every row: a statement's trades section can sit tens of thousands of
  // rows deep (a tester report lists all cancelled orders first). headerScore
  // is cheap and returns 0 on any row containing numbers.
  const candidates: Candidate[] = [];
  for (const table of tables) {
    for (let i = 0; i < table.records.length; i++) {
      const score = headerScore(table.records[i]!.cells);
      if (score >= 3) candidates.push({ table, index: i, score });
    }
  }
  if (candidates.length === 0) return null;

  const sectionOf = (
    candidate: Candidate,
  ): { header: string[]; records: CsvRecord[]; line: number } => {
    const headerRecord = candidate.table.records[candidate.index]!;
    const after = candidate.table.records.slice(candidate.index + 1);
    const trimmed = truncateAtSectionBoundary(after, (cells) => headerScore(cells) >= 3);
    return {
      header: headerRecord.cells.map((c) => c.trim()),
      records: trimmed.records,
      line: headerRecord.line,
    };
  };

  const signatureAdapters = ADAPTERS.filter((a) => a.id !== genericCsvAdapter.id);
  for (const candidate of candidates) {
    const section = sectionOf(candidate);
    if (section.records.length === 0) continue;
    for (const adapter of signatureAdapters) {
      const match = adapter.detect({
        delimiter: ",",
        header: section.header,
        records: section.records,
      });
      if (match !== null) {
        issues.push(
          issue(
            "info",
            "row-recovered",
            `HTML statement: the section headed at line ${section.line} (${section.records.length} rows) ` +
              `matched "${adapter.label}"; other sections (orders, deals, open positions, summaries) ` +
              "were not imported as trades.",
          ),
        );
        return {
          header: section.header,
          records: section.records,
          adapter,
          signals: match.signals,
        };
      }
    }
  }

  let best = candidates[0]!;
  for (const candidate of candidates) if (candidate.score > best.score) best = candidate;
  const section = sectionOf(best);
  if (section.records.length === 0) return null;
  issues.push(
    issue(
      "info",
      "row-recovered",
      `HTML table detected: the section headed at line ${section.line} (${section.records.length} rows) ` +
        "was selected by its column names.",
    ),
  );
  return {
    header: section.header,
    records: section.records,
    adapter: null,
    signals: ["columns resolved by header aliases in an HTML table"],
  };
}

/**
 * Import a pasted or uploaded trade history (any supported tabular format).
 * Inspect `result.ok` and `result.issues` before accepting any records.
 */
export function importTradeHistory(rawText: string, options: ImportOptions = {}): ImportResult {
  const issues: ImportIssue[] = [];
  const limits = { maxChars: options.maxChars, maxRows: options.maxRows };

  // Repair wrong-charset decodes first: MetaTrader reports are UTF-16LE and
  // arrive NUL-interleaved when read as UTF-8.
  const normalized = normalizeImportText(rawText);
  const text = normalized.text;
  if (normalized.repairedUtf16) {
    issues.push(
      issue(
        "warning",
        "malformed-csv",
        "The file appears to be UTF-16 read as UTF-8 (MetaTrader saves reports that way); it was " +
          "repaired automatically. Non-ASCII symbol names may look garbled — if so, re-save the " +
          "file as UTF-8.",
      ),
    );
  }

  // HTML statements (MetaTrader reports, broker portals) are reduced to table
  // rows up front; everything downstream is format-agnostic.
  const htmlSource = looksLikeHtml(text);
  let allRecords: CsvRecord[] = [];
  let delimiter = ",";
  let statementSection: ReturnType<typeof chooseStatementSection> = null;
  if (htmlSource) {
    const extracted = extractHtmlTables(text, limits);
    issues.push(...extracted.issues);
    statementSection = chooseStatementSection(extracted.tables, issues);
    if (statementSection === null) {
      // No strong header anywhere: fall back to the biggest table and let the
      // ordinary header locator try (covers simple 2-column HTML tables).
      let best: HtmlTable | null = null;
      for (const candidate of extracted.tables) {
        if (best === null || candidate.records.length > best.records.length) best = candidate;
      }
      allRecords = best?.records ?? [];
    }
  } else {
    const csv = parseCsv(text, limits);
    issues.push(...csv.issues);
    allRecords = csv.records;
    delimiter = csv.delimiter;
  }

  if (statementSection === null && allRecords.length === 0) {
    issues.push(issue("error", "empty-input", "The input contains no rows."));
    return emptyResult(
      { kind: "unknown", label: "Empty input", confidence: "exact", signals: [] },
      issues,
    );
  }

  if (options.adapterId !== undefined && !ADAPTERS.some((a) => a.id === options.adapterId)) {
    issues.push(
      issue(
        "error",
        "unsupported-format",
        `Unknown adapter "${options.adapterId}". Available: ${ADAPTERS.map((a) => a.id).join(", ")}.`,
      ),
    );
    return emptyResult(
      { kind: "unknown", label: "Unknown adapter", confidence: "exact", signals: [] },
      issues,
    );
  }

  // Header (and preamble) location. A manual mapping may address columns by
  // index, so a missing header is only fatal without one. HTML statements
  // already carry their chosen section's header.
  const located = statementSection === null ? locateHeader(allRecords) : null;
  let header: string[];
  let records: CsvRecord[];
  if (statementSection !== null) {
    header = statementSection.header;
    records = statementSection.records;
  } else if (located !== null) {
    header = allRecords[located.headerIndex]!.cells.map((c) => c.trim());
    records = allRecords.slice(located.headerIndex + 1);
    if (located.headerIndex > 0 && !htmlSource) {
      issues.push(
        issue(
          "info",
          "row-recovered",
          `The column header was found on line ${allRecords[located.headerIndex]!.line}; ` +
            `${located.headerIndex} preamble row(s) above it were ignored.`,
        ),
      );
    }
    if (htmlSource) {
      // Multi-section statements repeat headers and interleave section titles;
      // import only the section the located header governs.
      const trimmed = truncateAtSectionBoundary(records, (cells) => headerScore(cells) >= 2);
      records = trimmed.records;
    }
  } else if (options.mapping !== undefined) {
    header = allRecords[0]!.cells.map((_, i) => `column ${i + 1}`);
    records = [...allRecords];
  } else {
    issues.push(
      issue(
        "error",
        "no-header",
        "No column header row was found, so the columns cannot be interpreted. " +
          GENERIC_FORMAT_ADVICE +
          " Alternatively, provide a manual column mapping. If this was meant to be a plain " +
          "R-multiple series, it contains tokens that are not numbers.",
      ),
    );
    return emptyResult(
      { kind: "unknown", label: "Unrecognized tabular data", confidence: "exact", signals: [] },
      issues,
    );
  }

  const table: CsvTable = { delimiter, header, records };
  const ctx: AdapterContext = {
    mappingOverride: options.mapping,
    dateOrder: options.dateOrder,
    timeZone: options.timeZone,
  };

  // Adapter selection: forced id → statement section's adapter → signature
  // detection → generic fallback.
  let adapter: SourceAdapter | undefined;
  let format: DetectedFormat;
  if (options.adapterId === undefined && statementSection?.adapter != null) {
    adapter = statementSection.adapter;
    format = {
      kind: adapter.id,
      label: adapter.label,
      confidence: "exact",
      signals: statementSection.signals,
    };
  } else if (options.adapterId !== undefined) {
    adapter = ADAPTERS.find((a) => a.id === options.adapterId);
    if (adapter === undefined) {
      issues.push(
        issue(
          "error",
          "unsupported-format",
          `Unknown adapter "${options.adapterId}". Available: ${ADAPTERS.map((a) => a.id).join(", ")}.`,
        ),
      );
      return emptyResult(
        { kind: "unknown", label: "Unknown adapter", confidence: "exact", signals: [] },
        issues,
      );
    }
    format = {
      kind: adapter.id,
      label: adapter.label,
      confidence: "exact",
      signals: ["selected manually"],
    };
  } else {
    let match: { adapter: SourceAdapter; signals: string[] } | null = null;
    for (const candidate of ADAPTERS) {
      const detection = candidate.detect(table);
      if (detection !== null) {
        match = { adapter: candidate, signals: detection.signals };
        break; // registry order is the tiebreak; detections are signature-exact
      }
    }
    if (match !== null) {
      adapter = match.adapter;
      format = {
        kind: adapter.id,
        label: adapter.label,
        confidence: "exact",
        signals: match.signals,
      };
    } else {
      adapter = genericCsvAdapter;
      format = {
        kind: adapter.id,
        label: adapter.label,
        confidence: "high",
        signals: ["no known platform signature matched; columns resolved by header aliases"],
      };
    }
  }

  const parsed: AdapterParseResult = adapter.parse(table, ctx);
  issues.push(...parsed.issues);

  // The generic fallback earns "high" confidence only if the mapping actually
  // supports interpretation; otherwise the import is an honest failure.
  if (
    format.kind === "generic-csv" &&
    parsed.closed.length === 0 &&
    parsed.open.length === 0 &&
    !parsed.executions?.length
  ) {
    const mapped = parsed.mapping === null ? [] : Object.keys(parsed.mapping);
    issues.push(
      issue(
        "error",
        "unmapped-required-fields",
        `A header row was detected (${header.join(", ")}), but no trades could be built from it. ` +
          `Recognized columns: ${mapped.length > 0 ? mapped.join(", ") : "none"}. ` +
          "A usable file needs either an R column, a P&L column, entry/exit prices, or fill rows " +
          "(side, quantity, price). Map the columns manually if they are named unusually. " +
          GENERIC_FORMAT_ADVICE,
      ),
    );
    format = { ...format, confidence: "low" };
  }

  // Duplicate-trade removal (skipped for execution sources, where identical
  // rows can be legitimate fills).
  let duplicatesRemoved = 0;
  let closed = parsed.closed;
  if (parsed.dedupeSafe) {
    const seen = new Map<string, number>();
    const unique: ImportedTrade[] = [];
    for (const trade of closed) {
      const key = tradeKey(trade);
      const count = seen.get(key) ?? 0;
      seen.set(key, count + 1);
      if (count === 0) unique.push(trade);
      else duplicatesRemoved++;
    }
    if (duplicatesRemoved > 0) {
      issues.push(
        issue(
          "warning",
          "duplicate-rows",
          `${duplicatesRemoved} duplicate trade(s) (same id or identical fields) were removed — ` +
            "the file may contain the same history twice.",
        ),
      );
    }
    closed = unique;
  }

  validateTrades(closed, issues);

  const trades = sortTrades(closed);

  return {
    ok: trades.length > 0 || !!parsed.executions?.length,
    format,
    mapping: parsed.mapping,
    header,
    executions: parsed.executions,
    trades,
    openTrades: parsed.open,
    issues,
    stats: {
      rows: records.length,
      parsedTrades: trades.length,
      skippedRows: parsed.skippedRows,
      duplicatesRemoved,
    },
  };
}
