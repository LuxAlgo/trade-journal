import { RESOLUTIONS, type Resolution } from "./market-data";

/** Vela's `SerializedDrawing` as stored: time+price anchors, never pixels. */
export interface StoredDrawing {
  id: string;
  type: string;
  paneId: string;
  anchors: { time: number; price: number }[];
  style: object;
  [key: string]: unknown;
}

export interface DrawingsDocument {
  version: 1;
  drawings: StoredDrawing[];
}

export interface ChartAnalysisSummary {
  id: string;
  title: string;
  symbol: string;
  provider: string;
  dataset: string | null;
  resolution: Resolution;
  rangeFrom: number;
  rangeTo: number;
  dayDate: string | null;
  drawingCount: number;
  hasImage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChartAnalysis extends ChartAnalysisSummary {
  visibleFrom: number | null;
  visibleTo: number | null;
  notes: string;
  drawings: DrawingsDocument;
}

export const EMPTY_DRAWINGS: DrawingsDocument = { version: 1, drawings: [] };
export const MAX_DRAWINGS = 1000;
/** A long stylus stroke samples thousands of points; bound it without clipping real use. */
export const MAX_ANCHORS_PER_DRAWING = 20_000;
/**
 * With middleware present, Next buffers at most 10 MB of a request body and truncates the
 * rest. A save carries both, the PNG as base64 (4/3 larger), so together they stay below it.
 */
export const MAX_DRAWINGS_BYTES = 3 * 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
export const MAX_ANALYSIS_BARS = 20_000;

export const VELA_TIMEFRAME: Record<Resolution, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "1d": "1D",
};

/** Default history window: enough context to analyse, well under provider page limits. */
const DEFAULT_LOOKBACK_DAYS: Record<Resolution, number> = {
  "1m": 2,
  "5m": 10,
  "15m": 30,
  "1h": 120,
  "1d": 3 * 365,
};

export const defaultLookbackMs = (resolution: Resolution): number =>
  DEFAULT_LOOKBACK_DAYS[resolution] * 86_400_000;

/** Largest window one request may cover at a resolution, matching the adapters' bar cap. */
export const maxSpanMs = (resolution: Resolution): number =>
  MAX_ANALYSIS_BARS * RESOLUTIONS[resolution];

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Structural check of a drawings document before it is stored. Vela re-validates each
 * drawing on load; this bounds size and shape so a stored document is always loadable
 * JSON with time+price anchors. Returns a problem description, or null when valid.
 */
export function drawingsProblem(value: unknown): string | null {
  if (!value || typeof value !== "object") return "Drawings must be a document.";
  const doc = value as Partial<DrawingsDocument>;
  if (doc.version !== 1 || !Array.isArray(doc.drawings))
    return "Unsupported drawings document version.";
  if (doc.drawings.length > MAX_DRAWINGS) return `Keep at most ${MAX_DRAWINGS} drawings per chart.`;
  const ids = new Set<string>();
  for (const drawing of doc.drawings as unknown[]) {
    if (!drawing || typeof drawing !== "object") return "A drawing is missing.";
    const d = drawing as Partial<StoredDrawing>;
    if (typeof d.id !== "string" || !d.id || d.id.length > 100) return "A drawing has no id.";
    if (ids.has(d.id)) return "Drawing ids must be unique.";
    ids.add(d.id);
    if (typeof d.type !== "string" || !/^[a-z0-9_-]{1,40}$/i.test(d.type))
      return "A drawing has an invalid type.";
    if (typeof d.paneId !== "string" || !d.paneId || d.paneId.length > 100)
      return "A drawing has no pane.";
    if (!d.style || typeof d.style !== "object") return "A drawing has no style.";
    if (!Array.isArray(d.anchors) || d.anchors.length > MAX_ANCHORS_PER_DRAWING)
      return "A drawing has too many points.";
    for (const anchor of d.anchors as unknown[]) {
      const a = anchor as { time?: unknown; price?: unknown } | null;
      if (!a || !finite(a.time) || !finite(a.price)) return "A drawing point is invalid.";
    }
  }
  if (new TextEncoder().encode(JSON.stringify(doc)).length > MAX_DRAWINGS_BYTES)
    return "Drawings are too large to save. Remove some long strokes and try again.";
  return null;
}

export const parseDrawings = (json: string | null | undefined): DrawingsDocument => {
  if (!json) return EMPTY_DRAWINGS;
  try {
    const value = JSON.parse(json) as unknown;
    return drawingsProblem(value) ? EMPTY_DRAWINGS : (value as DrawingsDocument);
  } catch {
    return EMPTY_DRAWINGS;
  }
};

export const analysisImagePath = (id: string) => `/api/analyses/${encodeURIComponent(id)}/image`;
export const analysisEditPath = (id: string) => `/charts?id=${encodeURIComponent(id)}`;

/** Which saved analysis an image URL embeds, or null for any other image. */
export function analysisIdFromSrc(src: string | undefined | null): string | null {
  const match = src?.match(/^\/api\/analyses\/([A-Za-z0-9_-]{1,64})\/image(?:\?.*)?$/);
  return match ? match[1]! : null;
}

export const analysisLabel = (a: Pick<ChartAnalysisSummary, "title" | "symbol" | "resolution">) =>
  a.title.trim() || `${a.symbol} · ${a.resolution}`;

/**
 * A standard Markdown image, so the note stays readable anywhere; the journal renders
 * it as a figure linking back to the editable chart. Alt text is escaped so a title
 * can't break out of the image syntax.
 */
export function analysisMarkdown(
  a: Pick<ChartAnalysisSummary, "id" | "title" | "symbol" | "resolution">,
): string {
  const alt = `${analysisLabel(a)} chart analysis`
    .replace(/[\\[\]]/g, "")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 200);
  return `![${alt}](${analysisImagePath(a.id)})`;
}

/** Append an analysis embed to a note once; re-saving never duplicates it. */
export function appendAnalysisEmbed(
  note: string,
  a: Pick<ChartAnalysisSummary, "id" | "title" | "symbol" | "resolution">,
): string {
  if (note.includes(analysisImagePath(a.id))) return note;
  const embed = analysisMarkdown(a);
  return note.trim() ? `${note.replace(/\s+$/, "")}\n\n${embed}\n` : `${embed}\n`;
}

export const isDayKey = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

/** Calendar day of a UTC timestamp, for the history range pickers (candles are UTC). */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Whole UTC days `[fromDay 00:00, toDay + 1 day)`, with the end capped at `now` so a
 * range ending today requests only completed and forming candles.
 */
export function utcDayRange(fromDay: string, toDay: string, now = Date.now()) {
  if (!isDayKey(fromDay) || !isDayKey(toDay) || fromDay > toDay) return null;
  const from = Date.parse(`${fromDay}T00:00:00Z`);
  const to = Math.min(Date.parse(`${toDay}T00:00:00Z`) + 86_400_000, now);
  return from < to ? { from, to } : null;
}
