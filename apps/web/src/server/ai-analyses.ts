import { analysisLabel, drawingLabel, type ChartAnalysis } from "@/lib/chart-analysis";
import { matchKeys, symbolKey } from "@/lib/symbol-match";
import { analysisImage, getAnalysis, listAnalyses } from "./chart-analyses";
import { getSnapshot, listSnapshots, snapshotImage } from "./analysis-snapshots";

/**
 * Chart analyses linked to a note, for AI reviews: the ones embedded in the note's
 * markdown first, then the day's own versions. A day's version (snapshot) is used
 * wherever there is one, so a review of a past day sees the chart as it was then, not as
 * it evolved later. Each brings its notes, drawings, zones and indicators as text plus
 * its picture, so the model reviews the chart the trader actually marked up.
 */
export const MAX_AI_ANALYSES = 3;

const EMBED = /\/api\/analyses\/([A-Za-z0-9_-]{1,64})\/(?:snapshots\/(\d{4}-\d{2}-\d{2})\/)?image/g;

interface AnalysisRef {
  id: string;
  /** A day's frozen version, or null for the live analysis. */
  day: string | null;
}

/** Analyses embedded in markdown, in order of appearance. */
export function embeddedAnalyses(markdown: string | null | undefined): AnalysisRef[] {
  return [...(markdown ?? "").matchAll(EMBED)].map((m) => ({ id: m[1]!, day: m[2] ?? null }));
}

export interface LinkedAnalysis {
  id: string;
  label: string;
  context: string;
  image: Buffer | null;
}

export function linkedAnalyses(source: {
  notes?: (string | null | undefined)[];
  day?: string | null;
  /** When set, the day's analyses count only if they chart one of these symbols. */
  symbols?: string[];
}): LinkedAnalysis[] {
  const refs = source.notes?.flatMap(embeddedAnalyses) ?? [];
  if (source.day) {
    const keys = source.symbols?.length
      ? new Set(source.symbols.flatMap((s) => [...matchKeys(s)]))
      : null;
    const fits = (symbol: string) => !keys || keys.has(symbolKey(symbol));
    for (const snap of listSnapshots({ day: source.day }))
      if (fits(snap.symbol)) refs.push({ id: snap.analysisId, day: source.day });
    // Analyses assigned to the day before day versions existed.
    for (const summary of listAnalyses({ day: source.day, limit: 20 }).reverse())
      if (fits(summary.symbol)) refs.push({ id: summary.id, day: null });
  }
  const linked: LinkedAnalysis[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (linked.length >= MAX_AI_ANALYSES) break;
    if (seen.has(ref.id)) continue;
    const analysis = ref.day ? getSnapshot(ref.id, ref.day) : getAnalysis(ref.id);
    if (!analysis) continue;
    seen.add(ref.id);
    const image = !analysis.hasImage
      ? null
      : ref.day
        ? snapshotImage(ref.id, ref.day)
        : analysisImage(ref.id);
    linked.push({
      id: ref.id,
      label: ref.day ? `${analysisLabel(analysis)} (as of ${ref.day})` : analysisLabel(analysis),
      context: describeAnalysis(analysis, ref.day),
      image,
    });
  }
  return linked;
}

const iso = (time: number | null) =>
  time === null ? "?" : new Date(time).toISOString().slice(0, 16).replace("T", " ");

/** The analysis as plain text, for the model to read beside its image. */
export function describeAnalysis(analysis: ChartAnalysis, day: string | null = null): string {
  const counts = new Map<string, number>();
  for (const drawing of analysis.drawings.drawings) {
    const label = drawingLabel(
      drawing.type,
      typeof drawing.text === "string" ? drawing.text : undefined,
    );
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const drawings = [...counts].map(([label, n]) => (n > 1 ? `${label} x${n}` : label));
  const zones = analysis.zones
    .filter((zone) => zone.visible)
    .map(
      (zone) =>
        `${zone.kind === "auto" ? "zone" : zone.kind} ${zone.low} to ${zone.high}${zone.label ? ` (${JSON.stringify(zone.label)})` : ""}`,
    );
  const indicators = analysis.indicators.filter((i) => i.visible).map((i) => i.title);
  return [
    `${JSON.stringify(analysisLabel(analysis))}: ${analysis.symbol} ${analysis.resolution} candles from ${analysis.provider}${day ? `, as it stood on journal day ${day}` : ""}, view ${iso(analysis.visibleFrom ?? analysis.rangeFrom)} to ${iso(analysis.visibleTo ?? analysis.rangeTo)} UTC, last edited ${analysis.updatedAt}`,
    `Drawings: ${drawings.join(", ") || "none"}`,
    `Support/resistance zones: ${zones.join("; ") || "none"}`,
    `Indicators: ${indicators.join(", ") || "none"}`,
    `Analysis notes: ${analysis.notes.trim() || "none"}`,
  ].join("\n");
}

/** The prompt section for linked analyses, numbering images in the order they are sent. */
export function analysesPrompt(linked: LinkedAnalysis[]): string {
  if (!linked.length) return "";
  let image = 0;
  const parts = linked.map((analysis, index) => {
    const attached = analysis.image ? `image ${(image += 1)} attached` : "no snapshot saved";
    return `Chart analysis ${index + 1} (${attached}):\n${analysis.context}`;
  });
  return `The trader's own chart analyses linked to this, with their chart snapshots attached as
images. Read the drawings and zones in each image and check the plan against what happened.
Comment on what the chart shows only when it is visible in the image or listed here.

${parts.join("\n\n")}`;
}

export const analysisImages = (linked: LinkedAnalysis[]): Buffer[] =>
  linked.flatMap((analysis) => (analysis.image ? [analysis.image] : []));

/** What the UI shows about the analyses a review used. */
export const analysesUsed = (linked: LinkedAnalysis[]) =>
  linked.map(({ id, label, image }) => ({ id, label, image: image !== null }));
