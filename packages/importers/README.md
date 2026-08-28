# @luxalgo/journal-importers

Statement and export parsers for [Trade Journal](https://github.com/LuxAlgo/trade-journal), LuxAlgo's open-source trade journal. Zero runtime dependencies beyond `@luxalgo/journal-core`. Runs in Node and the browser.

```bash
npm install @luxalgo/journal-importers
```

## What it does

Turns broker and journal exports into normalized executions, ready for `buildRoundTrips`.

```ts
import { parseAuto, parseWithMapping, readHeaders, FORMATS } from "@luxalgo/journal-importers";

const parsed = parseAuto(fileText, { timeZone: "America/New_York" });
// -> { format, executions, warnings, skippedRows } or null when unrecognized
```

- Auto-detects 12 formats: TradeZella and Tradervue (one-click migration), TradingView, MetaTrader 4 statements, ThinkorSwim / Schwab, Interactive Brokers (activity CSV + Flex Query), NinjaTrader, Tradovate, TopstepX, Webull, DAS Trader.
- `parseWithMapping` handles any other CSV through a user-defined column mapping; nothing is guessed silently.
- Handles quoted fields, BOM, `;` and tab delimiters, `$1,234.56` and `(45.20)` numbers, European decimals, timezone suffixes, and DST-safe naive-timestamp conversion.
- TradeZella imports reconcile stated net P&L to the cent, so migrated history matches the trader's old numbers.

Per-format validation status lives in [docs/importers.md](https://github.com/LuxAlgo/trade-journal/blob/main/docs/importers.md). Real export samples are the most valuable contribution. MIT.
