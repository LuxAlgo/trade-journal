# Importers

Every importer produces normalized **executions** (fills). Trade-level exports are
reconstructed as one entry + one exit execution at the reported average prices. P&L is
preserved exactly; fill-level granularity is not (the warning says so on import).

Nothing is guessed silently: a file that doesn't match a known signature goes to the
column mapper, where the user maps their own headers.

## Formats and validation status

Parsers are **alias-driven**: every column is matched through a list of header aliases,
so fixing a drifted header is a one-line change.

Two validation tiers:

- **Cross-checked**: header set verified against _field sources_, meaning code that
  parses real user exports in the wild (TradeNote's community broker parsers¹, a
  real-user TradeZella converter², platform export docs), with fixtures in
  `packages/importers/tests` shaped from those sources.
- **Real file**: verified against an actual export file from a live account
  (the most valuable contribution this repo can receive).

| Format                             | Kind                         | Detection                             | Cross-checked | Real file |
| ---------------------------------- | ---------------------------- | ------------------------------------- | ------------- | --------- |
| TradeZella                         | trades → reconstructed fills | header signature + P&L reconciliation | ✅ (partial²) | ☐         |
| Tradervue                          | fills                        | header signature                      | ✅ (docs³)    | ☐         |
| TradingView (paper history)        | fills                        | `Fill Price` header                   | ✅ (docs)     | ☐         |
| MetaTrader 4 (HTML statement)      | trades → reconstructed fills | HTML + MetaTrader markers             | ☐             | ☐         |
| Interactive Brokers (activity CSV) | fills                        | `Trades,Header` section rows          | ☐             | ☐         |
| Interactive Brokers (Flex Query)   | fills                        | `ClientAccountID`/`Date/Time` headers | ✅¹           | ☐         |
| ThinkorSwim / Schwab (statement)   | fills                        | `Account Trade History` section       | ✅¹           | ☐         |
| NinjaTrader                        | fills                        | `Instrument`/`Action` headers         | ✅¹           | ☐         |
| Tradovate                          | fills (Filled only)          | `Contract`/`B/S`/`Fill Time` headers  | ✅¹           | ☐         |
| TopstepX                           | fills (Filled only)          | `ContractName`/`ExecutePrice` headers | ✅¹           | ☐         |
| Webull (orders, both variants)     | fills (Filled only)          | `Status`/`Filled` headers             | ✅ (docs)     | ☐         |
| DAS Trader Pro                     | fills                        | `Symb`/`B/S` headers                  | ☐             | ☐         |
| MetaTrader 5 (deals report)        | fills                        | HTML/CSV deal table signature         | ☐ (fixtures)  | ☐         |
| TradingView (strategy list)        | trades → reconstructed fills | `List of trades` headers              | ☐ (fixtures)  | ☐         |
| Generic (column mapper)            | fills                        | user-mapped                           | n/a           | n/a       |

