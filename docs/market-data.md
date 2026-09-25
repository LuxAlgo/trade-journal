# Historical market data

Market data is an optional, user-configured input. Vela remains the chart renderer;
broker sync remains responsible for executions. No provider is enabled or selected
by default. No API key or provider history is shipped with the project.

## Connect and use

1. Open **Settings → Market data** and choose a supported connection or upload a
   candle CSV. Configure or enable a connection only if you want to use it, then
   select **Test connection**. Environment credentials, when deliberately configured,
   take precedence over saved credentials.
2. Open a closed trade. Select a provider, its exact symbol, and candle resolution.
   Select a feed where required; an optional dataset can disambiguate instruments.
   Broker-specific symbols are not silently translated.
3. Select **Load market data**. This makes provider requests and uses your plan's
   allowance. Replay supports restart, play/pause, step, speed and scrubbing.
4. To enable monetary excursion estimates, first verify that the provider's
   instrument, price adjustment basis and quote currency match the executions and
   account currency. Derivatives also require a contract multiplier in Settings.

Before history is explicitly loaded, Vela displays a price path from recorded
fills for every asset class. Opening a trade never automatically contacts a market
data provider, including public crypto feeds.

## What MAE and MFE mean here

These are **estimated gross position-equity excursions** over a closed position
cycle, relative to zero at entry. At each observation, equity equals cumulative
signed execution cash flows plus the marked value of remaining exposure, multiplied
by the configured contract multiplier. This includes realized partial exits and
handles scaling without applying the eventual position size to earlier candles.
MAE is the magnitude of the most negative equity; MFE is the largest positive equity.
Fees and currency conversion are excluded. These estimates are calculated on demand
and do not change recorded executions, realized P&L or aggregate dashboard metrics.

Highs and lows are sampled only from complete candles during an unchanged position.
Candles crossing an entry, exit or partial fill are excluded; execution prices are
also sampled. Consequently estimates can understate actual excursions. The sequence
of high and low within a bar cannot be inferred. The UI reports exclusions and gaps,
which may represent closed sessions or missing data. It does not claim full tick coverage.

No number is returned for missing entry/exit coverage, truncated history, no usable
complete candles, missing required multipliers, unmatched position cycles, or an
unconfirmed price basis. Reversing executions spanning multiple cycles are currently
unsupported. Option contract history needs a separate adapter capability and is
explicitly unavailable; underlying prices cannot substitute for option premiums.
LSE stock/ETF candles are split adjusted, so unadjusted historical fills cannot be
compared directly without reconciliation. Fills more than 20% outside the matching
candle price range trigger a mismatch warning, with estimates and fill overlays
withheld. This catches conspicuous demo-data or price-basis mismatches; it is not
a substitute for verifying the instrument and currency yourself.

Replay reveals a completed candle at each step, with fills through its close time.
Unrevealed candles and future fill labels are not passed to Vela, and final excursion
amounts are hidden while replaying. Boundary candles may include prices outside the
holding period. This is trade-review playback, not tick simulation or a blind backtest;
the rest of the trade detail page still contains the original trade's outcome.

## Architecture and credential handling

- `lib/market-data.ts`: normalized UTC candles, resolution and result contracts.
- `server/market-data/provider.ts`: provider interface for history and access checks.
- `server/market-data/connections.ts`: adapter registry and encrypted key storage.
- `server/market-data/london-strategic-edge.ts`: LSE REST transport and normalization.
- `lib/excursions.ts`: deterministic provider-independent calculation.
- `lib/trade-replay.ts`: chart input sliced at the replay cursor.
- `components/trade-market-data.tsx`: source controls and Vela rendering.

Add another adapter to the registry to expose it through the same connection and
trade controls. Provider-specific authentication and normalization stay in the adapter.
The current generic interface covers candles and connection tests; symbol discovery,
tick replay, option contracts, and exchange-calendar coverage are future capabilities.

Saved keys use the journal's AES-256-GCM credential storage. Browser status responses
contain only configuration state. Requests go from the server to fixed provider origins
using provider-specific authentication headers; redirects are rejected and provider error bodies are never relayed.
The application's existing optional password gate also protects these endpoints.
Set `JOURNAL_PASSWORD` when serving the journal beyond your trusted local environment.
Keys and candles are excluded from journal exports; candles are not persisted or shared
through a global cache. Use provider data within the permissions of your own account.

