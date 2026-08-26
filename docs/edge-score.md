# The Edge Score (v1)

An open, versioned composite of trading performance, 0–100. Closed-source journals sell
an opaque score; this one is a pinned formula anyone can read, verify, and recompute
from their own data. Source of truth: [`packages/core/src/edge-score.ts`](../packages/core/src/edge-score.ts).

## Requirements

- At least **5 closed trades**, otherwise the score is withheld (components still
  computed). Tiny samples produce impressive-looking nonsense; we refuse to print it.

## Components

Each component is normalized to 0–100 with an explicit "full marks" threshold, then
combined with fixed weights:

| Component          | Full marks at                                      | Weight | Why it's in                                                               |
| ------------------ | -------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| Win rate           | 60%                                                | 15     | Consistency of outcomes — capped low because win rate alone is gameable   |
| Profit factor      | 3.0                                                | 25     | The heart of edge: gross profit per dollar of gross loss                  |
| Avg win / avg loss | 2.5 : 1                                            | 20     | Asymmetry — are winners structurally bigger than losers                   |
| Drawdown           | 0% of (initial balance + peak); zero score at ≥25% | 15     | Risk of ruin. Without an initial balance the % is unknowable → neutral 50 |
| Recovery factor    | net P&L = 3× max drawdown                          | 10     | Does the equity curve earn back what it gives up                          |
| Consistency        | largest winning day ≤ 15% of total day profits     | 15     | One lucky day shouldn't carry the score                                   |

**Score = Σ(componentᵢ × weightᵢ) / Σ weights**, rounded to 2 decimals.

## Versioning

The formula is pinned as `EDGE_SCORE_VERSION = 1` and every score carries its version.
Changing any threshold or weight is a breaking change and bumps the version — historical
scores stay comparable within a version.

## Honest limitations

- Thresholds are opinionated calibration points, not statistical truths. They're chosen
  so that a solidly profitable retail track record scores in the 60–80 band.
- The score measures the _record_, not the _future_. A 90 on 6 trades means less than a
  65 on 600 — that's why the trade count ships alongside the score everywhere it's shown.
