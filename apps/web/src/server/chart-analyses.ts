import { desc, eq, sql } from "drizzle-orm";
import { chartAnalyses, db, journalDays } from "@/db";
import { isResolution, type Resolution } from "@/lib/market-data";
import {
  appendAnalysisEmbed,
  drawingsProblem,
  isDayKey,
  MAX_SNAPSHOT_BYTES,
  parseDrawings,
  type ChartAnalysis,
  type ChartAnalysisSummary,
  type DrawingsDocument,
} from "@/lib/chart-analysis";
import { providerFor } from "./market-data/connections";
import { RequestError, requireValue } from "./api";
import { newId, nowIso } from "./ids";

type Row = typeof chartAnalyses.$inferSelect;

const PNG_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Decode a `chart.screenshot()` data URL; null unless it is a bounded PNG. */
export function decodePngDataUrl(value: unknown): Buffer | null {
  if (typeof value !== "string" || !value.startsWith(PNG_PREFIX)) return null;
  const base64 = value.slice(PNG_PREFIX.length);
  if (!base64 || base64.length > Math.ceil(MAX_SNAPSHOT_BYTES / 3) * 4) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_SNAPSHOT_BYTES || !PNG_SIGNATURE.every((v, i) => bytes[i] === v))
    return null;
  return bytes;
}

export interface AnalysisInput {
  title?: string;
  symbol?: string;
  provider?: string;
  dataset?: string | null;
  resolution?: Resolution;
  rangeFrom?: number;
  rangeTo?: number;
  visibleFrom?: number | null;
  visibleTo?: number | null;
  notes?: string;
  dayDate?: string | null;
  drawings?: DrawingsDocument;
  /** null clears a snapshot that no longer matches the drawings. */
  image?: Buffer | null;
}

const time = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value);

/**
 * Validate a create (every source field required) or a partial update body. Unknown
 * fields are ignored; each present field must be valid or the whole request fails.
 */
export function parseAnalysisInput(body: unknown, partial: boolean): AnalysisInput {
  requireValue(body && typeof body === "object", "Invalid analysis.");
  const b = body as Record<string, unknown>;
  const has = (key: string) => b[key] !== undefined;
  const input: AnalysisInput = {};
  if (has("title")) {
    requireValue(
      typeof b.title === "string" && b.title.length <= 200,
      "Titles are 200 characters or fewer.",
    );
    input.title = b.title.trim();
  }
  if (has("symbol") || !partial) {
    requireValue(
      typeof b.symbol === "string" &&
        b.symbol.trim().length > 0 &&
        b.symbol.length <= 100 &&
        !/[\x00-\x1f]/.test(b.symbol),
      "Enter the provider's exact instrument symbol.",
    );
    input.symbol = b.symbol.trim();
  }
  if (has("provider") || !partial) {
    requireValue(typeof b.provider === "string", "Choose a market data provider.");
    try {
      providerFor(b.provider);
    } catch {
      throw new RequestError("Choose an available market data provider.");
    }
    input.provider = b.provider;
  }
  if (has("dataset")) {
    requireValue(
      b.dataset === null ||
        (typeof b.dataset === "string" && /^[a-zA-Z0-9_-]{0,80}$/.test(b.dataset)),
      "Invalid dataset.",
    );
    input.dataset = b.dataset ? (b.dataset as string) : null;
  }
  if (has("resolution") || !partial) {
    requireValue(isResolution(b.resolution), "Choose a supported candle resolution.");
    input.resolution = b.resolution;
  }
  if (has("rangeFrom") || has("rangeTo") || !partial) {
    requireValue(
      time(b.rangeFrom) && time(b.rangeTo) && (b.rangeFrom as number) < (b.rangeTo as number),
      "Invalid chart history range.",
    );
    input.rangeFrom = b.rangeFrom as number;
    input.rangeTo = b.rangeTo as number;
  }
  if (has("visibleFrom") || has("visibleTo")) {
    const cleared = b.visibleFrom === null && b.visibleTo === null;
    requireValue(
      cleared ||
        (time(b.visibleFrom) &&
          time(b.visibleTo) &&
          (b.visibleFrom as number) < (b.visibleTo as number)),
      "Invalid visible range.",
    );
    input.visibleFrom = cleared ? null : (b.visibleFrom as number);
    input.visibleTo = cleared ? null : (b.visibleTo as number);
  }
  if (has("notes")) {
    requireValue(typeof b.notes === "string" && b.notes.length <= 100_000, "Notes are too long.");
    input.notes = b.notes;
  }
  if (has("dayDate")) {
    requireValue(b.dayDate === null || isDayKey(b.dayDate), "Choose a valid journal day.");
    input.dayDate = b.dayDate as string | null;
  }
  if (has("drawings") || !partial) {
    const problem = drawingsProblem(b.drawings);
    requireValue(!problem, problem ?? "");
    input.drawings = b.drawings as DrawingsDocument;
  }
  if (b.image === null) input.image = null;
  else if (has("image")) {
    const image = decodePngDataUrl(b.image);
    requireValue(image, "Chart snapshots must be PNG images of 4 MB or less.");
    input.image = image;
  }
  return input;
}

