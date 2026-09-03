import type { TradeMetrics } from "./metrics";

/**
 * The Edge Score — an OPEN composite performance score (0-100).
 *
 * Closed-source journals sell an opaque score; this one is a documented, pinned
 * formula anyone can verify (see docs/edge-score.md). Six components, each
 * normalized to 0-100 with an explicit "full marks" threshold, combined with
 * explicit weights. Changing thresholds or weights is a breaking change and
 * gets a major version bump of the formula (`EDGE_SCORE_VERSION`).
 *
 * Components and full-marks thresholds:
 * - winRate:      60% win rate            (weight 15)
 * - profitFactor: 3.0                     (weight 25)
 * - avgWinLoss:   2.5 : 1                 (weight 20)
 * - drawdown:     0% of peak (linear to 25%+ = 0) (weight 15)
 * - recovery:     net P&L = 3× max drawdown (weight 10)
 * - consistency:  largest winning day ≤ 15% of total day profits (weight 15)
 */

/**
 * Formula history:
 * - v1: initial release.
 * - v2: gross profit and gross loss (the profit factor inputs) sum the positive
 *   and negative net P&L of every closed trade, regardless of whether a trade is
 *   labeled "breakeven" by a tolerance band. Identical to v1 when the breakeven
 *   tolerance is zero.
 */
export const EDGE_SCORE_VERSION = 2;

export interface EdgeScoreComponents {
  winRate: number;
  profitFactor: number;
  avgWinLoss: number;
  drawdown: number;
  recovery: number;
  consistency: number;
}

export interface EdgeScore {
  version: number;
  /** 0-100 weighted composite; null with fewer than 5 closed trades. */
  score: number | null;
  components: EdgeScoreComponents;
  closedTrades: number;
}

export const EDGE_SCORE_WEIGHTS: Record<keyof EdgeScoreComponents, number> = {
  winRate: 15,
  profitFactor: 25,
  avgWinLoss: 20,
  drawdown: 15,
  recovery: 10,
  consistency: 15,
};

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

export const computeEdgeScore = (metrics: TradeMetrics): EdgeScore => {
  const winRate = clamp01((metrics.winRate ?? 0) / 0.6) * 100;

  const pf = metrics.profitFactorIsInfinite ? 3 : (metrics.profitFactor ?? 0);
  const profitFactor = clamp01(pf / 3) * 100;

  const avgWinLoss = clamp01((metrics.avgWinLossRatio ?? 0) / 2.5) * 100;

  const ddPct = metrics.maxDrawdownPct;
  // Without an initial balance the percentage is unknowable; score neutral 50.
  const drawdownScore = ddPct === null ? 50 : (1 - clamp01(ddPct / 0.25)) * 100;

  const recovery =
    metrics.maxDrawdown > 0
      ? clamp01((metrics.recoveryFactor ?? 0) / 3) * 100
      : metrics.netPnl > 0
        ? 100
        : 0;

  const concentration = metrics.profitConcentration;
  const consistency =
    concentration === null
      ? 0
      : concentration <= 0.15
        ? 100
        : (1 - clamp01((concentration - 0.15) / 0.85)) * 100;

  const components: EdgeScoreComponents = {
    winRate,
    profitFactor,
    avgWinLoss,
    drawdown: drawdownScore,
    recovery,
    consistency,
  };

  const totalWeight = Object.values(EDGE_SCORE_WEIGHTS).reduce((total, w) => total + w, 0);
  const weighted =
    Object.entries(components).reduce(
      (total, [k, v]) => total + v * EDGE_SCORE_WEIGHTS[k as keyof EdgeScoreComponents],
      0,
    ) / totalWeight;

  return {
    version: EDGE_SCORE_VERSION,
    score: metrics.closedTrades >= 5 ? Math.round(weighted * 100) / 100 : null,
    components,
    closedTrades: metrics.closedTrades,
  };
};
