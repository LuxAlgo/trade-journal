# Charts and chart analyses

**Charts** is a live market chart for the symbol you are studying, drawn on
[Vela](https://www.npmjs.com/package/@luxalgo/vela). Pick a symbol and it shows the latest
candles and keeps updating. Draw with a stylus, mouse or finger; everything saves as you
go. Organise drawings in layers and folders, get alerts when price crosses your lines, and
put the analysis in the daily journal with one click.

## Use it

1. Configure a source under **Settings → Market data**: a provider connection, an enabled
   public crypto feed (Binance, Coinbase), or an uploaded candle CSV (see
   [market-data.md](market-data.md)).
2. Open **Charts**, choose the source, type the provider's exact symbol and press **Open**.
   The chart loads the latest 500 candles; there are no dates to enter. The page reopens
   the last symbol you watched, and recent symbols stay one tap away.
3. Switch candle size with the **1m · 5m · 15m · 1h · 1d** buttons. Scroll or drag back in
   time and older candles load automatically (up to 20,000).
4. Draw. The quick toolbar has pan/select, pen, highlighter, trend line, horizontal line,
   rectangle, arrow, text and eraser, plus ink color, stroke width, undo, redo, clear and
   full screen. Vela's side toolbar adds Fibonacci, channels, patterns, measuring and more.

From a journal day, **Chart analysis** opens Charts with that day chosen for **Add**. Every
note editor has a **Chart** menu that inserts a saved analysis at the cursor.

## Live updates

While the chart is open and the tab is visible, it polls the source for the forming candle:
every 15 s on 1m, 30 s on 5m, 1 min on 15m, 2 min on 1h and 5 min on 1d. Each poll is a
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
- The PNG snapshot the journal shows refreshes at most every 15 seconds while you work, and on
  leaving.
- **Add** puts the analysis in the chosen journal day's note (today by default), once.

## Layers and folders

Folders hold layers, and layers hold drawings.

- The filled dot marks the **active layer**: new drawings go there. Choosing a hidden or
  locked layer shows and unlocks it (and its folder) so a new drawing is never invisible.
- The eye hides, and the lock freezes, a layer or a whole folder. A folder's switch overrides
  its layers. Hidden drawings stay hidden through undo and redo, are left out of the snapshot,
  and never raise alerts.
- Expand a layer to list its drawings: select one on the chart, move it to another layer, or
  delete it. The layer menu renames, reorders, moves the layer into or out of a folder, shows
  its drawings on the chart (loading older history if needed) or deletes it; its drawings can
  move to another layer or go with it. Deleting a folder keeps its layers.
- Double-click a layer or folder name to rename it.

## Line alerts

With **Line alerts** on, the page watches live closes and alerts when price crosses a visible
horizontal line, horizontal ray, ray, extended line or trend line (trend lines are priced
along their slope, within their span). Alerts appear in the card and, if you allow it, as
browser notifications. Each line alerts at most once a minute. Alerts only run while the
page is open; there is no background service.

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

`chart_analyses` keeps the source (provider, symbol, dataset), the candle size, the loaded
and visible ranges, the Vela drawings document, the layers document (`layers_json`), notes,
the optional journal day and a PNG snapshot.

- **Candles are never stored**, as elsewhere in the journal; reopening requests them again.
- **Drawings are anchored to time and price**, not pixels, so they survive another candle size.
- **Size limits** keep every save below the 10 MB request body Next buffers when middleware
  is present: snapshots up to 4 MB (large high-density exports are downscaled first) and
  drawings up to 3 MB. If a snapshot cannot be exported, the old one is cleared rather than
  left showing outdated drawings.
- **The journal embed is a standard Markdown image**:
  `![Title chart analysis](/api/analyses/<id>/image)`. It stays readable in exports and other
  Markdown tools. In the app it renders as a figure linking to `/charts?id=<id>`. Deleting an
  analysis leaves the note text alone and shows a placeholder.
- JSON export includes analyses (source, drawings, layers, notes) without snapshot images, as
  it does for attachment binaries. Back up the data directory to keep snapshots.

## Code map

- `lib/live-market.ts`: the Vela data provider (history windows, polling, retries).
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
- `app/charts/page.tsx`: symbol selection, autosave, alerts, journal and analysis lists.
