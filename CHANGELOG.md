# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Drawing templates, as in TradingView: save a tool's look (colours, line styles, text, Fibonacci levels and ratios, Elliott wave degree) under a name, apply it to selected drawings, and star one as the default for new drawings; built-in Fibonacci and Elliott templates included
- Elliott wave degrees (Grand supercycle to Subminuette) that relabel a wave count in its notation, such as ①②③, (1)(2)(3) or (i)(ii)(iii)
- Chart layers: drawings can sit inside other drawings (an Elliott wave holds its sub-waves), numbered like an outline, with draw inside, focus on a wave, hide what is inside, go to a wave, and duplicate or delete a whole tree
- Chart sidebar cards (and the journal records and economic calendar blocks) fold to their title bar, with a short summary, remembered per browser
- 32 more built-in indicators: WMA, Hull, VWMA, ALMA, SMA 50/200, Parabolic SAR, Ichimoku, linear regression, Aroon, Keltner, Bollinger bandwidth, standard deviation, historical volatility, Chandelier exit, Stochastic RSI, CCI, Williams %R, momentum, ROC, TSI, CMO, Awesome oscillator, volume with average, MFI, Chaikin money flow, accumulation/distribution, PVT, and signal scripts for golden/death crosses, MACD crosses, Bollinger breakouts, Supertrend flips and swing points
- Chart multiview (optional): two to four full charts at once, each with its own symbol, candle size and analysis (drawings, layers, indicators, zones, alerts, autosave, day versions), with synced crosshair and time window. The page controls follow the chart you click.
- Installable web app: install the journal from the browser (desktop, Android, iPhone) with its own window and icon
- Background alerts: the server keeps watching an analysis's lines and zones with no page open and sends Web Push notifications to your browsers or installed app, or to a webhook such as ntfy
- Chart appearance: chart type, colours, grid, crosshair, text, price scale mode, decimals per symbol and time axis zone; ready-made and saved looks; a look per symbol; symbol display names, colour tags and a watchlist; starting styles per drawing tool (remembered from the last used), custom ink colours; defaults for candle size, live, volume, magnet and stay-in-drawing mode; all saved on the server
- Layers panel, docked beside the chart (also in full screen) with a toolbar toggle: drag and drop for layers, folders and drawings, find and filter drawings, check several for bulk show, hide, lock, move, restyle, reorder, duplicate or delete, drawing names, per-drawing visibility and lock, layer colours, show only one layer or folder, duplicate a layer with its drawings
- Day versions of chart analyses: the analysis stays one live board, and each journal day you edit it keeps a frozen copy (drawings, zones, indicators, notes and picture) shown on that day's journal page, openable read-only over current candles and restorable as the live version; day notes and AI reviews use that day's version
- Real-time charts for Binance and Coinbase: the server relays each exchange's public trade feed over Server-Sent Events, so the forming candle moves with every trade; other sources keep polling
- Charts show your journal trades (fills, entry to exit with WIN/LOSS and P&L, open positions with stop and target; click to open the trade), with switches to hide all trades or only closed ones, and missed trades as violet diamonds logged straight from the chart
- Support and resistance zones on Charts: price ranges with a role that follows price, counted touches and breaks, role flip on a break, zone alerts, saved with the analysis
- Market session opens and closes (Sydney, Tokyo, London, Frankfurt, New York) and an opt-in economic calendar (ForexFactory weekly feed, stored locally, filtered by impact and currency) on the chart time axis
- Configurable timeframe bar with 3m, 30m, 2h, 4h and 1w candles (4h shown by default); sizes a source lacks are built from finer candles
- AI recaps and trade critiques include linked chart analyses, with their notes, drawings and zones as text and the snapshot as an image
- Chart indicators in Pine Script, run by PineTS in a Web Worker: 15 built-ins (moving averages, VWAP, Bollinger, Donchian, Supertrend, ATR, RSI, MACD, Stochastic, ADX, OBV and signal scripts), a Pine editor with errors and line numbers, a "My indicators" library, settings and visibility saved with each analysis, and indicator `alert()` messages in chart alerts. Adds AGPL-3.0 dependencies (`pinets`, `@luxalgo/vela-pinets`) with reviewed license-gate exceptions
- Charts: a live Vela chart for any symbol from your market-data source (latest candles on open, automatic updates, older history on scroll back), stylus drawing (pen, highlighter, hardware eraser, palm rejection), automatic saving per symbol, drawing layers grouped in folders, line-crossing alerts, and journal embeds that reopen the chart
- Customizable dashboard: drag cards to rearrange, hide and restore them, save named layouts; responsive layout with a mobile navigation drawer
- Privacy mode that masks monetary values across the app while keeping counts, ratios and chart shapes
- Markdown notes with formatting toolbar, reusable templates, exact trade links, and image/PDF attachments on trades, days and notebook notes
- Advanced report filters, comparison groups, a two-way cross-analysis matrix, and additional breakdowns (asset class, month, entry/exit hour, position size, planned/realized R)
- Playbook rule checklists per trade with adherence rates and followed-vs-broken performance
- Routines with weekday schedules and completion history; a missed-opportunity log kept out of trading metrics
- PDF and PNG review exports; JSON export now includes folders, templates, rule assessments, routines and defaults
- Configurable breakeven tolerance, default fees, and default stop/target distances per account and symbol
- Importers: MetaTrader 5 deal reports and TradingView strategy exports
- Realized R accounts for contract multipliers and scaled entries
- Optional historical market data connections (London Strategic Edge, Alpaca, OANDA, Binance, Coinbase, or your own candle CSV) with estimated MAE/MFE and candle replay on closed trades
- Prop firm tracker: evaluation and reset costs, refunds, payout requests, receipts, cash ROI, renewals, attachments, CSV import and export
- Calendar insights, rolling performance trends, and a trade explorer scatter in Reports
- Light mode, a collapsible sidebar, and friendlier AI setup and error notices

