# Charts and chart analyses

**Charts** is a standalone market chart for the symbol you are studying, drawn on
[Vela](https://www.npmjs.com/package/@luxalgo/vela). Mark it up with a stylus, mouse or
finger, save the analysis, and embed it in the daily journal (or any note) as an image
that opens the chart for editing.

## Use it

1. Configure a source under **Settings → Market data**: a provider connection, an enabled
   public crypto feed, or an uploaded candle CSV (see [market-data.md](market-data.md)).
2. Open **Charts**, choose the source, the provider's exact symbol, a resolution and a UTC
   date range, then **Load chart**. That is the only moment a provider is contacted.
   A range is limited to 20,000 candles.
3. Draw. The quick toolbar has pan/select, pen, highlighter, trend line, horizontal line,
   rectangle, arrow, text and eraser, plus ink color, stroke width, undo, redo, clear and
   full screen. Vela's own side toolbar adds Fibonacci, channels, patterns, measuring and
   more. Tap a drawing to edit its style.
4. Give it a title, notes and a journal day, then **Save analysis**, or **Save & add to
   journal** to append the embed to that day's note.

From a journal day, **Chart analysis** opens Charts with that day preselected. Every note
editor has a **Chart** menu that inserts a saved analysis at the cursor.

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

Vela handles pen input natively (pointer events, `touch-action: none` on the chart). Stroke
width does not vary with pen pressure; Vela's freehand strokes have a fixed width.

## How it is stored

`chart_analyses` keeps the source (provider, symbol, dataset, resolution, loaded range,
visible range), the Vela drawings document, notes, the optional journal day and a PNG
snapshot from `chart.renderer.screenshot()`.

- **Size limits** keep every save below the 10 MB request body Next buffers when middleware
  is present: snapshots up to 4 MB (large high-density exports are downscaled first) and
  drawings up to 3 MB. If a snapshot cannot be exported, the old one is cleared rather than
  left showing outdated drawings.
- **Candles are never stored**, as elsewhere in the journal. Reopening an analysis shows its
  snapshot; **Load chart** requests the candles again. For CSV sources the resolved file is
  saved, so reopening does not become ambiguous when more files are uploaded.
- **Drawings are anchored to time and price**, not pixels, so they survive reloading at
  another range or resolution.
- **The journal embed is a standard Markdown image**:
  `![Title chart analysis](/api/analyses/<id>/image)`. It stays readable in exports and other
  Markdown tools. In the app it renders as a figure linking to `/charts?id=<id>`. Saving again
  replaces the snapshot, so every note that embeds it shows the update. Deleting an analysis
  leaves the note text alone and shows a placeholder.
- JSON export includes analyses (source, drawings, notes) without snapshot images, as it does
  for attachment binaries. Back up the data directory to keep snapshots.

## Code map

- `lib/chart-analysis.ts`: document validation, embed Markdown, UTC day ranges.
- `lib/stylus.ts`: palette, widths and the per-browser stylus preference.
- `server/chart-analyses.ts`: input validation, persistence, journal embedding.
- `app/api/analyses/**`: CRUD plus `/image`; `app/api/market-data/history`: symbol candles.
- `components/analysis-chart.tsx`: Vela chart, quick toolbar and stylus routing.
- `app/charts/page.tsx`: source controls, save flow and saved analyses.
- `components/rich-editor.tsx`: the **Chart** insert menu and the embed renderer.
