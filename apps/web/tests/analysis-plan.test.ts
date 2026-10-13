import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EMPTY_PLAN,
  describePlan,
  planProblem,
  planTradeStats,
  scenarioWarning,
  suggestOutcome,
  suggestScenario,
  type AnalysisPlan,
  type PlanScenario,
} from "../src/lib/analysis-plan";
import type { MarketBar } from "../src/lib/market-data";

vi.mock("@/server/ai", () => ({ runAi: vi.fn(async () => "Controlled AI response") }));

const T = Date.UTC(2026, 8, 1, 9, 0);
const bar = (i: number, high: number, low: number): MarketBar => ({
  time: T + i * 900_000,
  open: (high + low) / 2,
  high,
  low,
  close: (high + low) / 2,
  volume: 1,
});
const scenario = (patch: Partial<PlanScenario> = {}): PlanScenario => ({
  id: "s1",
  name: "Breakout",
  direction: "long",
  trigger: 100,
  target: 110,
  invalidation: 95,
  note: "",
  ...patch,
});

describe("a plan's scenarios are graded from the day's candles", () => {
  it("plays out when the target comes before the invalidation after triggering", () => {
    const bars = [bar(0, 99, 97), bar(1, 101, 99), bar(2, 106, 100), bar(3, 111, 104)];
    expect(suggestOutcome(scenario(), bars)).toMatchObject({
      outcome: "played-out",
      triggeredAt: T + 900_000,
      resolvedAt: T + 3 * 900_000,
    });
  });

  it("is invalidated when the stop comes first, and shorts read the other way", () => {
    const bars = [bar(0, 101, 99), bar(1, 100, 94)];
    expect(suggestOutcome(scenario(), bars).outcome).toBe("invalidated");
    const short = scenario({ direction: "short", target: 90, invalidation: 104 });
    expect(suggestOutcome(short, [bar(0, 101, 99), bar(1, 100, 89)]).outcome).toBe("played-out");
  });

  it("not triggered, still open, unclear and ungradable are told apart", () => {
    expect(suggestOutcome(scenario(), [bar(0, 99, 97)]).outcome).toBe("not-triggered");
    expect(suggestOutcome(scenario(), [bar(0, 101, 99), bar(1, 105, 99)]).outcome).toBe(
      "triggered",
    );
    // One candle reaching both target and stop can't say which came first.
    expect(suggestOutcome(scenario(), [bar(0, 101, 99), bar(1, 111, 94)]).outcome).toBe("unclear");
    expect(suggestOutcome(scenario({ trigger: null }), [bar(0, 101, 99)]).outcome).toBe("unclear");
  });

  it("a trigger candle that also reaches the target or the invalidation is unclear", () => {
    const s = scenario({ trigger: 100, target: 103, invalidation: 98 });
    // Reached 97.5 in the trigger candle: stopped out, or not yet triggered, unknowable.
    expect(suggestOutcome(s, [bar(0, 101.5, 97.5), bar(1, 104, 100)]).outcome).toBe("unclear");
    // Reached 103.2 in the trigger candle, then pulled back: not "still open".
    const pulled = suggestOutcome(s, [bar(0, 103.2, 99), bar(1, 101, 99.5)]);
    expect(pulled.outcome).toBe("unclear");
    expect(pulled.reason).toContain("reached the trigger and the target");
  });

  it("warns when a scenario's prices sit on the wrong sides", () => {
    expect(scenarioWarning(scenario())).toBeNull();
    expect(scenarioWarning(scenario({ target: 90 }))).toMatch(/target sits above/);
    expect(scenarioWarning(scenario({ direction: "short", target: 90, invalidation: 99 }))).toMatch(
      /invalidation sits above/,
    );
    expect(scenarioWarning(scenario({ trigger: null }))).toBeNull();
  });

  it("validates stored plans", () => {
    expect(planProblem(EMPTY_PLAN)).toBeNull();
    expect(planProblem({ ...EMPTY_PLAN, scenarios: [scenario()] })).toBeNull();
    expect(planProblem({ ...EMPTY_PLAN, bias: "up" })).toMatch(/bias/);
    expect(
      planProblem({ ...EMPTY_PLAN, scenarios: [scenario({ trigger: "100" as never })] }),
    ).toMatch(/numbers/);
    expect(planProblem({ ...EMPTY_PLAN, scenarios: [scenario(), scenario()] })).toMatch(/id/);
  });
});

describe("trades taken from a plan", () => {
  const plan: AnalysisPlan = {
    bias: "long",
    playbookId: null,
    scenarios: [scenario(), scenario({ id: "s2", name: "Retest", trigger: 104 })],
  };

  it("a trade entered near a scenario's trigger, in its direction, suggests it", () => {
    expect(suggestScenario(plan, { direction: "long", avgEntry: 100.2 })).toBe("s1");
    expect(suggestScenario(plan, { direction: "long", avgEntry: 103.9 })).toBe("s2");
    expect(suggestScenario(plan, { direction: "short", avgEntry: 100 })).toBeNull();
    expect(suggestScenario(plan, { direction: "long", avgEntry: 102 })).toBeNull();
  });

  it("counts trades from the plan against the rest", () => {
    const stats = planTradeStats(
      [
        { key: "a", netPnl: 50 },
        { key: "b", netPnl: -20 },
        { key: "c", netPnl: -30 },
      ],
      new Set(["a"]),
    );
    expect(stats).toEqual({
      onPlan: { trades: 1, netPnl: 50 },
      offPlan: { trades: 2, netPnl: -50 },
    });
  });

  it("the AI reads the plan with the trader's grade before the suggestion", () => {
    const text = describePlan(plan, {
      playbook: "Opening range",
      reviews: [{ scenarioId: "s1", outcome: "played-out", note: "clean" }],
      suggestions: { s2: suggestOutcome(plan.scenarios[1]!, [bar(0, 99, 97)]) },
    });
    expect(text).toContain('Plan: bias long, playbook "Opening range"');
    expect(text).toContain('graded by the trader: Played out ("clean")');
    expect(text).toContain(
      "from the candles: Not triggered. Price never traded at the trigger 104.",
    );
    expect(describePlan(EMPTY_PLAN)).toBe("");
  });
});