The adapter reads `/vault/candles` and tests `/vault/usage`, following the official
[LSE SDK](https://github.com/londonstrategicedge/lse-data/blob/main/lse/client.py)
and [changelog](https://github.com/londonstrategicedge/lse-data/blob/main/CHANGELOG.md).
The live endpoint requires date-only `YYYY-MM-DD` ranges, despite the SDK examples
accepting ISO timestamps. The adapter requests whole UTC date windows, then filters
candles to the trade interval. Ascending and descending reads must overlap to establish
coverage when a plan caps rows below the requested 5,000. Requests are limited to
12 reads (six windows) / 20,000 retained bars and 90 seconds overall (60 seconds per
fetch). Non-overlapping pages or reaching these bounds produces a truncated result
with unavailable estimates; select a coarser resolution. No automatic retry spends
additional quota after a failure.

Adapter tests use synthetic fixtures. A live AAPL request was also verified with a
user-supplied key. Permissions and instrument coverage remain specific to each account.

## Reports and saved estimates

Confirmed, valid MAE/MFE estimates are saved locally when a trade's history loads.
Reports → Trade explorer offers MAE vs net P&L, MFE vs net P&L, and MAE vs MFE presets,
as well as excursion axis selectors. MAE is a positive adverse amount; dot colors
always describe final net P&L, not the sign of an excursion. Excursions are gross,
while net P&L includes fees. Different saved candle resolutions may be represented;
these remain observed-candle estimates with the trade page's coverage limits.

Calculate missing estimates uses the active account and report filters, recorded
symbols, and 1-minute candles. Confirm matching instruments, price basis and account
currency first. Requests run sequentially, can be stopped, and successful results
remain saved. No data is requested just by viewing Reports. A failed or unsupported
trade remains missing rather than becoming zero. Custom symbol mappings or datasets
can be loaded from the trade detail page. Monetary scatter axes require a single
account currency; no FX conversion is applied.

Saved results are excluded when the underlying executions, trade identity, account
currency or contract multiplier changes. Deleting a trade deletes its derived result.
Existing estimates calculated before persistence was added need to be loaded once
again. Unchecking the calculation box loads candles/replay only and does not erase
an earlier saved estimate. Replay starts at 4× speed.

## Supported sources

Configure these under **Settings → Market data**. Connections are used only for
market prices; they do not create broker-sync accounts, place orders, or change Vela.
Public sources require an explicit Enable source action. No source is contacted just
because Settings or Reports is opened. **Charts** is the exception by design: an open chart
requests its symbol's candles and polls for new ones while visible and not paused (see
[charts.md](charts.md#live-updates) for the pace).

| Source                | Setup                                                                                                   | Symbols and coverage                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alpaca                | Key ID and secret, or `ALPACA_API_KEY` + `ALPACA_SECRET_KEY`                                            | US stocks such as `AAPL`; choose IEX or SIP. Prices are raw/unadjusted. Choose Crypto for `BTC/USD`.                                                      |
| Binance               | Enable source; no key                                                                                   | Binance spot pairs such as `BTCUSDT`, through its public market-data host. No futures or automatic quote-currency conversion.                             |
| Coinbase              | Enable source; no key                                                                                   | Coinbase Exchange spot products such as `BTC-USD`. Empty intervals may have no candles.                                                                   |
| London Strategic Edge | API key in Settings, or `LSE_API_KEY`                                                                   | Historical candles for supported instruments and datasets; coverage depends on provider access.                                                           |
| Market data CSV       | Upload and preview local candle files                                                                   | Exact recorded symbol and resolution, with declared quote currency and price basis.                                                                       |
| OANDA                 | v20 token, account ID, and Practice/Live; or `OANDA_API_TOKEN`, `OANDA_ACCOUNT_ID`, `OANDA_ENVIRONMENT` | Instruments such as `EUR_USD`. Complete midpoint candles aligned to UTC; volume is price-update count. Multiplier must match the imported quantity units. |

Credential sets are encrypted together. Environment credentials take precedence;
partial environment configuration is shown as unavailable rather than mixing values
from the environment and saved settings. No saved field values are returned to the
browser. Test connection is an explicit, read-only market-data request.

Remote history is normalized to ascending UTC millisecond OHLCV. New network adapters
have bounded pages, a 20,000-candle result limit, timeouts and abort support. Alpaca
follows `next_page_token`; Coinbase, Binance and OANDA use windows below their candle
limits. Limits produce truncated history and unavailable estimates, not false zeroes.
Known quote-currency mismatches block monetary estimates even if the confirmation is
checked. In particular, USDT is not treated as USD. Candles can still be replayed.
API failures return sanitized errors rather than upstream bodies or credentials.

### Market-data CSV format

Download the generic header-only template from Settings. It contains no provider name,
instrument, credentials or sample data. Supply one instrument/resolution per file:

```csv
time,open,high,low,close,volume
```

`time` is the candle-open timestamp, either ISO-8601 with `Z` or a numeric offset,
10-digit Unix seconds, or 13-digit Unix milliseconds. Header aliases include
`timestamp`, `datetime`, `date`, and `o/h/l/c/v`. Comma, semicolon and tab delimiters
are supported. If a `symbol` or `ticker` column exists, every row must match the
instrument entered in Settings. Volume may be omitted and is then zero; prices are
never invented. A CSV without volume cannot support volume-based analytics.

Validation rejects malformed OHLC ranges, nonfinite values, negative volume,
unzoned/invalid times, duplicate timestamps, mixed symbols, incomplete/future bars,
and timestamps that do not align to the selected resolution. Intraday bars may use
a consistent offset; daily candles must open at 00:00 UTC. Gaps are preserved.
Limits are 5 MB, 50,000 rows/file, and 50 datasets. Validation/preview writes nothing;
Import market candles saves the immutable dataset locally. It is separate from trade
execution imports and excluded from full journal exports. Files must therefore be
retained separately for backup.

On a trade, select Market data CSV and the matching symbol/resolution. Automatic
selection chooses a unique file covering the trade, or the unique matching file if
coverage is partial. Ambiguous files require an explicit dataset selection. Reports
can use automatic file matching with the selected resolution. Removing a dataset
also removes its saved derived estimates, leaving all trade executions intact.

### API references checked for this implementation

- [Alpaca stock bars](https://docs.alpaca.markets/us/reference/stockbarsingle-1) and [crypto bars](https://docs.alpaca.markets/us/reference/cryptobars-1)
- [Binance market-data-only endpoints](https://developers.binance.com/en/docs/products/spot/faqs/market_data_only)
- [Coinbase Exchange candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles)
- [OANDA candle endpoints](https://developer.oanda.com/rest-live-v20/pricing-ep/) and [environments](https://developer.oanda.com/rest-live-v20/development-guide/)

## Performance and request limits

All remote adapters use the same server-side transport: at most six active GETs
per process, two per provider host, and 64 queued requests. New upstream calls
are spaced at least 350 ms apart per host; cache hits skip that delay. Identical concurrent
requests share one upstream call. Cancelling a view or report releases its share;
the upstream request is cancelled when no consumers remain. HTTP errors are not
cached, and 429 responses apply a credential-scoped cooldown using Retry-After
(or 30 seconds when it is absent). These are application limits, not a guarantee
that every provider plan permits the same request rate.

Completed historical request windows are cached in memory for up to five minutes;
recent data and metadata expire after 15 seconds. Cache identity includes the exact
URL, feed and a hash of the credential headers. Connection tests bypass the cache.
The cache holds at most 128 responses and 16 MiB of serialized payloads (decoded
objects add overhead), and is lost on restart. LSE's ascending and descending
coverage checks run concurrently and both remain required; trades sharing a date
window reuse those pages. Other adapters keep their existing pagination and
coverage checks. Provider outages, latency and plan quotas can still cause waits.

CSV imports validate once per import. Dataset bounds and counts are materialized
in SQLite, with an additive upgrade for existing files. History selects metadata
first, decodes only the chosen file, then uses binary search to slice the requested
range. At most 200,000 decoded candles are retained across immutable files. Removal
invalidates the local cached file and its saved estimates. Large first-time CSV
imports still perform bounded synchronous parsing (5 MB / 50,000 rows).

Report calculations request estimates and metadata without transferring candles,
and do not impose a one-second pause after every trade. They remain sequential
and cancellable, and stop after three consecutive unavailable results. Saved
estimate reads batch currencies and execution records while retaining fingerprint
invalidation. Replay reuses each computed frame, coalesces chart updates during
rapid scrubbing, and stops advancing while the page is hidden. Vela still renders
the charts, with 4× replay speed as the default.
