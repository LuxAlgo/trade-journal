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

/**
 * Display-only localization for reconciliation review messages (docs/i18n.md
 * §7): the English strings inside `ImportReview.conflicts`/`warnings` stay the
 * data of record — the server contract, its commit guard and the tests read
 * them verbatim, and nothing rewrites them. The UI resolves a matched message
 * to a key in the `import` namespace (or `import-diagnostics` for texts the
 * error layer already catalogs) and falls back to the original English string
 * when nothing matches. Parameters are captured from the stable template
 * shapes emitted by server/ninjatrader-import.ts and server/ninjatrader-order.ts.
 */
export interface ReviewMessageKey {
  /** Message namespace holding the localized text. */
  ns: "import" | "import-diagnostics";
  /** Key path inside that namespace. */
  key: string;
  /** ICU parameters extracted from the English template. */
  params: Record<string, string | number>;
}

const reviewMessagePatterns: {
  match: RegExp;
  ns: "import" | "import-diagnostics";
  key: string;
  params?: (groups: string[]) => Record<string, string | number>;
}[] = [
  // Reconciliation conflicts (server/ninjatrader-import.ts, server/ninjatrader-order.ts).
  {
    match: /^(\d+) invalid execution rows were skipped\./,
    ns: "import",
    key: "conflicts.skippedInvalidRows",
    params: ([count]) => ({ count: Number(count) }),
  },
  { match: /^No executions to import\.$/, ns: "import", key: "conflicts.noExecutions" },
  {
    match: /^(.+): a saved source mapping cannot be reassigned\./,
    ns: "import",
    key: "conflicts.savedMappingLocked",
    params: ([label]) => ({ label: label ?? "" }),
  },
  {
    match: /^(.+): select a source belonging to this destination account\./,
    ns: "import",
    key: "conflicts.selectSource",
    params: ([label]) => ({ label: label ?? "" }),
  },
  {
    match: /^(.+): choose its saved source account, or explicitly create a new source\./,
    ns: "import",
    key: "conflicts.chooseSource",
    params: ([label]) => ({ label: label ?? "" }),
  },
  {
    match: /^Missing NinjaTrader source facts\.$/,
    ns: "import",
    key: "conflicts.missingSourceFacts",
  },
  {
    match: /^This account contains matching legacy fills without reliable source identity\./,
    ns: "import",
    key: "conflicts.legacyFills",
  },
  {
    match: /^One execution ID has contradictory values within this export\./,
    ns: "import",
    key: "conflicts.contradictoryExecutionId",
  },
  {
    match: /^This source has earlier imports using a different statement timezone\./,
    ns: "import",
    key: "conflicts.differentTimezone",
  },
  {
    match: /^Matching fills use different execution-ID layouts\./,
    ns: "import",
    key: "conflicts.mixedIdLayouts",
  },
  {
    match:
      /^(.+): an existing execution ID has changed quantity, price, side, instrument, time or ordering facts\./,
    ns: "import",
    key: "conflicts.changedExecutionId",
    params: ([symbol]) => ({ symbol: symbol ?? "" }),
  },
  {
    match: /^Fees changed on fills without execution IDs\./,
    ns: "import",
    key: "conflicts.feesChangedWithoutIds",
  },
  {
    match: /^This export overlaps earlier fills without execution IDs\./,
    ns: "import",
    key: "conflicts.overlapNeedsCompleteHistory",
  },
  {
    match:
      /^The declared complete export omits or changes previously imported fills in its covered period\./,
    ns: "import",
    key: "conflicts.incompleteCompleteExport",
  },
  {
    match:
      /^Set a positive contract multiplier for (.+) in Settings, then review this import again\.$/,
    ns: "import",
    key: "conflicts.multiplierRequired",
    params: ([symbol]) => ({ symbol: symbol ?? "" }),
  },
  {
    match: /^This import would replace existing trade identities/,
    ns: "import",
    key: "conflicts.wouldReplaceIdentities",
  },
  {
    match: /^(.+) at (.+): execution order is ambiguous or contradicts Entry\/Exit\./,
    ns: "import",
    key: "conflicts.ambiguousOrder",
    params: ([symbol, time]) => ({ symbol: symbol ?? "", time: time ?? "" }),
  },
  // Review warnings (server/ninjatrader-import.ts).
  {
    match: /^Without execution IDs, identical-looking new fills/,
    ns: "import",
    key: "reviewWarnings.noExecutionIds",
  },
  {
    match: /^(\d+) rows omit commission\./,
    ns: "import",
    key: "reviewWarnings.missingFees",
    params: ([count]) => ({ count: Number(count) }),
  },
  // Parser errors that can land in `conflicts` verbatim; already cataloged by
  // the error layer's import-diagnostics namespace (docs/i18n.md §7.1).
  {
    match: /^An execution has an invalid commission\./,
    ns: "import-diagnostics",
    key: "execution_invalid_commission",
  },
  {
    match: /^Unrecognized NinjaTrader entry\/exit value\./,
    ns: "import-diagnostics",
    key: "execution_invalid_effect",
  },
  {
    match: /^Execution sequence must be a non-negative integer\.$/,
    ns: "import-diagnostics",
    key: "execution_invalid_sequence",
  },
  {
    match: /^One NinjaTrader execution ID describes different fills\./,
    ns: "import-diagnostics",
    key: "execution_id_conflict",
  },
  {
    match: /^(.+): this file mixes Open\/Close position labels with other actions\./,
    ns: "import-diagnostics",
    key: "mixed_position_labels",
    params: ([symbol]) => ({ symbol: symbol ?? "" }),
  },
  {
    match:
      /^(.+): an Open\/Close fill needs a symbol, positive quantity, price and valid timestamp\.$/,
    ns: "import-diagnostics",
    key: "invalid_position_fill",
    params: ([symbol]) => ({ symbol: symbol ?? "" }),
  },
];

/**
 * Resolve a review message to its localized key/params, or null when the
 * string is unknown — callers must then render the original English text.
 */
export const reviewMessageKey = (message: string): ReviewMessageKey | null => {
  for (const pattern of reviewMessagePatterns) {
    const groups = pattern.match.exec(message);
    if (groups)
      return {
        ns: pattern.ns,
        key: pattern.key,
        params: pattern.params ? pattern.params(groups.slice(1)) : {},
      };
  }
  return null;
};