// ── The journal day: grades, trade links and the recap ──

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-plan-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const {
  db,
  accounts,
  chartAnalyses,
  chartAnalysisSnapshots,
  chartPlanReviews,
  chartTradeLinks,
  executions,
  trades,
} = await import("../src/db");
const { setSetting } = await import("../src/server/settings");
const { insertExecutions } = await import("../src/server/executions");
const { runAi } = await import("../src/server/ai");
const analysesRoute = await import("../src/app/api/analyses/route");
const reviewRoute = await import("../src/app/api/analyses/[id]/snapshots/[day]/review/route");
const tradesRoute = await import("../src/app/api/analyses/[id]/snapshots/[day]/trades/route");
const recapRoute = await import("../src/app/api/ai/recap/route");

const json = (body: unknown, method = "POST") =>
  new Request("http://journal.test/", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = (id: string, day: string) => ({ params: Promise.resolve({ id, day }) });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T08:00:00Z"));
  vi.stubEnv("JOURNAL_PASSWORD", "");
  for (const table of [
    chartTradeLinks,
    chartPlanReviews,
    chartAnalysisSnapshots,
    chartAnalyses,
    trades,
    executions,
    accounts,
  ])
    db.delete(table).run();
  setSetting("timeZone", "UTC");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
afterAll(() => {
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("a journal day grades the plan and links its trades", () => {
  it("grades, links and the recap all see the day's plan", async () => {
    db.insert(accounts)
      .values({ id: "a", name: "Main", kind: "manual", createdAt: "2026-01-01" })
      .run();
    insertExecutions(
      "a",
      [
        {
          symbol: "BTCUSDT",
          side: "buy",
          quantity: 1,
          price: 100.1,
          fee: 0,
          executedAt: "2026-09-01T10:00:00Z",
        },
        {
          symbol: "BTCUSDT",
          side: "sell",
          quantity: 1,
          price: 110,
          fee: 0,
          executedAt: "2026-09-01T12:00:00Z",
        },
      ],
      "manual",
    );
    const plan: AnalysisPlan = { bias: "long", playbookId: null, scenarios: [scenario()] };
    const created = await (
      await analysesRoute.POST(
        json({
          symbol: "BTCUSDT",
          provider: "market-csv",
          resolution: "1h",
          rangeFrom: Date.parse("2026-08-01T00:00:00Z"),
          rangeTo: Date.parse("2026-09-01T08:00:00Z"),
          drawings: { version: 1, drawings: [] },
          plan,
        }),
      )
    ).json();
    const id = created.analysis.id as string;
    expect(created.analysis.plan).toEqual(plan);

    // The day's trade suggests the scenario it was entered at.
    const listed = await (
      await tradesRoute.GET(new Request("http://journal.test/"), ctx(id, "2026-09-01"))
    ).json();
    expect(listed.trades).toHaveLength(1);
    expect(listed.trades[0]).toMatchObject({ link: null, suggestedScenario: "s1" });
    const key = listed.trades[0].key as string;
    const linked = await (
      await tradesRoute.PUT(
        json({ tradeKey: key, linked: true, scenarioId: "s1" }, "PUT"),
        ctx(id, "2026-09-01"),
      )
    ).json();
    expect(linked.trades[0].link).toEqual({ analysisId: id, scenarioId: "s1" });

    // Grades are checked against the day's plan.
    const bad = await reviewRoute.PUT(
      json({ scenarioId: "nope", outcome: "played-out" }, "PUT"),
      ctx(id, "2026-09-01"),
    );
    expect(bad.status).toBe(400);
    await reviewRoute.PUT(
      json({ scenarioId: "s1", outcome: "played-out", note: "textbook" }, "PUT"),
      ctx(id, "2026-09-01"),
    );
    const review = await (
      await reviewRoute.GET(new Request("http://journal.test/"), ctx(id, "2026-09-01"))
    ).json();
    expect(review.reviews).toEqual([{ scenarioId: "s1", outcome: "played-out", note: "textbook" }]);

    vi.setSystemTime(new Date("2026-09-02T08:00:00Z"));
    await recapRoute.POST(json({ date: "2026-09-01", filters: {}, timeZone: "UTC" }));
    const [prompt] = vi.mocked(runAi).mock.calls.at(-1)!;
    expect(prompt).toContain("Plan: bias long");
    expect(prompt).toContain('graded by the trader: Played out ("textbook")');
    expect(prompt).toContain('taken from this plan (scenario "Breakout")');
    expect(prompt).toContain("Trades that day on this symbol: 1 from the plan");
  });
});
