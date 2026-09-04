# Trade explorer

Reports → Trade explorer: how do individual closed-trade outcomes vary with holding time or entry time? Existing grouped reports conceal individual dispersion; this view exposes it without asserting causality or an optimal holding time.

Native Recharts scatter in the existing application, lazy-loaded. One observation per filtered closed round trip, no aggregates or interpolation. Default x = elapsed minutes from first entry to final close; alternate x = opening clock minute in the journal timezone. Default y = net P&L after recorded fees; alternate y = realized R from the core risk calculation (net P&L / stop-based planned risk, with required derivative multipliers). Entry time is circular: midnight neighbors are at opposite ends. No regression is inferred.

Data: existing account/date/annotation filters via queryTrades. Invalid timestamps/duration, nonfinite outcomes and missing/invalid risk are excluded only when required by the selected axes. Report plotted and excluded counts. No outside-selection history is fetched to inflate a sparse sample. Fewer than 8 comparable trades uses the exact-values table instead of an underpowered scatter; 8–19 points has a small-sample notice.

Linear axes include zero; time-of-day axis spans 00:00–24:00. All points are constant-size circles, as requested. Positive net P&L = green, negative = red, zero = neutral. Position relative to zero, signed tooltip values and the exact-value table provide non-color cues. Classification here is the numerical P&L sign, explicitly distinct from configurable breakeven outcomes. Quiet grid, bounded tooltip, matching light/dark tokens, reduced-motion-aware shared chart frame. No synthetic market prices.

Reports content stays immediately visible: cards, text, tables, controls, axes and grids do not animate. Only plotted lines reveal and scatter circles fade in over 850ms when mounted. Overview retains its existing graph animation. No transforms, delays or interaction locks. All graph entrances are disabled with reduced motion.

Interactions: click/tap a point to inspect it, then follow its existing trade detail link. Paginated semantic table gives all plotted trades and direct keyboard-accessible links, including coincident points. Axis controls are labeled native app selects. Mixed currencies block currency-denominated plots and amounts; unitless R can still be inspected. Privacy mode masks monetary values in axes, tooltips, selected-trade panels and tables.

QA: calculation/axis eligibility and timezone unit tests; API reconciled against filtered trade list; inspect both themes and mobile widths; exercise selection, axes, sparse/empty/error/retry states, privacy and reduced motion. Existing Reports tabs remain unchanged.
