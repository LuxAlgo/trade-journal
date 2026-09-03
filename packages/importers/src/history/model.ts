/* Adapted from ChristopherDownie/prop-firm-sim, commit 2aedb92208ab34ef7a1d0e42c290b8b78bae081f.
 * Copyright (c) 2026 LuxAlgo. MIT license: packages/importers/LICENSE.
 * Journal adaptation keeps history parsing separate from existing fill importers. */

import type { Execution } from "./reconstruct";
/*
  Canonical trade model of the import pipeline. Every source format — pasted
  R-series, TradingView strategy exports, MetaTrader statements, generic
  broker/journal CSVs — is converted into ImportedTrade before anything else
  touches it, so source-specific assumptions never leak into the simulator.

  The pipeline never invents data: a field a source does not carry is null,
  and an R-multiple that cannot be derived from the file (plus an explicit,
  user-chosen RiskSpec) stays null with rSource "unavailable".
*/

/** Canonical direction. Sources say buy/sell/long/short/±1; we say this. */
export type TradeDirection = "long" | "short";

/**
 * Where a trade's R-multiple came from — the trust ladder callers surface:
 * - "explicit":   the file carried an R column; validated, not recomputed.
 * - "calculated": derived from data in the file itself (P&L ÷ risk amount,
 *                 or P&L ÷ stop-distance risk).
 * - "inferred":   derived using a user-supplied RiskSpec (e.g. "I risked $50
 *                 per trade") because the file has P&L but no risk info.
 * - "unavailable": not derivable without fabricating a number; r stays null.
 */
export type RSource = "explicit" | "calculated" | "inferred" | "unavailable";

/** One reconstructed trade in canonical form. Currency fields share the file's account currency. */
export interface ImportedTrade {
  /** Source trade/position/ticket id when the file has one. */
  id: string | null;
  symbol: string | null;
  direction: TradeDirection | null;
  /** Position open time, epoch milliseconds UTC. */
  entryTime: number | null;
  /** Position close time, epoch ms UTC; null for open trades or dateless files. */
  exitTime: number | null;
  /** Average entry fill price. */
  entryPrice: number | null;
  /** Average exit fill price. */
  exitPrice: number | null;
  quantity: number | null;
  /** Realized P&L in account currency, net of fees when the source nets them. */
  pnl: number | null;
  /** True only when this value came from the source, rather than price reconstruction. */
  pnlReported?: boolean;
  /** Commission + fees (+ swap) in account currency, as a cost (usually ≥ 0 in sources; sign preserved). */
  fees: number | null;
  /** Initial stop-loss price when the file carries one. */
  stopPrice: number | null;
  /** Initial risk in account currency (from a risk column, stop distance, or RiskSpec). */
  riskAmount: number | null;
  /** Trade result in R-multiples; null when rSource is "unavailable". */
  r: number | null;
  rSource: RSource;
  /** Open positions are reported but excluded from simulation inputs. */
  status: "closed" | "open";
  /** 1-based line numbers in the source file this trade was built from. */
  sourceRows: number[];
}

export type IssueSeverity = "error" | "warning" | "info";

/** Stable machine-readable issue codes; messages are for humans, codes for UIs and tests. */
export type ImportIssueCode =
  | "empty-input"
  | "input-truncated"
  | "malformed-csv"
  | "no-header"
  | "unmapped-required-fields"
  | "ambiguous-mapping"
  | "row-skipped"
  | "row-recovered"
  | "duplicate-rows"
  | "open-trade-excluded"
  | "unmatched-entry"
  | "unmatched-exit"
  | "cancelled-row-ignored"
  | "non-trade-row-ignored"
  | "timestamp-assumed-utc"
  | "exit-before-entry"
  | "direction-pnl-mismatch"
  | "pnl-derived-from-prices"
  | "futures-multiplier-unknown"
  | "formula-like-cell"
  | "invalid-number"
  | "r-explicit-suspect"
  | "r-needs-risk"
  | "r-partial"
  | "r-stop-side-suspect"
  | "r-stop-too-close"
  | "too-few-trades"
  | "template-coverage"
  | "unsupported-format";

