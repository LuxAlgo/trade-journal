import { analysisLabel, drawingLabel, type ChartAnalysis } from "@/lib/chart-analysis";
import { matchKeys, symbolKey } from "@/lib/symbol-match";
import { analysisImage, getAnalysis, listAnalyses } from "./chart-analyses";

/**
 * Chart analyses linked to a note, for AI reviews: the ones embedded in the note's
 * markdown first, then the ones assigned to its journal day. Each brings its own notes,
 * drawings, zones and indicators as text plus its saved snapshot as an image, so the
 * model reviews the chart the trader actually marked up.
 */
export const MAX_AI_ANALYSES = 3;

const EMBED = /\/api\/analyses\/([A-Za-z0-9_-]{1,64})\/image/g;

/** Analysis ids embedded in markdown, in order of appearance. */
export function embeddedAnalysisIds(markdown: string | null | undefined): string[] {
  return [...new Set([...(markdown ?? "").matchAll(EMBED)].map((match) => match[1]!))];
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
  /** When set, day analyses count only if they chart one of these symbols. */
  symbols?: string[];
}): LinkedAnalysis[] {
  const ids = source.notes?.flatMap(embeddedAnalysisIds) ?? [];
  if (source.day) {
    const keys = source.symbols?.length
      ? new Set(source.symbols.flatMap((s) => [...matchKeys(s)]))
      : null;
    for (const summary of listAnalyses({ day: source.day, limit: 20 }).reverse())
      if (!keys || keys.has(symbolKey(summary.symbol))) ids.push(summary.id);
  }
  const linked: LinkedAnalysis[] = [];
  for (const id of new Set(ids)) {
    if (linked.length >= MAX_AI_ANALYSES) break;
    const analysis = getAnalysis(id);
    if (!analysis) continue;
    linked.push({
      id,
      label: analysisLabel(analysis),
      context: describeAnalysis(analysis),
      image: analysis.hasImage ? analysisImage(id) : null,
    });
  }
  return linked;
}

const iso = (time: number | null) =>
  time === null ? "?" : new Date(time).toISOString().slice(0, 16).replace("T", " ");

/** The analysis as plain text, for the model to read beside its image. */
export function describeAnalysis(analysis: ChartAnalysis): string {
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
    `${JSON.stringify(analysisLabel(analysis))}: ${analysis.symbol} ${analysis.resolution} candles from ${analysis.provider}, view ${iso(analysis.visibleFrom ?? analysis.rangeFrom)} to ${iso(analysis.visibleTo ?? analysis.rangeTo)} UTC, last edited ${analysis.updatedAt}`,
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
