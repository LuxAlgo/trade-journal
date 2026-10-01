import { analysisLabel, type ChartAnalysis } from "@/lib/chart-analysis";
import { describeDrawings } from "@/lib/analysis-text";
import { matchKeys, symbolKey } from "@/lib/symbol-match";
import { analysisImage, getAnalysis, listAnalyses } from "./chart-analyses";
import { getSnapshot, listSnapshots, previousSnapshot, snapshotImage } from "./analysis-snapshots";
import { describeChanges } from "@/lib/analysis-diff";
import { dayPriceAction } from "./day-price-action";
import { getTimeZone } from "./settings";
import { listReviews } from "./plan-reviews";
import { describePlan, planTradeStats } from "@/lib/analysis-plan";
import { dayTradesFor } from "./trade-links";
import { similarPastDays } from "./journal-history";
import { eq } from "drizzle-orm";
import { db, playbooks } from "@/db";

const playbookName = (id: string | null) =>
  id
    ? (db.select({ name: playbooks.name }).from(playbooks).where(eq(playbooks.id, id)).get()
        ?.name ?? null)
    : null;

/**
 * Chart analyses linked to a note, for AI reviews: the ones embedded in the note's
 * markdown first, then the day's own versions. A day's version (snapshot) is used
 * wherever there is one, so a review of a past day sees the chart as it was then, not as
 * it evolved later. Each brings its drawings (with their prices), zones, indicators and
 * notes as text, what price did against its levels that day, and for the first few, its
 * picture. Models read numbers far better than chart pictures, so the text leads.
 */
export const MAX_AI_ANALYSES = 6;
/** Pictures are the costly part of a request; only the first analyses send theirs. */
export const MAX_AI_IMAGES = 3;
/** A slow market data source never holds up a review for long. */
const PRICE_ACTION_TIMEOUT_MS = 8_000;

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

export async function linkedAnalyses(source: {
  notes?: (string | null | undefined)[];
  day?: string | null;
  /** When set, the day's analyses count only if they chart one of these symbols. */
  symbols?: string[];
}): Promise<LinkedAnalysis[]> {
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
    const image =
      !analysis.hasImage || linked.filter((l) => l.image).length >= MAX_AI_IMAGES
        ? null
        : ref.day
          ? snapshotImage(ref.id, ref.day)
          : analysisImage(ref.id);
    const day = ref.day ?? source.day ?? null;
    linked.push({
      id: ref.id,
      label: ref.day ? `${analysisLabel(analysis)} (as of ${ref.day})` : analysisLabel(analysis),
      context:
        describeAnalysis(analysis, ref.day) +
        (ref.day ? changesText(ref.id, ref.day) : "") +
        (day ? await priceActionText(analysis, day, !source.symbols) : planText(analysis)),
      image,
    });
  }
  return linked;
}

/** The day's trades on the analysis's symbol, and which you took from its plan. */
function planTrades(analysis: ChartAnalysis, day: string): string {
  const trades = dayTradesFor(analysis, day, getTimeZone());
  if (!trades.length) return "";
  const own = trades.filter((t) => t.link?.analysisId === analysis.id);
  const stats = planTradeStats(trades, new Set(own.map((t) => t.key)));
  const scenario = (id: string | null) =>
    analysis.plan.scenarios.find((s) => s.id === id)?.name || null;
  const lines = trades.map((t) => {
    const from =
      t.link?.analysisId === analysis.id
        ? `taken from this plan${scenario(t.link.scenarioId) ? ` (scenario ${JSON.stringify(scenario(t.link.scenarioId))})` : ""}`
        : t.link
          ? "taken from another analysis"
          : "not linked to a plan";
    return `- ${t.symbol} ${t.direction} opened ${t.openedAt} at ${t.avgEntry}, net ${t.netPnl.toFixed(2)}, ${from}`;
  });
  return `Trades that day on this symbol: ${stats.onPlan.trades} from the plan (net ${stats.onPlan.netPnl.toFixed(2)}), ${stats.offPlan.trades} not (net ${stats.offPlan.netPnl.toFixed(2)})\n${lines.join("\n")}`;
}

