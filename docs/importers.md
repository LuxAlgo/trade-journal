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
| NinjaTrader                        | fills                        | `Instrument`/`Action` headers         | ✅¹           | ✅ (#10)  |
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

## NinjaTrader execution exports

Each source account gets a saved identity inside the selected journal account.
Copy-traded positions and full contracts stay separate, even when their fills are
identical or their displayed symbols share a root such as `ES`. Account/connection
labels become aliases for that identity. If a later export renames or omits them,
map it to its existing source in the preview; choose **Create a separate source
account** only for a different account. Saved aliases cannot be reassigned.

When available, include the **ID** column from NinjaTrader's
[Executions grid](https://ninjatrader.com/support/helpGuides/nt8/executions_tab.htm).
It identifies an execution; **Order ID** can be shared by several partial fills.
`Execution ID` is also recognized. Native IDs are scoped to the saved source.
Re-exporting an execution adds no fill. Changed commissions are shown as corrections
and require explicit approval. Changed price, quantity, direction, instrument,
timestamp, or ordering facts stop the import for separate reconciliation.

Without execution IDs, the importer preserves the count of identical fills.
Re-importing the same file, or changing its row order, adds no fills. A changed
overlapping export requires confirmation that it contains **all executions for
each source contract between its first and last timestamp**. It must retain every
previously imported fill in that interval; the importer never silently deletes
missing fills. Do not confirm completeness for a partial selection. An exact
repeated export and a new set of indistinguishable fills cannot be told apart
without more source information. Keep execution-ID columns consistent across
exports or recover the complete history in a new journal account.

CSV display order is not treated as execution chronology. Timestamp ties require
an unambiguous order from Entry/Exit facts or a reliable numeric `Sequence` /
`Execution Sequence` column. Execution IDs are not assumed to be sequential.
Ambiguous fills and exits with missing opening history stop the import. Invalid
rows and malformed commission values also stop it, rather than rebuilding
positions from an incomplete file. A blank commission uses configured default
fees (or zero); an explicit zero stays zero.

Configure a positive contract multiplier for each exact imported futures symbol
in **Settings → Journal**, then review again. For the anonymized
[issue #10](https://github.com/LuxAlgo/trade-journal/issues/10) fixture, `MNQZ6=2`
produces five closed trades, 26 executions, and $5,265 before fees. Setting only
`MNQ=2` does not apply to `MNQZ6`; the new import is blocked until its multiplier
is configured. The sample supplies no commissions, so default fees can change
net P&L. This fixture validates the full row counts and arithmetic; it does not
prove the completeness or execution sequence of every possible broker export.

The review shows new fills, duplicates, proposed fee corrections, source mappings,
contract multipliers, and the destination account's resulting closed-trade P&L
and open/closed trade counts. Saving recomputes this plan in one transaction. If
the file, review choices, account, journal, or relevant settings changed since
preview, review it again. A failure rolls back fills, corrections, mappings and
import history together. Source mappings and import history are included in the
full JSON data export. Keep the statement timezone consistent with prior imports;
a changed timezone requires recovery into a new journal account.

### Previously imported NinjaTrader files

The old importer could discard real executions and source-account identity.
Re-importing with new identities on top of those surviving fills would double-count
them. Matching legacy fills therefore block the new import before any writes.
Import the complete original export into a **new journal account**, compare totals,
and select that account when reviewing the recovered trades. The old account and
its annotations remain unchanged. Do not include both old and recovered accounts
in aggregate reports. There is no automatic transfer of annotations from an old
merged position to its separate source-account positions.

The regression fixture is the reporter's anonymized CSV in
`packages/importers/tests/fixtures/ninjatrader-copy-trades.csv`; the expected result
treats its identical rows as separate executions, as stated by the reporter.

## Timestamp parsing upgrades

IBKR activity timestamps such as `2026-01-05, 09:30:00` retain the time after the
comma. Offset-free ISO, US and named-month timestamps retain up to three fractional
second digits; unsupported precision, trailing garbage and invalid calendar/time
values are rejected instead of silently losing part of the value. Explicit UTC
offsets remain authoritative.

Earlier imports may have stored IBKR timestamps at local midnight or dropped
fractional seconds. Reimports that match those earlier representations are blocked
before any writes: recover the complete corrected history in a new account and
compare totals and reviews. The same guard conservatively stops indistinguishable
whole-second fills; it does not guess whether they are legacy rows or genuine new
executions. Manual entry and broker sync are not subject to this file-import guard.
Existing timestamps are not automatically rewritten.

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
