# Performance trends

Reports → Performance trends adds two ordered-trade trends and an individual-trade extreme comparison, without duplicating the dashboard's aggregate cards.

Source: filtered journal round trips, closed trades only, in closing-timestamp order with trade key breaking ties. The existing query layer owns account, date, annotation, and timezone filtering. No trades outside the selection are borrowed to complete windows. Dates are displayed in the journal timezone.

## Definitions and chart map

- Rolling win rate: wins / 20 closed trades, including losses and breakevens in the denominator. Honors the journal's configured outcome classification.
- Rolling average net P&L: sum of net P&L / 20 closed trades, after recorded fees.
- Each point is the full window ending at the indicated trade. X is closed-trade sequence, not elapsed time. The first point is trade 20. Overlapping windows are descriptive, not independent observations or forecasts.
- Reference: the same measure across all closed trades in the active selection; not a target or a previous-period comparison.
- Largest winner and loser: maximum net P&L among classified wins and minimum among classified losses. Earliest closed trade wins ties. Missing side is unavailable, not zero. Detail links open the actual trade.

Native application Recharts line charts use a single product blue and a dashed neutral selected-period reference. Win rate uses 0–100%; net P&L includes zero. Signed P&L labels retain existing journal green/red semantics. Both plots have exact-value, keyboard-accessible table equivalents. No new rendering dependency.

Sparse fallback: under 20 trades shows progress toward a full window; 20–26 trades shows the latest full-window values without an underpowered line chart. At least 8 complete windows (27 trades) enables lines. Empty results have no fabricated values. Mixed currencies retain win rate but hide monetary comparisons without FX conversion. Monetary values honor privacy mode.

The report and chart code are lazy-loaded. Shared chart entrance behavior respects reduced motion. Responsive cards stack on small viewports; exact-value rows scroll within their own container. Loading and request failure/retry states use existing application primitives.
