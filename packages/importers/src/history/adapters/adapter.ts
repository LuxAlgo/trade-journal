/* Adapted from ChristopherDownie/prop-firm-sim, commit 2aedb92208ab34ef7a1d0e42c290b8b78bae081f.
 * Copyright (c) 2026 LuxAlgo. MIT license: packages/importers/LICENSE.
 * Journal adaptation keeps history parsing separate from existing fill importers. */

/*
  Source-adapter contract. An adapter recognizes one family of exports by a
  deterministic signature (headers + row shapes) and converts it to canonical
  ImportedTrades. Adding a platform = adding one file that implements this
  interface and registering it in the ADAPTERS list (see import.ts); nothing
  else in the pipeline changes.
*/

import type { Execution } from "../reconstruct";
import type { CsvRecord } from "../csv";
import type { ColumnMapping, DetectionConfidence, ImportIssue, ImportedTrade } from "../model";
import type { SlashDateOrder } from "../timestamps";

/** Parsed tabular input handed to adapters: header row + data records. */
export interface CsvTable {
  delimiter: string;
  header: string[];
  /** Data records only (header excluded), with 1-based source line numbers. */
  records: CsvRecord[];
}

export interface AdapterMatch {
  confidence: DetectionConfidence;
  /** Human-readable evidence ("header has 'Trade number'", ...) shown to the user. */
  signals: string[];
}

export interface AdapterContext {
  timeZone?: string;
  /** Manual column-mapping overrides (canonical field → 0-based column index). */
  mappingOverride?: ColumnMapping | undefined;
  /** Explicit slash-date order ("03/04/2025"): month-first or day-first. */
  dateOrder?: SlashDateOrder | undefined;
}

export interface AdapterParseResult {
  executions?: Execution[];
  closed: ImportedTrade[];
  open: ImportedTrade[];
  issues: ImportIssue[];
  /** Resolved mapping for the UI's review step; null when not column-mapped. */
  mapping: ColumnMapping | null;
  skippedRows: number;
  /**
   * False when the source can legitimately contain identical rows (raw
   * executions); the orchestrator then skips duplicate-trade removal.
   */
  dedupeSafe: boolean;
}

export interface SourceAdapter {
  /** Stable id, used as DetectedFormat.kind and for ImportOptions.adapterId. */
  id: string;
  label: string;
  /** Null when this adapter does not recognize the table. Must be deterministic. */
  detect(table: CsvTable): AdapterMatch | null;
  parse(table: CsvTable, ctx: AdapterContext): AdapterParseResult;
}
