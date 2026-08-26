# Design notes

Dark-first trading terminal. Tokens live in `apps/web/src/app/globals.css`; charts
resolve them at runtime (`components/charts/tokens.ts`) because ECharts paints to
canvas, where CSS variables don't reach.

## P&L color is never load-bearing

Trader convention demands green profit / red loss — and green/red is the classic
red-green colorblindness trap (validated: the pair fails CVD separation with ΔE ≈ 4,
far under the ≥ 8 target). The convention stays, so the design compensates by making
color pure reinforcement:

- Every P&L value renders as **signed text** (`+$171.00` / `−$102.50`) in ink tokens
- Bars grow from a **zero baseline** — direction is geometry
- Win/loss ship as **text chips** (`WIN` / `LOSS`), never colored dots alone
- Calendar cells print the number and trade count; the background tint scales with
  **magnitude** (lightness survives CVD), while sign lives in the printed number
- Trade markers differ by **shape and position**: entries ▲ below the bar, exits ▼
  above (Vela's native convention)

## Palette

Categorical slots (`--series-1…8`), chart chrome, and surfaces follow a validated
8-slot palette with fixed assignment order (never cycled; ≥ 4 simultaneous series fold
to "Other"). Sequential encodings are single-hue lightness ramps. One value axis per
pane — never dual-axis.