### Changed

- Vela upgraded to 0.7.7 (required by its Pine add-on)
- Data loads render as React transitions, so a tab change paints progressively instead of freezing while every card and chart mounts at once
- The development server runs on Turbopack, roughly halving first-visit compile times when switching tabs in `pnpm dev`
- Removed the gradient accent bar and gradient Edge Score number; the active nav item and the score now use the solid brand blue
- Trade pages chart recorded fills only and never contact a data provider on open; market candles load only from a data source you choose
- Gross profit and gross loss now include every closed trade, so trades labeled breakeven by a tolerance still count; the Edge Score version is bumped to 2
- Reports and dashboard aggregation reuse daily totals and equity for large histories; charts load only the components they use
- Executions are validated and written together with their recomputed trades in one transaction
- Node 22 or newer is required (already required by the AI dependencies)

### Fixed

- Pine scripts with very long expressions or condition chains no longer fail with "Maximum call stack size exceeded": a script too deep for the indicator worker runs on the page instead, and one too deep for both explains how to split it
- Chart pattern tools: the Elliott impulse is placed on six points (0-1-2-3-4-5, five waves) and the correction on four (0-A-B-C, three waves), instead of Vela's five and three points; the Shark harmonic is labelled 0-X-A-B-C. Wave drawings made with the old point count keep their points and labels
- Password protection now verifies the session signature on every API route. Previously, when `JOURNAL_PASSWORD` was set, any request carrying a cookie of the right name was accepted, so a forged cookie could read the journal.

## [0.1.0] - 2026-09-03

Initial public release.

### Added

- Round-trip engine: flat-to-flat position cycles from raw fills, FIFO/LIFO/weighted-average matching, partial fills, position flips, futures multipliers, rebuild-stable annotation keys (`@luxalgo/journal-core`)
- Analytics: P&L, win and day-win rates, profit factor, expectancy, R multiples, streaks, drawdown and recovery, profit concentration, calendar and bucket aggregations, the open Edge Score
- Statement importers with auto-detection for 12 formats, one-click TradeZella/Tradervue migration with exact P&L reconciliation, and a column mapper for anything else (`@luxalgo/journal-importers`)
- Web app: dashboard, P&L calendar, daily journal with voice dictation, trades table, trade pages with charting, notebook, playbooks, reports
- Broker sync via `@luxalgo/broker-sdk` with credentials encrypted at rest
- Optional AI reflection (bring your own Anthropic API key): session recaps, trade critiques, ask-your-journal
- Docker deployment, optional password auth, full JSON/CSV export
