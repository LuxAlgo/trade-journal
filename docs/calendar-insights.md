# Calendar performance insights

Source: `GET /api/calendar` uses the existing `queryTrades` predicate, `dailyStats`,
and `calendarMonthFromDays`. No generated or demonstration values are added.
The Calendar UI continues to show the full month; analytics use the intersection
of that month and the global date range, accounts, and remaining filters. The
server's journal timezone determines closing dates and the initial visible month.

## Definitions

- Net P&L: sum of completed round trips after fees. Open positions are excluded.
- Average daily P&L: net total / days with closed trades, including zero-net days.
- Trade win rate: winning trades / all closed trades, including configured break-even trades.
- Best/worst day: maximum/minimum daily net P&L. Ties select the earliest date;
  one-day selections have the same best and worst day. Best need not be positive.
- Green/red day averages: mean strictly positive/negative daily totals respectively.
  An absent group is unavailable, not zero.
- Day consistency: positive-net days / all trading days. This is a descriptive
  profitable-day rate, not the dashboard's Edge Score or a predictive measure.
- Most profitable weekday: largest strictly positive total by **closing** weekday.
  Zero-trade weekdays never win. No positive totals means no profitable weekday.

## Chart map and interaction

| View                | Question and encoding                                                                                                  | Sufficiency and interaction                                                                                                                                                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily performance   | How do daily results vary? Zero-anchored signed bars, after-fee P&L by closing date.                                   | At least two trading days; one day gets an explicit summary. A dashed five-trading-day rolling mean appears only with at least eight observed trading days; no pre-window values or invented days. Bar selection opens matching trades; a semantic table supplies equivalent keyboard links and exact values. |
| Weekday performance | Which closing weekdays contribute net gains/losses? Diverging bars on a shared symmetric zero scale and signed values. | All seven weekday positions, no-data rows disabled. Each weekday expands its actual closing dates; date links open matching trades. Small samples are explicitly flagged rather than extending beyond the selected scope.                                                                                     |

Existing product P&L green/red is the intentional domain exception to a neutral
palette. Signs, zero lines, direct labels, and position also encode polarity.
Use shared theme, tooltip, card, privacy, chart-frame, and reduced-motion behavior.

Drill-downs preserve filters and fix `range=custom`, `from`, and `to` to the
visible scope or chosen closing day. Existing `weekdays` means entry weekday, so
it is never replaced with a closing-weekday value. No new global filter semantics.

Monetary results are shown only for a single account currency. Mixed-currency
selections retain trade counts/rates but hide combined monetary results, green-day
counts, and heatmap magnitudes, with an explanatory prompt; no FX rate is assumed.

## QA

Pure tests cover reconciliation, fee inclusion, averages/denominators, flat and
one-sided data, ties, empty views, rolling windows, leap months, filter intersections,
timezone boundaries, open positions, account isolation, and drill-down preservation.
Browser checks should cover month navigation, filtering, inspection links, privacy,
loading/failure/empty states, both themes, mobile widths, and reduced motion.