/** One diagnostic. Errors block using the affected trade (or the whole import); warnings do not. */
export interface ImportIssue {
  severity: IssueSeverity;
  code: ImportIssueCode;
  /** What was detected, what failed, and what the user can do about it. */
  message: string;
  /** 1-based line number in the source file, when the issue is row-scoped. */
  row?: number;
  /** Source column (header name) when the issue is cell-scoped. */
  column?: string;
}

/** How confidently the format was identified. "exact" = deterministic signature match. */
export type DetectionConfidence = "exact" | "high" | "low";

export interface DetectedFormat {
  /**
   * - "r-series":       plain numbers / JSON array of R-multiples
   * - an adapter id:    a recognized source ("tradingview", "metatrader", "generic-csv", ...)
   * - "unknown":        tabular but not interpretable without manual mapping
   */
  kind: string;
  /** Human-readable name, e.g. "TradingView strategy export (list of trades)". */
  label: string;
  confidence: DetectionConfidence;
  /** Why this format was chosen — shown to the user so detection is auditable. */
  signals: string[];
}

/** Canonical fields a tabular column can map to. */
export type CanonicalField =
  | "tradeId"
  | "orderId"
  | "symbol"
  | "direction"
  | "eventType"
  | "quantity"
  | "entryTime"
  | "exitTime"
  | "entryPrice"
  | "exitPrice"
  | "stopPrice"
  | "pnl"
  | "fees"
  | "swap"
  | "riskAmount"
  | "r"
  | "returnPct";

/** Resolved column mapping for tabular sources: canonical field → 0-based column index. */
export type ColumnMapping = Partial<Record<CanonicalField, number>>;

export interface ImportStats {
  /** Data rows seen (excluding the header). */
  rows: number;
  parsedTrades: number;
  skippedRows: number;
  duplicatesRemoved: number;
}

/** The full result of one import attempt. Never thrown — failures are structured diagnostics. */
export interface ImportResult {
  /** True when at least one closed trade was reconstructed. */
  ok: boolean;
  /** Raw fills stay raw when passed to the journal calculation engine. */
  executions?: Execution[];
  format: DetectedFormat;
  /** Resolved mapping for tabular inputs (for a UI's "review detected columns" step). */
  mapping: ColumnMapping | null;
  /** Header row as parsed, for rendering the mapping. */
  header: string[] | null;
  /** Closed, validated trades in chronological order (entryTime when known). */
  trades: ImportedTrade[];
  /** Open positions found in the file; excluded from simulation inputs. */
  openTrades: ImportedTrade[];
  issues: ImportIssue[];
  stats: ImportStats;
}

/** Journal imports require execution facts, not a simulator-only R series. */
export const GENERIC_FORMAT_ADVICE =
  "Provide symbol, direction, quantity, entry time, exit time, entry price and exit price for completed trades, " +
  "or timestamp, symbol, side, quantity and price for individual fills.";

export function issue(
  severity: IssueSeverity,
  code: ImportIssueCode,
  message: string,
  where: { row?: number; column?: string } = {},
): ImportIssue {
  return { severity, code, message, ...where };
}

/** Order trades chronologically; trades without an entry time keep their relative order at the end. */
export function sortTrades(trades: ImportedTrade[]): ImportedTrade[] {
  return trades
    .map((trade, index) => ({ trade, index }))
    .sort((a, b) => {
      const at = a.trade.entryTime;
      const bt = b.trade.entryTime;
      if (at === null && bt === null) return a.index - b.index;
      if (at === null) return 1;
      if (bt === null) return -1;
      return at - bt || a.index - b.index;
    })
    .map(({ trade }) => trade);
}
