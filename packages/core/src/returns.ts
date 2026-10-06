import type { RoundTrip } from "./types";

type ReturnInputs = Pick<RoundTrip, "netPnl" | "avgEntry" | "quantity"> & {
  assetClass?: string | null;
  contractMultiplier?: number | null;
};

/** Net return on absolute entry notional, as a ratio (not return on margin).
 * Uses total entry quantity and its weighted average price over the trade cycle.
 * Unknown derivative multipliers and unusable notionals have no defined return.
 */
export function netReturnOnEntry(trade: ReturnInputs): number | null {
  const multiplier =
    trade.contractMultiplier ??
    (["futures", "option", "forex", "cfd"].includes(trade.assetClass ?? "") ? null : 1);
  if (
    multiplier === null ||
    !Number.isFinite(multiplier) ||
    multiplier <= 0 ||
    !Number.isFinite(trade.netPnl) ||
    !Number.isFinite(trade.avgEntry) ||
    !Number.isFinite(trade.quantity) ||
    trade.quantity <= 0
  )
    return null;
  const notional = Math.abs(trade.avgEntry) * trade.quantity * multiplier;
  if (!Number.isFinite(notional) || notional <= 0) return null;
  const result = trade.netPnl / notional;
  return Number.isFinite(result) ? result : null;
}
