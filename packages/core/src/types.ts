/**
 * The journal's domain model.
 *
 * An `Execution` is a single fill — the atomic fact. Executions come from broker
 * sync (@luxalgo/broker-sdk), statement imports, or manual entry, and are never
 * mutated by analytics. A `RoundTrip` is a position cycle (flat → flat) derived
 * from executions; every metric in the journal is computed from round trips.
 */

export type AssetClass = "equity" | "option" | "futures" | "forex" | "crypto" | "cfd" | "other";

export type ExecutionSource = "sync" | "import" | "manual";

export interface Execution {
  id: string;
  accountId: string;
  symbol: string;
  side: "buy" | "sell";
  /** Always positive; `side` carries direction. */
  quantity: number;
  /** Per unit, in the account currency. */
  price: number;
  /** Commission + fees for this fill, absolute value. */
  fee: number;
  /** ISO 8601. */
  executedAt: string;
  assetClass?: AssetClass;
  source: ExecutionSource;
}

/**
 * How realized P&L is attributed to partial exits while a position is still
 * open. The total P&L of a completed cycle is identical under every method;
 * the method changes which entry lots a given exit is matched against.
 */
export type ProfitCalcMethod = "fifo" | "lifo" | "wavg";

export type TradeDirection = "long" | "short";

export type TradeStatus = "open" | "win" | "loss" | "breakeven";

export interface ExitAttribution {
  /** The exit execution id. */
  executionId: string;
  /** Realized net-of-nothing (gross) P&L attributed to this exit under the account's method. */
  grossPnl: number;
  quantity: number;
}

export interface RoundTrip {
  /**
   * Stable key that survives rebuilds: `accountId|symbol|direction|openedAt`.
   * User annotations (notes, tags, ratings) anchor to this key so re-imports
   * and re-syncs never orphan them.
   */
  key: string;
  accountId: string;
  symbol: string;
  assetClass?: AssetClass;
  direction: TradeDirection;
  status: TradeStatus;
  openedAt: string;
  /** Present once the position returned to flat. */
  closedAt?: string;
  /** Total entry quantity over the cycle. */
  quantity: number;
  /** Quantity still open (0 for closed trades). */
  openQuantity: number;
  /** Quantity-weighted average entry price. */
  avgEntry: number;
  /** Quantity-weighted average exit price (undefined until at least one exit). */
  avgExit?: number;
  /** Realized P&L before fees, in account currency. */
  grossPnl: number;
  /** All fees across the cycle's executions. */
  fees: number;
  /** grossPnl - fees. */
  netPnl: number;
  /** Number of fills in the cycle. */
  executionCount: number;
  executionIds: string[];
  /** Per-exit realized P&L attribution under the chosen method. */
  exits: ExitAttribution[];
  /** Milliseconds between open and close (undefined while open). */
  durationMs?: number;
}

/** User-authored context attached to a round trip (stored by the app, joined for analytics). */
export interface TradeAnnotations {
  tags?: string[];
  mistakes?: string[];
  playbook?: string;
  rating?: number;
  /** Price levels planned at entry; enable R-multiple analytics. */
  stopLoss?: number;
  profitTarget?: number;
  reviewed?: boolean;
}

/** A round trip enriched with its annotations — the input to most analytics. */
export type AnnotatedTrade = RoundTrip & { annotations?: TradeAnnotations };
