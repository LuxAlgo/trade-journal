import type { MarketBar } from "./market-data";
import { fmtPrice, fmtTime } from "./analysis-text";

/**
 * A chart analysis's trading plan: a bias, an optional playbook, and scenarios ("if price
 * reaches X, I go long to Y; wrong below Z"). Each journal day grades its scenarios; the
 * day's candles suggest a grade (played out, invalidated, not triggered) and you confirm it,
 * so over time the journal can count how often your read was right.
 */

export type Bias = "long" | "short" | "neutral";
export type Direction = "long" | "short";

export interface PlanScenario {
  id: string;
  name: string;
  direction: Direction;
  /** The price that sets the scenario off; null leaves it to be graded by hand. */
  trigger: number | null;
  target: number | null;
  /** Where the idea is wrong (the stop). */
  invalidation: number | null;
  note: string;
}

export interface AnalysisPlan {
  bias: Bias | null;
  playbookId: string | null;
  scenarios: PlanScenario[];
}

export const EMPTY_PLAN: AnalysisPlan = { bias: null, playbookId: null, scenarios: [] };
export const MAX_SCENARIOS = 10;

export const OUTCOMES = [
  "played-out",
  "invalidated",
  "not-triggered",
  "triggered",
  "unclear",
] as const;
export type ScenarioOutcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<ScenarioOutcome, string> = {
  "played-out": "Played out",
  invalidated: "Invalidated",
  "not-triggered": "Not triggered",
  triggered: "Triggered, still open",
  unclear: "Unclear",
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const price = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));

export const isOutcome = (value: unknown): value is ScenarioOutcome =>
  (OUTCOMES as readonly unknown[]).includes(value);

/** Shape problems for a stored plan, or null. */
export function planProblem(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "A plan must be an object.";
  const p = value as Partial<AnalysisPlan>;
  if (p.bias !== null && !["long", "short", "neutral"].includes(p.bias as string))
    return "Choose a bias: long, short or neutral.";
  if (p.playbookId !== null && !(typeof p.playbookId === "string" && ID.test(p.playbookId)))
    return "The plan's playbook is invalid.";
  if (!Array.isArray(p.scenarios) || p.scenarios.length > MAX_SCENARIOS)
    return `Keep at most ${MAX_SCENARIOS} scenarios.`;
  const ids = new Set<string>();
  for (const s of p.scenarios as unknown[]) {
    const scenario = s as Partial<PlanScenario> | null;
    if (
      !scenario ||
      typeof scenario.id !== "string" ||
      !ID.test(scenario.id) ||
      ids.has(scenario.id)
    )
      return "A scenario has an invalid id.";
    ids.add(scenario.id);
    if (typeof scenario.name !== "string" || scenario.name.length > 80)
      return "Scenario names are 80 characters or fewer.";
    if (scenario.direction !== "long" && scenario.direction !== "short")
      return "A scenario is long or short.";
    if (![scenario.trigger, scenario.target, scenario.invalidation].every(price))
      return "Scenario prices must be numbers.";
    if (typeof scenario.note !== "string" || scenario.note.length > 1000)
      return "Scenario notes are 1000 characters or fewer.";
  }
  return null;
}

/**
 * A scenario whose prices sit on the wrong sides (a long's target below its trigger, or its
 * invalidation above it), in words; null when they make sense or are not all set.
 */
export function scenarioWarning(s: PlanScenario): string | null {
  if (s.trigger === null) return null;
  const long = s.direction === "long";
  if (s.target !== null && (long ? s.target <= s.trigger : s.target >= s.trigger))
    return `For a ${s.direction}, the target sits ${long ? "above" : "below"} the trigger.`;
  if (s.invalidation !== null && (long ? s.invalidation >= s.trigger : s.invalidation <= s.trigger))
    return `For a ${s.direction}, the invalidation sits ${long ? "below" : "above"} the trigger.`;
  return null;
}

export function parsePlan(json: string | null | undefined): AnalysisPlan {
  if (!json) return EMPTY_PLAN;
  try {
    const value = JSON.parse(json) as unknown;
    return planProblem(value) ? EMPTY_PLAN : (value as AnalysisPlan);
  } catch {
    return EMPTY_PLAN;
  }
}

export const isPlanEmpty = (plan: AnalysisPlan) =>
  plan.bias === null && plan.playbookId === null && plan.scenarios.length === 0;

export interface OutcomeSuggestion {
  outcome: ScenarioOutcome;
  triggeredAt: number | null;
  resolvedAt: number | null;
  /** Why, in words, for the day page and the AI. */
  reason: string;
}

/**
 * What the day's candles say about a scenario: it triggers on the first candle that trades
 * through its trigger, then plays out or is invalidated by whichever of target and
 * invalidation a later candle reaches first. One candle reaching both is unclear, and so is
 * a trigger candle that also reaches either: inside one candle the order is unknown.
 */
