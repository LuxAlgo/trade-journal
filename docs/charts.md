# Charts and chart analyses

**Charts** is a live market chart for the symbol you are studying, drawn on
[Vela](https://www.npmjs.com/package/@luxalgo/vela). Pick a symbol and it shows the latest
candles and keeps updating. Draw with a stylus, mouse or finger; everything saves as you
go. Organise drawings in layers and folders, mark support and resistance zones, see your
own trades, missed trades, market sessions and economic releases on the chart, get alerts
when price crosses your lines or zones, and put the analysis in the daily journal with one
click.

## Use it

1. Configure a source under **Settings → Market data**: a provider connection, an enabled
   public crypto feed (Binance, Coinbase), or an uploaded candle CSV (see
   [market-data.md](market-data.md)).
2. Open **Charts**, choose the source, type the provider's exact symbol and press **Open**.
   The chart loads the latest 500 candles; there are no dates to enter. The page reopens
   the last symbol you watched, and recent symbols stay one tap away.
3. Switch candle size with the timeframe bar (**1m · 5m · 15m · 1h · 4h · 1d** by default).
   The sliders button next to it picks which sizes the bar shows, from 1m, 3m, 5m, 15m,
   30m, 1h, 2h, 4h, 1d and 1w; the choice is remembered in this browser. Scroll or drag
   back in time and older candles load automatically (up to 20,000).
4. Draw. The quick toolbar has pan/select, pen, highlighter, trend line, horizontal line,
   rectangle, arrow, text and eraser, plus ink color, stroke width, undo, redo, clear and
   full screen. Vela's side toolbar adds Fibonacci, channels, patterns, measuring and more.

From a journal day, **Chart analysis** opens Charts with that day chosen for **Add**. Every
note editor has a **Chart** menu that inserts a saved analysis at the cursor.

## Live updates

**Binance and Coinbase update in real time.** The journal server opens the exchange's public
WebSocket feed and relays it to the chart over Server-Sent Events
(`/api/market-data/stream`), so the browser still only talks to your journal. Every trade
moves the forming candle as it happens; Binance also sends its own candle every couple of
seconds, which keeps open, high, low, close and volume exact. The badge shows **Real time**.

- One upstream connection per instrument serves every open chart on it, and closes a few
  seconds after the last one leaves. A dropped connection reconnects with backoff (1 s up
  to 30 s) and the chart polls meanwhile, so nothing is missed.
- The chart redraws on every update; the price header and line and zone alerts follow at
  most twice a second.
- While streaming, polling runs once a minute and only settles finished candles.
- Pausing or hiding the tab closes the stream; resuming reopens it and fetches the gap.

**Other sources poll.** While the chart is open and the tab is visible, it polls the source
for the forming candle:
every 15 s on 1m, 20 s on 3m, 30 s on 5m, 1 min on 15m and 30m, 2 min on 1h and 2h, 3 min
on 4h, 5 min on 1d and 10 min on 1w. Each poll is a
request to your provider plan, so the pace follows the candle size (Vela's own default,
every 3 s, would be too costly on paid plans). **Pause** stops polling; hiding the tab
pauses it too, and returning fetches whatever was missed. A failed request is retried
briefly before an error shows. A candle CSV is read back from its own last candle, and a
chart opened while the market is closed widens its window until it finds the last sessions.

The header shows the last price and the change against the previous candle.

## Saving

There is no save button. The first drawing, title or note creates the analysis; after that,
changes save about a second after you stop, and again when you hide or leave the page. The
status in the **Analysis** card says **Saving…**, **Saved** with the time, or the error with
**Retry**.

- Each symbol reopens its most recent analysis, drawings and layers included. **New analysis**
  in the Analysis menu starts a fresh board on the same symbol; the menu lists them all.
- The PNG picture refreshes at most every 15 seconds while you work, and on leaving.
- **Add** saves the analysis as it is now as the chosen day's version (today by default) and
  puts that version in the day's note, once.

## Day versions

An analysis is one live board that keeps evolving, and **every journal day you edit it keeps
its own frozen copy**: drawings, layers, zones, indicators, title, notes, candle size, view
and picture, as they stood when you last saved that day.

- Today's version follows every save until midnight in the journal timezone (Settings), then
  it never changes again. A day you only look at the chart saves nothing.
- **Journal → a day → Chart analyses this day** lists that day's versions automatically, with
  **View this version**, **Live chart**, **Add to note** and remove (which leaves the live
  analysis and other days alone). The note editor's **Chart** menu in a day note inserts that
  day's version too; if the day has none yet, the analysis as it is now becomes it.
- **View this version** opens Charts at `?id=<id>&snapshot=<day>`: that day's drawings over
  today's candles, so you can see what price did next. It is read-only; nothing you change
  there is saved. **Make this the live version** copies it back over the live analysis (today's
  version records that; other days are kept).
- The **Versions by day** list in the Analysis card opens each day's version.
- Embeds added before day versions existed (`/api/analyses/<id>/image`) keep showing the live
  analysis.
- Deleting an analysis deletes its day versions.

## Multiview

Off by default: the page shows one chart. The layout button next to **Pause** (**Single
chart**) shows two, three or four charts, remembered per browser.

- **Every chart is a full chart.** Each has its own source, symbol, candle size and analysis:
  drawings (toolbar, stylus, layers), indicators and Pine scripts, support and resistance zones,
  missed trades, trades and sessions on the chart, appearance, autosave, day versions, **Add to
  journal**, in-page alerts and **Keep watching when this page is closed**.
- **The chart you work on** has a highlighted header ("Editing"). The top card (symbol, candle
  sizes, watchlist), the page title and live badge, and the sidebar (analysis, on the chart,
  zones, indicators, alerts, all analyses) belong to it. Clicking or tabbing into another chart
  makes that one the chart you work on.
- **One analysis, one chart.** An analysis open in one chart is never open in another, so two
  autosaves never overwrite each other. Choosing an analysis that another chart has open
  switches to that chart. A symbol opens its newest analysis that no other chart has, otherwise
  a new one (created on the first drawing, as usual).
- **What each chart shows is remembered.** A new extra chart starts on the first chart's symbol
  at its own candle size (4h, 15m and 1d by default); after that it keeps its own symbol, candle
  size and analysis, and reopens them next time. The first chart follows the URL as before.
- **Alerts run on every chart**, not only the one you work on. The Alerts switch is shared; a
  chart you are not working on shows a bell with the count of alerts it raised meanwhile.
- **Layout**: a grid with two per row, the first chart large with the others in a row below
  it, or one below the other. **Keep in step**: **Crosshair** (on by default) shows the moment
  under your cursor on every chart; **Time window** makes scrolling or zooming any chart show
  the same span on the others, loading older candles as needed.
- The **×** on an extra chart closes it (after saving); its settings wait for the next time you
  add a chart. In multiview the charts are shorter and the Layers panel starts hidden
  (remembered separately from the single chart's).

Code: `app/charts/page.tsx` (`ChartLab` holds what the charts share and the slots the chart you
work on renders into through portals; each chart is a `ChartBoard`), `lib/multiview.ts`
(settings and what each chart opens), `lib/chart-sync.ts` (crosshair and time sync),
`components/multiview.tsx` (menu, layout, chart header); the chart takes optional `sync` and
`size` props.

## Layers and folders

Folders hold layers, and layers hold drawings. The **Layers** panel is docked beside the chart
(below it on narrow screens) and stays there in full screen; the **Layers** button on the chart
toolbar shows or hides it, remembered per browser.

- The filled dot marks the **active layer**: new drawings go there. Choosing a hidden or
  locked layer shows and unlocks it (and its folder) so a new drawing is never invisible.
- The eye hides, and the lock freezes, a layer or a whole folder. A folder's switch overrides
  its layers. Hidden drawings stay hidden through undo and redo, are left out of the snapshot,
  and never raise alerts.
- **Drag and drop** with the grip on each row: a layer onto another layer puts it before that
  one (joining its folder), onto a folder puts it at the end of that folder, and onto the
  "out of its folder" strip takes it to the top level. Folders reorder by dropping one on
  another. A drawing dropped on a layer moves there; a checked drawing brings every checked
  one with it. Every drag has a menu equivalent.
- **Drawings** listed under a layer have a colour dot, a name (double-click to rename; the name
  also appears in alerts), their own eye and lock (greyed while the layer hides or locks them),
  and a menu: edit its style on the chart, bring to front, send to back, duplicate, move to a
  layer, delete.
- **Check** drawings (shift-click checks a range, "All" checks a layer) to act on them together:
  select them on the chart, scroll to them, show, hide, lock, unlock, front, back, duplicate,
  delete, move to a layer, and set their colour, width or line style.
- **Find drawings** by name or type, or filter by type; layers without a match fold away.
- The layer menu also has **Show only this layer**, check its drawings, a **layer colour** (and
  "colour its drawings with it"), and **duplicate the layer with its drawings**. Folders have
  **Show only this folder**. The toolbar shows every layer, unlocks every layer, or opens and
  closes them all.
- Double-click a layer or folder name to rename it. Deleting a folder keeps its layers.

## Appearance and defaults

**Appearance** on the chart toolbar opens the chart's settings, saved on the journal server
(`/api/chart-preferences`) so every browser shows the same.

- **Look**: chart type (candles, Heikin Ashi, OHLC bars, line, area, baseline), rising and
  falling colours, bodies, borders and wicks, line colour and width, background, text colour and
  size, grid, crosshair, price scale (regular, percent, indexed to 100, logarithmic, inverted),
  last price line and label, candle countdown and animations. Ready-made looks and your own
  saved looks apply with one click. **Every chart setting** opens Vela's full settings dialog;
  what you change there is saved to the same look.
- A look is stored as the difference from Vela's theme defaults: what you never changed keeps
  following light or dark mode, what you changed stays in both.
- **Own look for a symbol**: tick it and the look you edit applies to that symbol only, over the
  default look.
- **Symbol**: a display name (shown in the header, recent symbols and the watchlist), a colour
  tag, the watchlist star (also next to the symbol name), the candle size it opens with, and
  price decimals on the axis (automatic or 0 to 8).
- **Drawings**: each tool's starting colour, width, line style, fill and text. With **Remember
  the last style I use with each tool** on, changing a drawing's style in its own popup makes
  that the tool's new start (bulk changes from the layers panel do not). The pen and
  highlighter always use the toolbar ink; the **+** after the ink colours adds your own
  (right-click one to remove it).
- **Defaults**: the candle size and live or paused state charts open with, volume, the time
  axis zone (the journal timezone by default, instead of UTC), the magnet and whether a tool
  stays armed after drawing. Changing the magnet, stay mode or favourite tools on Vela's own
  toolbar saves them too.

### Candle sizes a source does not offer

Sizes a source does not serve are built on the server from a finer size it does: 3m from
1m, 30m from 15m, 2h and 4h from 1h, and 1w from 1d. Buckets are aligned to UTC (weeks start
Monday 00:00 UTC) and the first bucket is requested from its open so it is complete. Binance
serves 3m, 30m, 2h and 4h natively. The chart notes when candles were built this way.

## Line alerts

With **Line alerts** on, the page watches live closes and alerts when price crosses a visible
horizontal line, horizontal ray, ray, extended line or trend line (trend lines are priced
along their slope, within their span), and when price enters or breaks a support/resistance
zone. Alerts appear in the card and, if you allow it, as browser notifications. Each line or
zone alerts at most once a minute per kind. Alerts only run while the page is open; there
is no background service.

With **Keep watching when this page is closed**, the server takes over these line and zone
alerts and notifies your browsers, the installed app or a webhook; see [alerts.md](alerts.md).

## Your trades on the chart

The **On the chart** card controls what the chart draws from your journal. Every switch
only hides; nothing is deleted. The same groups appear in Vela's own settings, under Events.

- **My trades**: journal trades on the chart's instrument. Fills are triangles at their time
  and price (up for buys, down for sells); a closed trade has a dashed line from average
  entry to average exit labeled WIN, LOSS or BE with its net P&L (just the word in privacy
  mode). Open positions show a dotted line from the entry and their planned stop and target.
  **Closed trades** off keeps only open positions. Click a marker, or its event on the time
  axis, to open the trade.
- **Missed trades**: violet diamonds at the observed time and entry, with dotted stop and
  target lines, so they never look like real fills. **Missed trade** on the chart toolbar
  logs one: click where you saw the setup, then fill in direction, prices, playbook and why
  you passed. It is saved to Missed trades, outside your trading metrics. Archived ones are
  not drawn.
- **Symbols**: chart and journal symbols are compared without exchange prefixes and
  separators, and USDT, USDC and BUSD count as USD, so `BTCUSDT` finds `BTC/USD` trades.
  **Also show journal symbols** adds others by hand for this chart (e.g. `MESZ6` on an ES
  chart). Up to 1,000 of the newest trades are drawn.

## Support and resistance zones

A zone is a price range, not a box. It starts where you drew it and extends to the present at
every candle size.

- **Zone** on the chart toolbar (or **Add zone** in the card): click the two edges. Esc
  cancels. Two clicks at one price still make a thin band.
- **Role follows price**: with price above the zone it is support, below it resistance. You
  can pin a zone to support or resistance instead.
- **Touches and breaks** are counted over the loaded candles since the zone started. A candle
  that enters the zone and closes back on the side it came from is a touch (a rejection). A
  close through to the far side is a break, and a broken zone flips role, as traders read
  them. A close inside the zone is shown as testing.
- The chart tints each zone by role, draws a dashed border once broken, and labels it with
  role, range, touches and status. The card lists the same, with label, role, visibility and
  delete per zone, and **Show** scrolls to where the zone starts.
- Zones save with the analysis (`zones_json`, at most 100) and are included in the snapshot
  and in AI reviews.

## Market sessions

On candle sizes up to 1h the time axis marks the opens and closes of Sydney (ASX), Tokyo
(TSE), London (LSE), Frankfurt (Xetra) and New York (NYSE) regular hours, computed in each
exchange's own time zone so daylight-saving changes land correctly. Weekdays only; exchange
holidays are not modelled (the economic calendar lists bank holidays). Each session can be
hidden separately in Vela's Events settings.

## Economic calendar

The calendar is off until you enable it in the **On the chart** card. It then reads the
public ForexFactory weekly feed (`nfs.faireconomy.media`), which lists this week's releases
with impact, forecast and previous values. The server fetches it at most once an hour while
a chart is open (or on **Refresh**) and stores the events locally, so history builds up from
the day you enable it; events older than three years are pruned. A failed fetch keeps the
stored events and shows the problem. **Disable** stops fetching and keeps what was stored.

- Filter by impact (High and bank holidays by default) and currency. The card lists the
  next three days.
- Events appear on the time axis; hover or click one for its title, impact, forecast and
  previous value.

## AI reviews with chart analyses

AI recaps and trade critiques also look at the chart analyses linked to what they review:

- **Daily recap**: analyses embedded in the day's note and the day's versions, so a past
  day is reviewed with the chart as it was that day, not as it is now.
  As with the shared note, a filtered recap leaves out the note's embeds; it still includes
  the day's analyses on the symbols of the filtered trades.
- **Trade critique**: analyses embedded in the trade's notes, then the versions of the
  trade's entry day on its symbol.

Each linked analysis (at most three) sends its title, symbol, candle size, visible range,
drawings, zones, indicators and notes as text, and its saved snapshot as an image, so the
model can check the trade against the plan drawn. The result names the charts it used.
**Include linked chart analyses** turns this off (remembered per browser); the API field
is `includeAnalyses: false`. Images go to your configured AI provider like the rest of the
context, and cost more tokens than text.

## Indicators

Indicators are Pine Script (v5/v6), run by [PineTS](https://github.com/LuxAlgo/PineTS) through
Vela's Pine add-on in a Web Worker, so heavy scripts never block drawing.

- **Add indicator** lists the built-ins by category: SMA, EMA, EMA ribbon, VWAP, Bollinger
  Bands, Donchian channel, Supertrend, ATR, RSI, MACD, Stochastic, ADX/DMI, OBV, and two signal
  scripts (EMA cross, RSI extremes) that mark the chart and raise alerts.
- **New** opens the editor under the chart with a starter script. **Run on chart** applies the
  code; if it fails, the error shows (with its line when the engine reports one) and the
  previous version stays on the chart. **Save to My indicators** keeps it for every chart.
  Ctrl/⌘ + Enter runs, Ctrl/⌘ + S saves, Tab indents.
- The code button opens any indicator on the chart in the editor, built-ins included; saving a
  built-in makes your own copy. Editing a saved script updates it here at once and on other
  charts when they are next opened. Charts using a deleted script keep running their copy.
- Inputs (`input.*()`), style and properties are edited in Vela's settings dialog: the gear in
  the panel or the chart legend. The eye hides an indicator without removing it.
- An analysis saves its indicators, their settings and visibility automatically, like drawings.
- With **Alerts** on, an indicator's `alert()` appears in the Alerts card and, if allowed, as a
  browser notification (at most once per message every 30 seconds). `plotshape()` marks
  signals on the chart.

Indicators are computed in the browser from the candles on the chart; nothing extra is
requested from the data source.

### License

PineTS and `@luxalgo/vela-pinets` are AGPL-3.0. They are bundled deliberately, with
reviewed exceptions in `scripts/check-licenses.mjs`: a deployment that includes them must
meet AGPL-3.0 terms, including offering the corresponding source to its network users. The
journal's own code stays MIT. Pine Script is a trademark of TradingView, Inc.; PineTS is an
independent runtime not affiliated with TradingView.

## Pattern tools

Vela's side toolbar **Patterns** group holds XABCD, ABCD, the harmonic patterns (Gartley,
Bat, Butterfly, Crab, Shark, Cypher, with ratio checks), head and shoulders, and Elliott waves.
A wave is the leg between two points, so the journal corrects two Vela 0.6 tools through
Vela's `registerDrawingType` hook (`components/vela-pattern-fixes.ts`):

- **Elliott impulse**: six points, 0-1-2-3-4-5, five waves (Vela placed five points, four waves).
- **Elliott correction**: four points, 0-A-B-C, three waves (Vela placed three points, two waves).
- **Shark**: labelled 0-X-A-B-C; its ratio checks were already right.

Wave drawings saved with the old count keep their points and labels (marked with a
`legacyVertices` prop); redraw them to get the full count. Vela ships one native indicator
(volume) and no scripting engine of its own; indicators come from the Pine engine above.

## Stylus behavior

With **Stylus draws, fingers pan** on (the default, remembered per browser):

- The pen tip draws when no tool is armed, using the last brush (pen or highlighter).
- The eraser end of pens that have one (Surface, Wacom and similar) erases the drawings it
  drags across, then restores the previous tool.
- Fingers keep panning and pinch-zooming. A mouse or finger after the pen puts the tool
  down, so the chart pans instead of drawing.
- A pen tap that draws nothing selects the drawing under it and opens its style settings.
  To drag drawings or their handles with the pen, turn the option off.
- Touches that start while the pen is down are ignored as palm contact, for their whole
  duration, so a resting palm never bends the stroke in progress.
- Swipes inside the chart never trigger browser back navigation.

Stroke width does not vary with pen pressure; Vela's freehand strokes have a fixed width.

## How it is stored

Chart preferences are one validated JSON document in the settings table
(`chartPreferences`), included in the JSON export.

`chart_analyses` keeps the source (provider, symbol, dataset), the candle size, the loaded
and visible ranges, the Vela drawings document, the layers document (`layers_json`, with
optional layer colours and drawing names), the
indicators (`indicators_json`), support/resistance zones (`zones_json`), notes, the optional
journal day and a PNG snapshot. Trades and missed trades are read live from the journal, not
copied into the analysis. `economic_events` holds the stored calendar.

- **Candles are never stored**, as elsewhere in the journal; reopening requests them again.
- **Drawings are anchored to time and price**, not pixels, so they survive another candle size.
- **Size limits** keep every save below the 10 MB request body Next buffers when middleware
  is present: snapshots up to 4 MB (large high-density exports are downscaled first) and
  drawings up to 3 MB. If a snapshot cannot be exported, the old one is cleared rather than
  left showing outdated drawings.
- **Day versions** live in `chart_analysis_snapshots`, one row per analysis and journal day
  (primary key `analysis_id, day`), with the same state columns and PNG. A save copies the
  state into today's row, and the picture only when the save carried a new one.
- **The journal embed is a standard Markdown image**. A day's version:
  `![Title · 2026-09-26 chart analysis](/api/analyses/<id>/snapshots/2026-09-26/image)`, which
  opens `/charts?id=<id>&snapshot=2026-09-26`; the live analysis:
  `![Title chart analysis](/api/analyses/<id>/image)`, which opens `/charts?id=<id>`. Both stay
  readable in exports and other Markdown tools. Deleting an analysis leaves the note text alone
  and shows a placeholder.
- JSON export includes analyses and their day versions (source, drawings, layers, notes)
  without pictures, as it does for attachment binaries. Back up the data directory to keep
  them.

## Code map

- `lib/live-market.ts`: the Vela data provider (history windows, polling, retries, merging
  streamed trades into the forming candle); `server/market-data/live.ts` and
  `app/api/market-data/stream`: the shared exchange feeds and their SSE relay.
- `lib/chart-layers.ts`: the folders/layers model and the visibility/lock rules.
- `lib/price-alerts.ts`: line pricing and crossing detection.
- `lib/chart-analysis.ts`: document validation, embed Markdown, drawing labels.
- `lib/stylus.ts`, `lib/recent-symbols.ts`: per-browser preferences.
- `server/chart-analyses.ts`: input validation, persistence, journal embedding.
- `app/api/analyses/**`: CRUD plus `/image`; `app/api/market-data/history`: candles by window
  or "latest N".
- `lib/indicator-library.ts`: the built-in Pine scripts; `lib/chart-indicators.ts`: saved
  indicator validation and source resolution.
- `components/chart-indicators-bridge.ts`: Vela indicators ↔ saved state;
  `components/indicators-panel.tsx`, `components/pine-editor.tsx`: the panel and editor.
- `server/chart-scripts.ts`, `app/api/chart-scripts/**`: My indicators.
- `components/analysis-chart.tsx`: the live Vela chart and quick toolbar;
  `components/chart-stylus.ts`: stylus routing; `components/layers-panel.tsx`: the layer tree.
- `lib/chart-timeframes.ts`, `components/timeframe-bar.tsx`: the timeframe bar;
  `server/market-data/aggregate.ts`: sizes built from finer candles.
- `lib/chart-overlays.ts`, `server/chart-overlays.ts`, `app/api/chart-overlays`: trades and
  missed trades for a chart; `lib/symbol-match.ts`: symbol matching.
- `components/chart-overlays.ts`: draws trades, missed trades and zones, the time-axis events
  and click handling; `components/overlays-panel.tsx`, `components/zones-panel.tsx`,
  `components/missed-trade-dialog.tsx`: the cards and dialog.
- `lib/sr-zones.ts`: zone validation, touches, breaks, role and alerts.
- `lib/market-sessions.ts`: session opens and closes.
- `lib/economic-calendar.ts`, `server/economic-calendar.ts`, `app/api/economic-events`: the
  calendar feed, storage and API.
- `server/ai-analyses.ts`: linked analyses for AI reviews.
- `server/analysis-snapshots.ts`, `app/api/analyses/[id]/snapshots/**`,
  `app/api/analysis-snapshots`: day versions; `components/day-analyses.tsx`: the journal card.
- `lib/chart-preferences.ts`, `server/chart-preferences.ts`, `app/api/chart-preferences`:
  looks, saved looks, symbol settings, tool styles and defaults;
  `components/chart-appearance.tsx`: the Appearance dialog.
- `app/charts/page.tsx`: symbol selection, autosave, alerts, journal and analysis lists.
