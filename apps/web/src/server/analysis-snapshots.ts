import { and, asc, desc, eq, sql } from "drizzle-orm";
import { dayKeyOf } from "@luxalgo/journal-core";
import { chartAnalyses, chartAnalysisSnapshots, db } from "@/db";
import {
  parseDrawings,
  type AnalysisSnapshot,
  type AnalysisSnapshotSummary,
} from "@/lib/chart-analysis";
import { parseLayers } from "@/lib/chart-layers";
import { parseIndicators } from "@/lib/chart-indicators";
import { parseZones } from "@/lib/sr-zones";
import type { Resolution } from "@/lib/market-data";
import { getTimeZone } from "./settings";
import { nowIso } from "./ids";

/**
 * Day snapshots: a chart analysis is one evolving board, and every journal day it was
 * edited keeps a frozen copy of it (drawings, layers, zones, indicators, notes and the PNG).
 * Saving updates today's copy; once the day ends in the journal timezone nobody writes it
 * again, so each day's journal shows the analysis as it was that day.
 */
export const journalToday = () => dayKeyOf(nowIso(), getTimeZone());

const STATE = {
  title: chartAnalyses.title,
  symbol: chartAnalyses.symbol,
  provider: chartAnalyses.provider,
  dataset: chartAnalyses.dataset,
  resolution: chartAnalyses.resolution,
  rangeFrom: chartAnalyses.rangeFrom,
  rangeTo: chartAnalyses.rangeTo,
  visibleFrom: chartAnalyses.visibleFrom,
  visibleTo: chartAnalyses.visibleTo,
  drawingsJson: chartAnalyses.drawingsJson,
  drawingCount: chartAnalyses.drawingCount,
  layersJson: chartAnalyses.layersJson,
  indicatorsJson: chartAnalyses.indicatorsJson,
  zonesJson: chartAnalyses.zonesJson,
  notes: chartAnalyses.notes,
};

/**
 * Copy the analysis's current state into its snapshot for `day`. The image is copied only
 * when the save carried a new one (or the day has none yet), so frequent autosaves do not
 * rewrite megabytes each time.
 */
export function recordSnapshot(analysisId: string, day: string, options: { image: boolean }) {
  const state = db.select(STATE).from(chartAnalyses).where(eq(chartAnalyses.id, analysisId)).get();
  if (!state) return;
  const existing = db
    .select({ hasImage: sql<number>`${chartAnalysisSnapshots.image} IS NOT NULL` })
    .from(chartAnalysisSnapshots)
    .where(
      and(eq(chartAnalysisSnapshots.analysisId, analysisId), eq(chartAnalysisSnapshots.day, day)),
    )
    .get();
  const withImage = options.image || !existing || !existing.hasImage;
  const image = withImage
    ? (db
        .select({ image: chartAnalyses.image })
        .from(chartAnalyses)
        .where(eq(chartAnalyses.id, analysisId))
        .get()?.image ?? null)
    : undefined;
  const now = nowIso();
  const values = { ...state, ...(image !== undefined ? { image } : {}), updatedAt: now };
  db.insert(chartAnalysisSnapshots)
    .values({ ...values, analysisId, day, createdAt: now })
    .onConflictDoUpdate({
      target: [chartAnalysisSnapshots.analysisId, chartAnalysisSnapshots.day],
      set: values,
    })
    .run();
}

const summaryColumns = {
  analysisId: chartAnalysisSnapshots.analysisId,
  day: chartAnalysisSnapshots.day,
  title: chartAnalysisSnapshots.title,
  symbol: chartAnalysisSnapshots.symbol,
  provider: chartAnalysisSnapshots.provider,
  resolution: chartAnalysisSnapshots.resolution,
  drawingCount: chartAnalysisSnapshots.drawingCount,
  hasImage: sql<number>`${chartAnalysisSnapshots.image} IS NOT NULL`,
  createdAt: chartAnalysisSnapshots.createdAt,
  updatedAt: chartAnalysisSnapshots.updatedAt,
};

type SummaryRow = Omit<AnalysisSnapshotSummary, "resolution" | "hasImage"> & {
  resolution: string;
  hasImage: number;
};
const toSummary = (row: SummaryRow): AnalysisSnapshotSummary => ({
  ...row,
  resolution: row.resolution as Resolution,
  hasImage: Boolean(row.hasImage),
});