export function suggestOutcome(
  scenario: PlanScenario,
  bars: readonly MarketBar[],
): OutcomeSuggestion {
  if (scenario.trigger === null)
    return {
      outcome: "unclear",
      triggeredAt: null,
      resolvedAt: null,
      reason: "No trigger price: grade it yourself.",
    };
  const trigger = scenario.trigger;
  const long = scenario.direction === "long";
  let triggeredAt: number | null = null;
  for (const bar of bars) {
    const hitTarget =
      scenario.target !== null && (long ? bar.high >= scenario.target : bar.low <= scenario.target);
    const hitStop =
      scenario.invalidation !== null &&
      (long ? bar.low <= scenario.invalidation : bar.high >= scenario.invalidation);
    if (triggeredAt === null) {
      if (bar.low > trigger || bar.high < trigger) continue;
      triggeredAt = bar.time;
      if (hitTarget || hitStop)
        return {
          outcome: "unclear",
          triggeredAt,
          resolvedAt: bar.time,
          reason: `The candle at ${fmtTime(bar.time)} reached the trigger and the ${hitTarget ? (hitStop ? "target and invalidation" : "target") : "invalidation"}; which came first is unknown.`,
        };
      continue;
    }
    if (hitTarget && hitStop)
      return {
        outcome: "unclear",
        triggeredAt,
        resolvedAt: bar.time,
        reason: `Triggered at ${fmtTime(triggeredAt)}; one candle at ${fmtTime(bar.time)} reached both target and invalidation.`,
      };
    if (hitTarget)
      return {
        outcome: "played-out",
        triggeredAt,
        resolvedAt: bar.time,
        reason: `Triggered at ${fmtTime(triggeredAt)}, reached the target ${fmtPrice(scenario.target!)} at ${fmtTime(bar.time)}.`,
      };
    if (hitStop)
      return {
        outcome: "invalidated",
        triggeredAt,
        resolvedAt: bar.time,
        reason: `Triggered at ${fmtTime(triggeredAt)}, reached the invalidation ${fmtPrice(scenario.invalidation!)} at ${fmtTime(bar.time)}.`,
      };
  }
  return triggeredAt === null
    ? {
        outcome: "not-triggered",
        triggeredAt: null,
        resolvedAt: null,
        reason: `Price never traded at the trigger ${fmtPrice(trigger)}.`,
      }
    : {
        outcome: "triggered",
        triggeredAt,
        resolvedAt: null,
        reason: `Triggered at ${fmtTime(triggeredAt)}; neither target nor invalidation was reached.`,
      };
}

/** A grade saved for one scenario on one day. */
export interface ScenarioReview {
  scenarioId: string;
  outcome: ScenarioOutcome;
  note: string;
}

/** The plan as text for the AI, with each scenario's grade (yours, else the suggestion). */
export function describePlan(
  plan: AnalysisPlan,
  options: {
    playbook?: string | null;
    reviews?: ScenarioReview[];
    suggestions?: Record<string, OutcomeSuggestion>;
  } = {},
): string {
  if (isPlanEmpty(plan)) return "";
  const lines = [
    `Plan: bias ${plan.bias ?? "not set"}${options.playbook ? `, playbook ${JSON.stringify(options.playbook)}` : ""}`,
  ];
  for (const s of plan.scenarios) {
    const review = options.reviews?.find((r) => r.scenarioId === s.id);
    const suggestion = options.suggestions?.[s.id];
    const grade = review
      ? `graded by the trader: ${OUTCOME_LABELS[review.outcome]}${review.note ? ` (${JSON.stringify(review.note)})` : ""}`
      : suggestion
        ? `from the candles: ${OUTCOME_LABELS[suggestion.outcome]}. ${suggestion.reason}`
        : "";
    lines.push(
      `- Scenario ${JSON.stringify(s.name || "unnamed")}: ${s.direction} at ${s.trigger === null ? "no set trigger" : fmtPrice(s.trigger)}, target ${s.target === null ? "none" : fmtPrice(s.target)}, invalidation ${s.invalidation === null ? "none" : fmtPrice(s.invalidation)}${s.note ? `, note ${JSON.stringify(s.note)}` : ""}${grade ? `; ${grade}` : ""}`,
    );
  }
  return lines.join("\n");
}

// ── Trades taken from a plan ──

/** How close an entry must be to a scenario's trigger to suggest it (share of the price). */
export const LINK_TOLERANCE = 0.003;

/**
 * The scenario a trade most likely came from: same direction, entered within
 * `LINK_TOLERANCE` of its trigger. Null when none fits; you link it yourself then.
 */
export function suggestScenario(
  plan: AnalysisPlan,
  trade: { direction: Direction; avgEntry: number },
): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const s of plan.scenarios) {
    if (s.direction !== trade.direction || s.trigger === null || s.trigger === 0) continue;
    const distance = Math.abs(trade.avgEntry - s.trigger) / Math.abs(s.trigger);
    if (distance <= LINK_TOLERANCE && (!best || distance < best.distance))
      best = { id: s.id, distance };
  }
  return best?.id ?? null;
}

export interface PlanTradeStats {
  onPlan: { trades: number; netPnl: number };
  offPlan: { trades: number; netPnl: number };
}

/** Trades linked to a plan against the rest, for the day page and the AI. */
export function planTradeStats(
  trades: { key: string; netPnl: number }[],
  linked: ReadonlySet<string>,
): PlanTradeStats {
  const stats: PlanTradeStats = {
    onPlan: { trades: 0, netPnl: 0 },
    offPlan: { trades: 0, netPnl: 0 },
  };
  for (const trade of trades) {
    const side = linked.has(trade.key) ? stats.onPlan : stats.offPlan;
    side.trades += 1;
    side.netPnl += trade.netPnl;
  }
  return stats;
}
