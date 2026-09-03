# Changes from the original journal

Baseline: LuxAlgo Trade Journal commit `eb39e76592ed6b4008040238d76bd98bd6ad8469`.

## Dashboard and navigation

- Retains all 16 original dashboard cards and their analytics: net P&L, trade win rate, profit factor, day win rate, average win/loss, Edge Score, cumulative P&L, daily P&L, calendar, activity, drawdown, streaks, expectancy, holding time, best/worst day and time-of-day performance.
- Cards can be dragged and rearranged, moved with the keyboard, hidden and restored. The complete card follows the pointer and swings from the grab point; neighboring cards move into place. Adding/removing a card animates its size and the surrounding grid.
- Animated Customize panel with search, visibility switches, Show all and Reset layout. Matching Layouts panel saves and loads named arrangements. Layouts persist in the browser and synchronize across tabs.
- Account selector restored to the main filter bar, including All accounts, individual accounts and a demo-data option. Demo data uses its own account; repeated loading reuses it. Advanced filters continue to support multiple accounts.
- Cumulative P&L changes to red below zero, including the line, fill and hover point. Financial axes remain legible.
- Page transitions fade between screens. Active navigation retains its selected background without the colored side strip. Reduced-motion preferences are respected.
- Responsive dashboard grids, mobile navigation drawer, persistent mobile header, compact calendars, wrapping forms, bounded dialogs and scrolling tables. Notebook adapts between mobile, tablet and desktop layouts while preserving edits.

## Privacy

- Privacy mode is available throughout the journal, including the mobile header.
- Masks balances, P&L, monetary metrics, prices and monetary input fields. Counts, percentages, ratios and dates remain visible; charts retain their shapes and masked axes.
- Trade charts show recorded prices relative to average entry in privacy mode. Financial review exports are disabled while hidden.
- Preference persists across navigation and reloads, synchronizes between tabs, and migrates the earlier dashboard preference. Manually written notes, attachments and full data backups retain their contents.

## Reports and trade review

- Advanced filters for accounts, date ranges, symbols and exclusions, tags, mistakes, playbooks, direction, status, asset class, review status, rating, quantity, prices, duration, P&L, realized/planned R, weekdays and entry/exit times. Filters follow navigation and CSV exports.
- Independent comparison groups for strategies, accounts, periods or trade characteristics, with editable names and filters.
- Cross-analysis matrix and detailed table across two dimensions.
- Additional breakdowns by asset class, month, entry/exit hour or 15-minute interval, position size, entry/exit price, planned/realized R and outcome.
- Original report Overview restored: time-of-day chart plus symbol, direction, weekday, holding-time, tag, mistake and playbook tables.
- Strategy rule assessments on individual trades, with adherence rate, assessment coverage and performance for followed/broken rules. Incomplete assessments remain distinguishable from fully followed checklists.
- Realized R accounts for configured contract multipliers and fees. Missing or invalid risk is omitted from averages; scaled positions use weighted entry and total entry quantity.
- Large trade lists render 50 rows at a time. Sorting, summary metrics, selection and CSV export still cover the full filtered result.

## Notes and planning

- Markdown formatting with rendered previews for existing notebook, trade and daily notes; empty notes open ready to write. Edit/Preview sits alongside Dictate and Delete in the notebook.
- Formatting toolbar, reusable templates, improved autosave and explicit Save now. Fixed spaced bold/italic formatting and rendering of notes affected by the earlier toolbar.
- In-app folder creation with validation and immediate selection.
- Exact trade-link picker with symbol, full opening timestamp and account name; saved links open the selected trade.
- PNG, JPEG, WebP and PDF attachments on trades, daily notes, notebook notes and missed opportunities, up to 8 MB each.
- Dictation exposes listening/errors and uses final phrases without overwriting recent edits. Keyboard dictation remains available when browser speech is unsupported.
- Progress tracker for routines before, during and after trading, weekday schedules, daily completion and 13-week history; archival preserves history.
- Missed-opportunity log with symbol, direction, observation time, strategy, planned levels, notes, attachments, archive and restore. These observations do not enter actual trading metrics.
- Configurable breakeven tolerance, fee defaults and stop/target defaults, scoped by account and symbol. Defaults preserve existing annotations and import deduplication.
- PDF and PNG review exports with preview before download, pagination for long reviews and an embedded Unicode font for supported PDF characters.
- Full JSON export extended with folders, timezone, contract multipliers, templates, attachments, rule assessments, routines, missed opportunities and defaults. Credentials remain excluded; copying the data directory remains the complete local backup/restore route.

## Reliability and speed

- Dashboard aggregation reuses daily totals and equity; breakdowns compute only their required statistics. Adherence uses indexed lookups instead of repeated scans.
- Database account filters narrow the rows before parsing; date-order indexes speed lookups. Trade-link search stops after enough matches. The trade list requests smaller records without note bodies or execution details.
- ECharts imports only the chart types/components in use and loads as its panel approaches the viewport. Resize work is limited to one update per frame. Number formatters are reused.
- Concurrent matching reads share one request; abandoned reads are canceled. Changing filters cannot display another account's stale response, and completed financial responses are not kept in a global cache.
- Optional password protection now validates signed sessions on API requests. JSON responses explicitly avoid shared caching. Dependency updates clear the findings in the reviewed lockfile audit.
- Execution writes validate input and account references before insertion. Fills and their calculated trades commit together; failed calculations roll back. Rebuild cleanup avoids SQLite's large-parameter limit.
- Production Docker image includes fonts and license notices. Node 22+ is documented to match the installed dependencies. Local databases, backups and working audit notes remain outside Git and packaged builds.

See [review and performance results](review-and-performance.md) for measured timings and verification.

## Boundaries

- Automatic MAE/MFE, market replay and backtesting were not added: reliable calculations need suitable market data covering each trade's lifetime.
- Broker sync, market candles and AI features retain their existing integrations. Live broker credentials, paid AI calls and microphone transcription were not exercised in this review.
- Browser dictation depends on browser/system support. PDF exports report unsupported characters and offer PNG as an alternative.
- Monetary comparison reports require one currency; no exchange-rate conversion is inferred. R measures planned entry risk, not the maximum simultaneous exposure of a scaled position.
- No subscription was introduced. Existing optional external broker, market-data or AI services retain their own access requirements.