/** Snapshots of one journal day (oldest first), or one analysis's days (newest first). */
export function listSnapshots(filter: { day?: string; analysisId?: string }) {
  return db
    .select(summaryColumns)
    .from(chartAnalysisSnapshots)
    .where(
      and(
        filter.day ? eq(chartAnalysisSnapshots.day, filter.day) : undefined,
        filter.analysisId ? eq(chartAnalysisSnapshots.analysisId, filter.analysisId) : undefined,
      ),
    )
    .orderBy(filter.day ? asc(chartAnalysisSnapshots.createdAt) : desc(chartAnalysisSnapshots.day))
    .limit(1000)
    .all()
    .map(toSummary);
}

const where = (analysisId: string, day: string) =>
  and(eq(chartAnalysisSnapshots.analysisId, analysisId), eq(chartAnalysisSnapshots.day, day));

/** The full state of a day's snapshot, shaped like the analysis so a chart can open it. */
export function getSnapshot(analysisId: string, day: string): AnalysisSnapshot | null {
  const row = db
    .select({
      ...summaryColumns,
      dataset: chartAnalysisSnapshots.dataset,
      rangeFrom: chartAnalysisSnapshots.rangeFrom,
      rangeTo: chartAnalysisSnapshots.rangeTo,
      visibleFrom: chartAnalysisSnapshots.visibleFrom,
      visibleTo: chartAnalysisSnapshots.visibleTo,
      drawingsJson: chartAnalysisSnapshots.drawingsJson,
      layersJson: chartAnalysisSnapshots.layersJson,
      indicatorsJson: chartAnalysisSnapshots.indicatorsJson,
      zonesJson: chartAnalysisSnapshots.zonesJson,
      notes: chartAnalysisSnapshots.notes,
      dayDate: chartAnalyses.dayDate,
    })
    .from(chartAnalysisSnapshots)
    .innerJoin(chartAnalyses, eq(chartAnalyses.id, chartAnalysisSnapshots.analysisId))
    .where(where(analysisId, day))
    .get();
  if (!row) return null;
  const { drawingsJson, layersJson, indicatorsJson, zonesJson, hasImage, ...rest } = row;
  return {
    ...rest,
    id: analysisId,
    resolution: rest.resolution as Resolution,
    hasImage: Boolean(hasImage),
    drawings: parseDrawings(drawingsJson),
    layers: parseLayers(layersJson),
    indicators: parseIndicators(indicatorsJson),
    zones: parseZones(zonesJson),
  };
}

export const snapshotImage = (analysisId: string, day: string): Buffer | null =>
  db
    .select({ image: chartAnalysisSnapshots.image })
    .from(chartAnalysisSnapshots)
    .where(where(analysisId, day))
    .get()?.image ?? null;

export const deleteSnapshot = (analysisId: string, day: string): boolean =>
  db.delete(chartAnalysisSnapshots).where(where(analysisId, day)).run().changes > 0;

/** The snapshot columns holding the same state as `STATE` on the analysis. */
const SNAPSHOT_STATE = {
  title: chartAnalysisSnapshots.title,
  symbol: chartAnalysisSnapshots.symbol,
  provider: chartAnalysisSnapshots.provider,
  dataset: chartAnalysisSnapshots.dataset,
  resolution: chartAnalysisSnapshots.resolution,
  rangeFrom: chartAnalysisSnapshots.rangeFrom,
  rangeTo: chartAnalysisSnapshots.rangeTo,
  visibleFrom: chartAnalysisSnapshots.visibleFrom,
  visibleTo: chartAnalysisSnapshots.visibleTo,
  drawingsJson: chartAnalysisSnapshots.drawingsJson,
  drawingCount: chartAnalysisSnapshots.drawingCount,
  layersJson: chartAnalysisSnapshots.layersJson,
  indicatorsJson: chartAnalysisSnapshots.indicatorsJson,
  zonesJson: chartAnalysisSnapshots.zonesJson,
  notes: chartAnalysisSnapshots.notes,
  image: chartAnalysisSnapshots.image,
};

/** Make a day's version the live analysis again; today's snapshot records the change. */
export function restoreSnapshot(analysisId: string, day: string): boolean {
  return db.transaction(() => {
    const snap = db
      .select(SNAPSHOT_STATE)
      .from(chartAnalysisSnapshots)
      .where(where(analysisId, day))
      .get();
    if (!snap) return false;
    db.update(chartAnalyses)
      .set({ ...snap, updatedAt: nowIso() })
      .where(eq(chartAnalyses.id, analysisId))
      .run();
    recordSnapshot(analysisId, journalToday(), { image: true });
    return true;
  });
}
