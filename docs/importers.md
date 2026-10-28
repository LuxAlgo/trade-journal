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
| Interactive Brokers (Flex XML)     | fills                        | `FlexQueryResponse` root element      | ☐ (fixtures)  | ☐         |
| ThinkorSwim / Schwab (statement)   | fills                        | `Account Trade History` section       | ✅¹           | ☐         |
| NinjaTrader                        | fills                        | `Instrument`/`Action` headers         | ✅¹           | ✅ (#10)  |
| Tradovate                          | fills (Filled only)          | `Contract`/`B/S`/`Fill Time` headers  | ✅¹           | ☐         |
| TopstepX                           | fills (Filled only)          | `ContractName`/`ExecutePrice` headers | ✅¹           | ☐         |
| Webull (orders, both variants)     | fills (Filled only)          | `Status`/`Filled` headers             | ✅ (docs)     | ☐         |
| DAS Trader Pro                     | fills                        | `Symb`/`B/S` headers                  | ☐             | ☐         |
| MetaTrader 5 (deals report)        | fills                        | HTML/CSV deal table signature         | ☐ (fixtures)  | ☐         |
| TradingView (strategy list)        | trades → reconstructed fills | `List of trades` headers              | ☐ (fixtures)  | ☐         |
| XTB xStation (account `.xlsx`)     | closed trades + open lots    | Closed Positions header               | ☐ (fixtures)  | ✅ (#42)  |
| Hyperliquid (trade history)        | perpetual fills              | `coin`/`dir`/`px`/`closedPnl` headers | ☐             | ✅ (#53)  |
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

## CSVs with hedged long and short positions

The CSV column mapper and the declarative fills importers recognize **Open Long**, **Close Long**, **Open Short**, and **Close Short** in the side/action column. Keep these original labels: replacing them with Buy/Sell discards which position a fill belongs to. Long and short positions are matched separately within the selected journal account and symbol, including a source contract when supplied. Optional Position IDs separate independent positions on the same side. Original fills, open positions, partial closes, fees, and the account's FIFO/LIFO/weighted-average method are preserved.

In **Import → File upload**, map the action column to **Side** if the format is not detected. **Position identity and ordering (optional)** lets you map differently named Position ID, Execution ID and Sequence columns. The standard headers `Position ID`, `Execution ID`, `Fill ID`, and `Sequence` are recognized automatically. Use a fill's execution ID, not an order ID shared by several fills. Without Position IDs, same-side fills form the usual flat-to-flat cycle for that contract.

Closes are checked against the selected account's saved fills and the new file together, after duplicate removal. Missing opens, excessive closes, mixed labelled/unlabelled histories, conflicting identities, and uncertain ordering stop the entire import. Identical fills need distinct execution IDs; different-price fills at the same timestamp need a reliable sequence or more precise timestamps. Repeating or reordering the same valid export does not add executions. Keep the export's identity columns consistent between uploads.

If you previously imported the same contract after changing its actions to Buy/Sell, import the complete original history into a separate journal account and compare it before retiring the old one. The importer will not rewrite the old fills or silently combine the two representations. Export one source account at a time. Configure futures multipliers for the imported symbols in Settings; action labels do not establish a multiplier. AI parsing still does not support hedged position histories.

## XTB account workbooks

XTB xStation exports one `.xlsx` workbook per account, with Closed Positions,
Open Positions and Cash Operations sheets. Upload it on **Import → File upload**
with AI parsing off; the server reads the workbook directly.

- Each closed position becomes an entry fill and an exit fill at the reported
  prices. **Gross Profit** is kept as the trade's result, because XTB states it
  in the account currency and a conversion rate can make price × volume a
  different currency. When **Profit/Loss** is lower than Gross Profit, the
  difference is the fee.
- Each lot on Open Positions becomes an entry fill keyed by its XTB position id,
  so it shows as an open position. The symbol rollup row is skipped, and its
  category applies to the lots below it. Unrealized profit is not stored.
- Cash operations (deposits, transfers, conversions and the cash legs of stock
  trades) are counted and skipped; the positions already represent the trades.
- Times labelled UTC are stored as UTC; the statement timezone does not shift them.

**Closing a holding later.** Import a later workbook for the same XTB account
into the same journal account. A closed position whose id matches a stored open
lot reuses that lot's entry, so only the exit is added and the position closes.
Rounding differences in the open time (under a second) or price are tolerated.
If XTB reports a different size or side for that id, for example after a
partial close, the import is refused before any writes, because the journal
cannot tell which part was closed. Export one workbook whose date range covers
both the opening and the close, and import it into a new journal account.

Limits: `.xlsx` only (not legacy `.xls` or password-protected workbooks), up to
5 MB, one XTB account per workbook and per journal account. Prices stay in the
instrument currency, so for a position quoted in another currency the trade's
result is in the account currency but its entry notional is not.

## Hyperliquid trade history

Export the **Trade History** tab with **Export as CSV**. Each row is one fill, with
`time`, `coin`, `dir`, `px`, `sz`, `ntl`, `fee` and `closedPnl` columns.

- Hyperliquid perpetuals are one-way: each coin has one net position. **Open/Close
  Long/Short** and flips (**Long > Short**, **Short > Long**) are read as buys and
  sells, so the fills form the same trades as broker sync's. Annotations such as
  **(Price Improved)** are ignored. An unrecognized direction, or a perpetual fill
  without a readable time, coin, size or price, stops the import.
- HIP-3 markets are stored under their API names (`ANTH (io)` becomes `io:ANTH`), and
  symbol case is kept (`kPEPE`), so a coin has one symbol from file or sync.
- Times have no offset and are in the timezone of the browser the file was exported
  from. Set **Statement timezone** to that timezone and check the preview.
- Rows carry no fill ID. Identical fills are kept as separate executions, and the
  same or a later export imports once.
- Spot fills (**Buy**/**Sell**) are skipped and counted: the export does not say which
  token paid a spot fee. `ntl` and `closedPnl` are not imported; P&L is computed from
  the fills.

**Adding older history to a synced account.** Broker sync reads only Hyperliquid's
latest 2,000 fills. Import the export into the Hyperliquid sync account after it has
synced at least once. The export rounds times to the second, so its fills cannot be
matched exactly to synced fills: the import adds only fills older than the account's
first synced fill and leaves everything from then on to sync. If none of the file's
fills in the synced period match a synced fill, the statement timezone or the wallet
is wrong, and nothing is saved. A fill in the same second as the first synced fill,
but before it, cannot be told apart from synced fills and is left out.

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
in **Settings → Trading**, then review again. For the anonymized
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

In **Settings → General**, set **Display timezone** to the zone you want for trade
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

### IBKR broker sync and timezone recovery

**Import → Broker sync → Interactive Brokers** downloads Flex XML through the
Broker SDK. It uses **Default import timezone** for statement times without an
explicit offset; the connection form shows the effective setting. Confirm the
timezone of your Flex statement with IBKR. The instrument's exchange does not
determine this setting. An explicit `Z` or numeric offset in a timestamp takes
precedence. Display timezone still controls rendering and analytics only.

Date-only records retain the midnight fallback. Invalid timestamps, unsupported
suffixes and ambiguous or nonexistent local times at daylight-saving transitions
are skipped and counted in the sync warning. Check the source report for those
records before relying on the resulting totals.

### IBKR Flex XML file upload

**Import → File upload** also accepts a Flex Query XML statement (`.xml`). It is
read by the same Broker SDK parser as broker sync, and the **Statement timezone**
on the upload form applies to `dateTime` values without an explicit offset. The
default Flex date and time formats (`yyyyMMdd`, `HHmmss`, `;` separator) are
required; rows with other formats are skipped and counted in the preview warning.

- Only execution rows are imported. Order, closed-lot and other summary rows
  (`levelOfDetail` other than `EXECUTION`) are skipped so fills are not counted
  twice.
- Rows with a zero price, such as option expiries and assignments, are skipped
  and counted, as in broker sync.
- A file that contains more than one IBKR account is refused. Export one
  account per Flex Query, or import each statement into its own journal account.
- Uploading into an IBKR broker-sync account requires the statement timezone
  that account syncs with: the recorded sync timezone, or the **Default import
  timezone** if nothing has synced yet. Uploaded and synced copies of the same
  fill then deduplicate. An upload in another timezone is refused before any
  writes, because its fills would otherwise be stored twice.

The first sync that stores executions records its statement timezone internally.
Further syncs use the same timezone and existing deduplication. Accounts containing
older synced executions without this record, or with a different recorded timezone,
stop before changing executions, trades, notes or sync status. Transfers cannot
combine synced history with unknown or incompatible timezone provenance.

To recover affected history:

1. Stop the app and copy the **entire data directory**, including `journal.db`,
   encryption key and attachments, as described in [Export and backup](../README.md#export-and-backup).
   Keep that backup and the original Flex report.
2. Restart the app and select the verified statement timezone in
   **Settings → General → Default import timezone**.
3. Connect a **separate journal account** to IBKR with the same Flex query and a
   distinguishable name. Ensure the query covers the full history you want to recover.
4. Select each account separately in the account filter. Compare execution times,
   dates, execution and trade counts, fees, open positions and P&L against the report.
   For example, September 18, 2026 at `08:59:05` in New York should store as
   `12:59:05Z` and display as `14:59:05` in Rome.
5. Keep the original account, trades and notes for comparison. Sync the corrected
   account going forward, and select that account in reports:
   **archiving alone does not exclude the original trades from All accounts**.

Changing a setting does not repair existing data. Do not transfer the old history
into the recovered account. This update does not automatically rewrite timestamps
or migrate annotations. If a corrected account already has the right history,
restore its recorded default import timezone to resume syncing it.

### Correcting an earlier file import

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