/** How the analysis changed since its previous day's version. */
function changesText(id: string, day: string): string {
  const current = getSnapshot(id, day);
  const previous = current && previousSnapshot(id, day);
  if (!current || !previous) return "";
  const changes = describeChanges(previous, current);
  return `\nChanged since its ${previous.day} version: ${changes.length ? `\n${changes.map((c) => `- ${c}`).join("\n")}` : "nothing"}`;
}

/** The plan alone, for an analysis linked without a day. */
function planText(analysis: ChartAnalysis) {
  const plan = describePlan(analysis.plan, { playbook: playbookName(analysis.plan.playbookId) });
  return plan ? `\n${plan}` : "";
}

/** The plan with the day's grades, the day's trades, and what price did that day. */
async function priceActionText(
  analysis: ChartAnalysis,
  day: string,
  /** Trades are across accounts: only for an unfiltered recap, like the shared day note. */
  withTrades: boolean,
): Promise<string> {
  let action: Awaited<ReturnType<typeof dayPriceAction>> = null;
  let unavailable = "";
  try {
    action = await dayPriceAction(
      analysis,
      day,
      getTimeZone(),
      AbortSignal.timeout(PRICE_ACTION_TIMEOUT_MS),
    );
  } catch (error) {
    unavailable = error instanceof Error ? error.message : "market data error";
  }
  const plan = describePlan(analysis.plan, {
    reviews: listReviews(analysis.id, day),
    suggestions: action?.scenarios,
    playbook: playbookName(analysis.plan.playbookId),
  });
  let similar = "";
  if (withTrades && action)
    similar = await similarPastDays(
      analysis,
      day,
      action.context,
      getTimeZone(),
      AbortSignal.timeout(PRICE_ACTION_TIMEOUT_MS),
    ).catch(() => "");
  return [
    plan,
    withTrades ? planTrades(analysis, day) : "",
    similar,
    action
      ? `Price action ${action.text}`
      : unavailable
        ? `Price action on ${day}: unavailable (${unavailable})`
        : "",
  ]
    .filter(Boolean)
    .map((part) => `\n${part}`)
    .join("");
}

const iso = (time: number | null) =>
  time === null ? "?" : new Date(time).toISOString().slice(0, 16).replace("T", " ");

/** The analysis as plain text, for the model to read beside its image. */
export function describeAnalysis(analysis: ChartAnalysis, day: string | null = null): string {
  const described = describeDrawings(analysis.drawings.drawings, analysis.layers);
  const extra = [
    described.hidden ? `${described.hidden} hidden` : "",
    described.omitted ? `${described.omitted} more not listed` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const zones = analysis.zones
    .filter((zone) => zone.visible)
    .map(
      (zone) =>
        `${zone.kind === "auto" ? "zone" : zone.kind} ${zone.low} to ${zone.high}${zone.label ? ` (${JSON.stringify(zone.label)})` : ""}`,
    );
  const indicators = analysis.indicators.filter((i) => i.visible).map((i) => i.title);
  return [
    `${JSON.stringify(analysisLabel(analysis))}: ${analysis.symbol} ${analysis.resolution} candles from ${analysis.provider}${day ? `, as it stood on journal day ${day}` : ""}, view ${iso(analysis.visibleFrom ?? analysis.rangeFrom)} to ${iso(analysis.visibleTo ?? analysis.rangeTo)} UTC, last edited ${analysis.updatedAt}`,
    `Drawings (prices; UTC times; nested ones indented under the drawing they belong to)${extra ? `, ${extra}` : ""}:${described.lines.length ? `\n${described.lines.join("\n")}` : " none"}`,
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
    const attached = analysis.image ? `image ${(image += 1)} attached` : "described as text only";
    return `Chart analysis ${index + 1} (${attached}):\n${analysis.context}`;
  });
  return `The trader's own chart analyses linked to this. Each lists its drawings with their exact
prices and, where the day is known, what price did against its levels that day (computed from
the day's candles). Some have their chart snapshot attached as an image. Rely on the listed
prices and price action over reading the images; use the images for context only. Check the
plan against what happened, and comment only on what is listed here or clearly visible.

${parts.join("\n\n")}`;
}

export const analysisImages = (linked: LinkedAnalysis[]): Buffer[] =>
  linked.flatMap((analysis) => (analysis.image ? [analysis.image] : []));

/** What the UI shows about the analyses a review used. */
export const analysesUsed = (linked: LinkedAnalysis[]) =>
  linked.map(({ id, label, image }) => ({ id, label, image: image !== null }));
