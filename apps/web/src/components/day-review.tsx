"use client";

import { useState } from "react";
import { postJson, useApi } from "@/lib/use-api";
import { fmtPrice } from "@/lib/analysis-text";
import {
  OUTCOMES,
  OUTCOME_LABELS,
  planTradeStats,
  type AnalysisPlan,
  type ScenarioOutcome,
  type ScenarioReview,
} from "@/lib/analysis-plan";
import { Pnl } from "./pnl";
import { contextTags } from "@/lib/day-context";
import type { DayPriceAction } from "@/server/day-price-action";
import type { DayTrade } from "@/server/trade-links";

const LEVEL_STATUS: Record<DayPriceAction["levels"][number]["status"], string> = {
  untouched: "not reached",
  held: "held",
  broken: "broken",
  testing: "closed inside",
};

/**
 * One analysis's day in review, loaded when opened: what price did against its levels,
 * each plan scenario's grade (suggested from the day's candles, confirmed by you), and the
 * day's trades on its symbol, linked to the plan or not.
 */
export function DayReview({ analysisId, date }: { analysisId: string; date: string }) {
  const [open, setOpen] = useState(false);
  const base = `/api/analyses/${encodeURIComponent(analysisId)}/snapshots/${date}`;
  const { data: priceData, error: priceError } = useApi<{
    priceAction: DayPriceAction | null;
    problem: string | null;
  }>(open ? `${base}/price-action` : null);
  const { data: reviewData, refresh: refreshReview } = useApi<{
    plan: AnalysisPlan;
    reviews: ScenarioReview[];
    changes: { since: string; list: string[] } | null;
  }>(open ? `${base}/review` : null);
  const { data: tradeData, refresh: refreshTrades } = useApi<{ trades: DayTrade[] }>(
    open ? `${base}/trades` : null,
  );
  const [problem, setProblem] = useState("");
  const action = priceData?.priceAction;
  const plan = reviewData?.plan;
  const trades = tradeData?.trades ?? [];
  const reached = action?.levels.filter((l) => l.status !== "untouched").length ?? 0;

  const save = async (work: () => Promise<unknown>, after: () => void) => {
    setProblem("");
    try {
      await work();
      after();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Could not save.");
    }
  };
  const grade = (scenarioId: string, outcome: ScenarioOutcome | null) =>
    save(() => postJson(`${base}/review`, { scenarioId, outcome }, "PUT"), refreshReview);
  const link = (trade: DayTrade, linked: boolean, scenarioId: string | null) =>
    save(
      () => postJson(`${base}/trades`, { tradeKey: trade.key, linked, scenarioId }, "PUT"),
      refreshTrades,
    );

  return (
    <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
        Day review
        {action
          ? ` · ${action.levels.length ? `${reached} of ${action.levels.length} levels reached` : "no levels drawn"}${action.partial ? " so far" : ""}`
          : ""}
      </summary>
      <div className="mt-2 space-y-3">
        {problem && (
          <p role="alert" className="text-destructive">
            {problem}
          </p>
        )}
        <PriceActionSection
          loading={open && !priceData && !priceError}
          error={priceError}
          data={priceData}
        />
        {plan && plan.scenarios.length > 0 && (
          <section className="space-y-1.5" aria-label="Plan">
            <p className="font-medium">Plan{plan.bias ? ` · ${plan.bias} bias` : ""}</p>
            {plan.scenarios.map((s) => {
              const suggestion = action?.scenarios[s.id];
              const review = reviewData?.reviews.find((r) => r.scenarioId === s.id);
              return (
                <div key={s.id} className="space-y-1 rounded-md border p-2">
                  <p>
                    <span className="font-medium">{s.name || "Unnamed scenario"}</span>{" "}
                    <span className="tnum text-muted-foreground">
                      {s.direction} at {s.trigger === null ? "no trigger" : fmtPrice(s.trigger)}
                      {s.target !== null ? ` · target ${fmtPrice(s.target)}` : ""}
                      {s.invalidation !== null ? ` · invalid at ${fmtPrice(s.invalidation)}` : ""}
                    </span>
                  </p>
                  {suggestion && (
                    <p className="text-muted-foreground">
                      From the candles: {OUTCOME_LABELS[suggestion.outcome]}. {suggestion.reason}
                    </p>
                  )}
                  <label className="flex items-center gap-2">
                    <span className="text-muted-foreground">Your grade</span>
                    <select
                      value={review?.outcome ?? ""}
                      onChange={(e) =>
                        void grade(s.id, (e.target.value || null) as ScenarioOutcome | null)
                      }
                      className="h-7 rounded-md border bg-background px-1"
                    >
                      <option value="">
                        {suggestion
                          ? `Not graded (suggested: ${OUTCOME_LABELS[suggestion.outcome]})`
                          : "Not graded"}
                      </option>
                      {OUTCOMES.map((o) => (
                        <option key={o} value={o}>
                          {OUTCOME_LABELS[o]}
                        </option>
                      ))}
                    </select>
                    {!review && suggestion && suggestion.outcome !== "unclear" && (
                      <button
                        type="button"
                        className="underline"
                        onClick={() => void grade(s.id, suggestion.outcome)}
                      >
                        Accept
                      </button>
                    )}
                  </label>
                </div>
              );
            })}
          </section>
        )}
        {reviewData?.changes && (
          <section className="space-y-1" aria-label="Changes since the previous version">
            <p className="font-medium">Changed since {reviewData.changes.since}</p>
            {reviewData.changes.list.length ? (
              <ul className="list-disc space-y-0.5 pl-4">
                {reviewData.changes.list.map((change, i) => (
                  <li key={i}>{change}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">Nothing: the analysis stood as it was.</p>
            )}
          </section>
        )}
        {open && tradeData && (
          <TradesSection analysisId={analysisId} plan={plan} trades={trades} onLink={link} />
        )}
      </div>
    </details>
  );
}

function PriceActionSection({
  loading,
  error,
  data,
}: {
  loading: boolean;
  error: string | null;
  data: { priceAction: DayPriceAction | null; problem: string | null } | null;
}) {
  if (loading) return <p className="text-muted-foreground">Loading the day&apos;s candles…</p>;
  if (error)
    return (
      <p role="alert" className="text-destructive">
        {error}
      </p>
    );
  if (!data) return null;
  if (data.problem) return <p className="text-muted-foreground">{data.problem}</p>;
  const action = data.priceAction;
  if (!action) return <p className="text-muted-foreground">No candles for this day.</p>;
  return (
    <section className="space-y-1" aria-label="What price did">
      <p className="font-medium">What price did</p>
      <p className="text-muted-foreground">
        {contextTags(action.context).join(" · ")}
        {action.context.news.length ? ` (${action.context.news.join(", ")})` : ""}
      </p>
      <p className="tnum">
        O {fmtPrice(action.summary.open)} · H {fmtPrice(action.summary.high)} · L{" "}
        {fmtPrice(action.summary.low)} · C {fmtPrice(action.summary.close)} (
        {action.summary.change >= 0 ? "+" : "−"}
        {Math.abs(action.summary.changePct * 100).toFixed(2)}%)
        {action.averageRange
          ? ` · range ${(action.summary.range / action.averageRange).toFixed(2)}× average`
          : ""}
      </p>
      {action.levels.length > 0 && (
        <ul className="space-y-0.5">
          {action.levels.map((level, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">
                {level.label}{" "}
                <span className="tnum text-muted-foreground">
                  {level.low === level.high
                    ? fmtPrice(level.low)
                    : `${fmtPrice(level.low)} to ${fmtPrice(level.high)}`}
                </span>
              </span>
              <span className="shrink-0 rounded border px-1.5 text-[11px] uppercase tracking-wide">
                {LEVEL_STATUS[level.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">
        From {action.resolution} candles, in the journal&apos;s time zone. Held: price reached it
        and closed back on the same side; broken: it closed through.
      </p>
    </section>
  );
}

function TradesSection({
  analysisId,
  plan,
  trades,
  onLink,
}: {
  analysisId: string;
  plan: AnalysisPlan | undefined;
  trades: DayTrade[];
  onLink: (trade: DayTrade, linked: boolean, scenarioId: string | null) => void;
}) {
  if (!trades.length)
    return <p className="text-muted-foreground">No trades on this symbol this day.</p>;
  const own = new Set(trades.filter((t) => t.link?.analysisId === analysisId).map((t) => t.key));
  const stats = planTradeStats(trades, own);
  return (
    <section className="space-y-1" aria-label="Trades this day">
      <p className="font-medium">Trades this day</p>
      <p className="text-muted-foreground">
        From this plan: {stats.onPlan.trades} (<Pnl value={stats.onPlan.netPnl} />) · Not from it:{" "}
        {stats.offPlan.trades} (<Pnl value={stats.offPlan.netPnl} />)
      </p>
      <ul className="space-y-1">
        {trades.map((t) => {
          const mine = t.link?.analysisId === analysisId;
          const elsewhere = t.link && !mine;
          return (
            <li key={t.key} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="tnum">
                {t.direction.toUpperCase()} {t.symbol} @ {fmtPrice(t.avgEntry)} ·{" "}
                <Pnl value={t.netPnl} />{" "}
                <span className="text-muted-foreground">
                  {new Date(t.openedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </span>
              <select
                aria-label={`Plan link for the ${t.direction} trade at ${t.avgEntry}`}
                value={mine ? (t.link?.scenarioId ?? "plan") : ""}
                onChange={(e) =>
                  e.target.value === ""
                    ? onLink(t, false, null)
                    : onLink(t, true, e.target.value === "plan" ? null : e.target.value)
                }
                className="h-7 max-w-52 rounded-md border bg-background px-1"
              >
                <option value="">
                  {elsewhere ? "From another analysis" : "Not from this plan"}
                </option>
                <option value="plan">From this plan</option>
                {plan?.scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    Scenario: {s.name || "unnamed"}
                    {t.suggestedScenario === s.id ? " (suggested)" : ""}
                  </option>
                ))}
              </select>
              {!t.link && t.suggestedScenario && (
                <button
                  type="button"
                  className="underline"
                  onClick={() => onLink(t, true, t.suggestedScenario)}
                >
                  Link to the suggested scenario
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
