/** Shared request/response contract; no database or parser code in the client bundle. */
export interface ImportReviewOptions {
  sourceMappings?: Record<string, string>;
  completeHistory?: boolean;
  approveFeeCorrections?: boolean;
  previewToken?: string;
}
export interface ImportReview {
  sources: { key: string; label: string; selected: string | null; saved: boolean }[];
  savedSources: { id: string; name: string }[];
  inserted: number;
  duplicates: number;
  corrections: { symbol: string; executedAt: string; oldFee: number; newFee: number }[];
  conflicts: string[];
  warnings: string[];
  needsCompleteHistory: boolean;
  totals: { closedTrades: number; openTrades: number; netPnl: number; fees: number } | null;
  multipliers: { symbol: string; value: number | null }[];
  currency: string;
  token: string | null;
}