const summaryColumns = {
  id: chartAnalyses.id,
  title: chartAnalyses.title,
  symbol: chartAnalyses.symbol,
  provider: chartAnalyses.provider,
  dataset: chartAnalyses.dataset,
  resolution: chartAnalyses.resolution,
  rangeFrom: chartAnalyses.rangeFrom,
  rangeTo: chartAnalyses.rangeTo,
  dayDate: chartAnalyses.dayDate,
  drawingCount: chartAnalyses.drawingCount,
  createdAt: chartAnalyses.createdAt,
  updatedAt: chartAnalyses.updatedAt,
};

/** The image is served separately; listings only report whether one exists. */
const toSummary = (
  row: Omit<Row, "image" | "drawingsJson" | "notes" | "visibleFrom" | "visibleTo">,
  hasImage: boolean,
): ChartAnalysisSummary => ({ ...row, resolution: row.resolution as Resolution, hasImage });

export function listAnalyses(options: { day?: string; limit?: number } = {}) {
  const rows = db
    .select({ ...summaryColumns, hasImage: sql<number>`${chartAnalyses.image} IS NOT NULL` })
    .from(chartAnalyses)
    .where(options.day ? eq(chartAnalyses.dayDate, options.day) : undefined)
    .orderBy(desc(chartAnalyses.updatedAt))
    .limit(options.limit ?? 200)
    .all();
  return rows.map(({ hasImage, ...row }) => toSummary(row, Boolean(hasImage)));
}

export function getAnalysis(id: string): ChartAnalysis | null {
  const row = db
    .select({
      ...summaryColumns,
      hasImage: sql<number>`${chartAnalyses.image} IS NOT NULL`,
      visibleFrom: chartAnalyses.visibleFrom,
      visibleTo: chartAnalyses.visibleTo,
      notes: chartAnalyses.notes,
      drawingsJson: chartAnalyses.drawingsJson,
    })
    .from(chartAnalyses)
    .where(eq(chartAnalyses.id, id))
    .get();
  if (!row) return null;
  const { hasImage, drawingsJson, visibleFrom, visibleTo, notes, ...rest } = row;
  return {
    ...toSummary(rest, Boolean(hasImage)),
    visibleFrom,
    visibleTo,
    notes,
    drawings: parseDrawings(drawingsJson),
  };
}

export const analysisImage = (id: string): Buffer | null =>
  db
    .select({ image: chartAnalyses.image })
    .from(chartAnalyses)
    .where(eq(chartAnalyses.id, id))
    .get()?.image ?? null;

const columns = (input: AnalysisInput) => {
  const { drawings, ...rest } = input;
  return {
    ...rest,
    ...(drawings
      ? { drawingsJson: JSON.stringify(drawings), drawingCount: drawings.drawings.length }
      : {}),
  };
};

/** Add the analysis image to its journal day note once, creating the day note if needed. */
function embedInJournal(analysis: ChartAnalysisSummary, day: string) {
  const current = db.select().from(journalDays).where(eq(journalDays.date, day)).get();
  const note = appendAnalysisEmbed(current?.note ?? "", analysis);
  if (current && note === current.note) return;
  db.insert(journalDays)
    .values({ date: day, note, updatedAt: nowIso() })
    .onConflictDoUpdate({ target: journalDays.date, set: { note, updatedAt: nowIso() } })
    .run();
}

export function createAnalysis(input: AnalysisInput, options: { embed?: boolean } = {}) {
  const id = newId();
  const now = nowIso();
  return db.transaction(() => {
    db.insert(chartAnalyses)
      .values({
        ...columns(input),
        id,
        symbol: input.symbol!,
        provider: input.provider!,
        resolution: input.resolution!,
        rangeFrom: input.rangeFrom!,
        rangeTo: input.rangeTo!,
        drawingsJson: JSON.stringify(input.drawings!),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const analysis = getAnalysis(id)!;
    if (options.embed && analysis.dayDate) embedInJournal(analysis, analysis.dayDate);
    return analysis;
  });
}

export function updateAnalysis(
  id: string,
  input: AnalysisInput,
  options: { embed?: boolean } = {},
) {
  return db.transaction(() => {
    const result = db
      .update(chartAnalyses)
      .set({ ...columns(input), updatedAt: nowIso() })
      .where(eq(chartAnalyses.id, id))
      .run();
    if (!result.changes) return null;
    const analysis = getAnalysis(id)!;
    if (options.embed) {
      requireValue(analysis.dayDate, "Choose a journal day first.");
      embedInJournal(analysis, analysis.dayDate);
    }
    return analysis;
  });
}

/** Journal notes keep their embed text; a deleted analysis renders as unavailable. */
export const deleteAnalysis = (id: string): boolean =>
  db.delete(chartAnalyses).where(eq(chartAnalyses.id, id)).run().changes > 0;