¹ [TradeNote community broker parsers](https://github.com/Eleven-Trading/TradeNote/blob/main/src/utils/brokers.js):
real-user headers for Tradovate (`Fill Time`, `B/S`, `Filled Qty`, `Avg Fill Price`,
`Status=Filled`), TopstepX (`FilledAt`, `Side=Bid/Ask`, `PositionDisposition`,
`ExecutePrice`, `Size`), NinjaTrader (`Instrument`, `Action`, `E/X`, `$`-prefixed
`Commission`), IBKR Flex (`Date/Time` as `YYYYMMDD;HHmmss`, `Buy/Sell`, negative
`Commission`), ThinkorSwim section boundaries.
² [TradeZella_STB converter](https://github.com/drasticstatic/TradeZella_STB):
confirms `Open Date`, `Status` (win/loss), `Net P&L`, `trades_*.csv` filename, and
custom journal columns; TradeZella's own docs confirm timezone abbreviations may ride
in time fields (stripped by our date parser).
³ Tradervue's published generic format: `Date, Time, Symbol, Quantity, Price, Side` +
`Commission`/`TransFee`/`ECNFee`; TradingView's export docs: `Symbol, Side, Qty,
Fill Price, Closing Time` (+ optional `Type`, `Status`, `Commission`).

Known variants NOT yet handled (send a sample!): MetaTrader 5 xlsx "Trade History
Report" (the MT4-style `.htm` statement works), TradeZella exports with custom column
selections beyond the defaults.

## Sharp edges the parsers handle

- Quoted fields, embedded commas/newlines, BOM, `;`/tab delimiters (RFC 4180 parser,
  zero dependencies)
- `$1,234.56`, `(45.20)` negatives, European `1.234,56` decimals
- Naive timestamps interpreted in the **statement's timezone** (DST-safe two-pass
  conversion), explicit offsets honored as-is
- TradeZella P&L reconciliation: when stated net P&L differs from price-implied gross
  minus commissions, the difference is folded into fees so imported history agrees with
  the trader's old numbers to the cent (skipped when a contract multiplier makes the
  price-implied gross meaningless)
- Content-hash dedup on insert: re-importing the same file with the same timezone is a no-op

## Statement and display timezones

In **Settings → Journal**, set **Display timezone** to the zone you want for trade
times, analytics, calendars and journal days. Set **Default import timezone** to
the zone used by your broker's statement. On **Import → File upload**, you can
override the **Statement timezone** for an individual file without changing either
saved setting. The preview shows the first five executions in your display zone;
check these before importing. Changing the statement timezone requires a new preview.

All three timezone fields use a searchable picker. Search by city or timezone,
then select a result. The list includes the runtime's primary timezone names and
UTC. Existing aliases remain available; if a valid full timezone name is absent
from the main list, searching its exact name offers it as a selectable result.
Search text is not saved until you select a valid option.

For example, use `Europe/Helsinki` for a Helsinki-based MT5 statement and
`America/Asuncion` for your journal. The synthetic
[`mt5-timezone.html`](samples/mt5-timezone.html) has an entry at July 5, 2026, 04:00
and an exit at 04:30 in Helsinki. These are stored as 01:00 and 01:30 UTC and appear
as **July 4, 22:00 and 22:30** in Asunción, including in the trade list and journal.
Timestamps with an explicit offset or `Z` retain that instant regardless of the
statement timezone. Manual entry continues to use the device timezone.

Existing installations initially use their previous timezone as the import
default. Saving a display-only timezone change preserves that previous import
default. Neither setting rewrites stored executions.

### Correcting an earlier import

Changing the import timezone does not repair existing timestamps. Re-importing
with a different timezone creates different execution hashes and can add duplicate
trades. Before correcting data:

1. Make a full copy of the data directory with the app stopped, as described in
   [Export and backup](../README.md#export-and-backup), and retain the original statement.
2. Import into a separate test account with the correct statement timezone first.
   Verify the preview, execution times and journal day against the original report.
3. In the affected account, select and delete only the trades from the incorrect
   import, then import the original statement with the verified timezone. Trade
   deletion removes its executions and annotations; preserve notes, tags and linked
   material separately before deleting. For mixed or overlapping imports, reconcile
   which executions belong to the affected trades before deleting them.

There is no automatic bulk time shift: files can use different zones, explicit
offsets, and daylight-saving rules. A fixed hour adjustment is not reliable.

## Sample file

[`docs/samples/demo-trades-tradingview.csv`](samples/demo-trades-tradingview.csv) is a
synthetic TradingView paper-trading export: 13 symbols, about 2,000 fills, March 2025
through September 2026. Drop it on **Import → File upload** to try the importer end to
end. It is generated data, not a real account.

## Adding a format

1. Add a spec to `packages/importers/src/formats/`; most CSVs are a declarative
   `makeFillsFormat({...})` with header aliases.
2. Register it in `src/detect.ts` (content-signature formats before header-signature
   ones).
3. Add a fixture test in `tests/importers.test.ts` with a real (anonymized) export.
