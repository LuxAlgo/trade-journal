import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lessonsFrom, weekEnding } from "../src/lib/journal-lessons";

vi.mock("@/server/ai", () => ({ runAi: vi.fn(async () => "Controlled weekly review") }));

describe("lessons come from the Keep and Fix lists in day notes", () => {
  it("reads the lists AI recaps end with, as you edited them", () => {
    const note = `Morning plan: fade the open.

## AI recap

Good patience today.

**Keep**
- Waited for the retest
- **Sized down** after the loss

**Fix:**
1. Moved my stop early
- Waited for the retest

Closing thoughts, not a list.
- not a lesson`;
    expect(lessonsFrom(note)).toEqual({
      keep: ["Waited for the retest", "Sized down after the loss"],
      fix: ["Moved my stop early", "Waited for the retest"],
    });
    expect(lessonsFrom("")).toEqual({ keep: [], fix: [] });
  });

  it("a week is the seven days ending on the chosen day", () => {
    expect(weekEnding("2026-03-01")).toEqual([
      "2026-02-23",
      "2026-02-24",
      "2026-02-25",
      "2026-02-26",
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
    ]);
  });
});

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-weekly-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const {
  db,
  accounts,
  chartAnalyses,
  chartAnalysisSnapshots,
  chartPlanReviews,
  executions,
  journalDays,
  trades,
} = await import("../src/db");
const { setSetting } = await import("../src/server/settings");
const { insertExecutions } = await import("../src/server/executions");
const { runAi } = await import("../src/server/ai");
const weeklyRoute = await import("../src/app/api/ai/weekly/route");
const analysesRoute = await import("../src/app/api/analyses/route");
const analysisRoute = await import("../src/app/api/analyses/[id]/route");
const reviewRoute = await import("../src/app/api/analyses/[id]/snapshots/[day]/review/route");

const post = (body: unknown) =>
  new Request("http://journal.test/api/ai/weekly", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  for (const table of [
    chartPlanReviews,
    chartAnalysisSnapshots,
    chartAnalyses,
    journalDays,
    trades,
    executions,
    accounts,
  ])
    db.delete(table).run();
  setSetting("timeZone", "UTC");
  vi.mocked(runAi).mockClear();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => {
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("the weekly review", () => {
  it("reads the week's trades and the lessons from its day notes", async () => {
    db.insert(accounts)
      .values({ id: "a", name: "Main", kind: "manual", createdAt: "2026-01-01" })
      .run();
    insertExecutions(
      "a",
      [
        {
          symbol: "ES",
          side: "buy",
          quantity: 1,
          price: 100,
          fee: 0,
          executedAt: "2026-09-02T14:00:00Z",
        },
        {
          symbol: "ES",
          side: "sell",
          quantity: 1,
          price: 104,
          fee: 0,
          executedAt: "2026-09-02T15:00:00Z",
        },
      ],
      "manual",
    );
    db.insert(journalDays)
      .values({
        date: "2026-09-03",
        note: "**Fix**\n- Chased the breakout",
        updatedAt: "2026-09-03",
      })
      .run();
    const response = await weeklyRoute.POST(post({ end: "2026-09-06" }));
    expect(response.status).toBe(200);
    const [prompt] = vi.mocked(runAi).mock.calls.at(-1)!;
    expect(prompt).toContain("2026-08-31 to 2026-09-06");
    expect(prompt).toContain("2026-09-02: 1 trade (ES), 1 won, net 4.00; 0 from a plan");
    expect(prompt).toContain("2026-09-03: no closed trades | Fix: Chased the breakout");
  });

  it("counts a day's plan grades, but not those of scenarios since removed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-04T09:00:00Z"));
    const scenario = (id: string) => ({
      id,
      name: id,
      direction: "long",
      trigger: 100,
      target: 110,
      invalidation: 95,
      note: "",
    });
    const created = await (
      await analysesRoute.POST(
        new Request("http://journal.test/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: "ES",
            provider: "market-csv",
            resolution: "1h",
            rangeFrom: Date.parse("2026-08-01T00:00:00Z"),
            rangeTo: Date.parse("2026-09-04T00:00:00Z"),
            drawings: { version: 1, drawings: [] },
            plan: {
              bias: "long",
              playbookId: null,
              scenarios: [scenario("kept"), scenario("dropped")],
            },
          }),
        }),
      )
    ).json();
    const id = created.analysis.id as string;
    const ctx = { params: Promise.resolve({ id, day: "2026-09-04" }) };
    const grade = (scenarioId: string, outcome: string) =>
      reviewRoute.PUT(
        new Request("http://journal.test/", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenarioId, outcome }),
        }),
        ctx,
      );
    await grade("kept", "played-out");
    await grade("dropped", "invalidated");
    await analysisRoute.PATCH(
      new Request("http://journal.test/", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: { bias: "long", playbookId: null, scenarios: [scenario("kept")] },
        }),
      }),
      { params: Promise.resolve({ id }) },
    );
    db.insert(journalDays)
      .values({ date: "2026-09-04", note: "**Keep**\n- Patience", updatedAt: "x" })
      .run();
    await weeklyRoute.POST(post({ end: "2026-09-06" }));
    const [prompt] = vi.mocked(runAi).mock.calls.at(-1)!;
    expect(prompt).toContain("plan scenarios graded: played out");
    expect(prompt).not.toContain("invalidated");
    vi.useRealTimers();
  });

  it("an empty week asks for nothing", async () => {
    const response = await weeklyRoute.POST(post({ end: "2026-09-06" }));
    expect(response.status).toBe(400);
    expect(runAi).not.toHaveBeenCalled();
    expect((await weeklyRoute.POST(post({ end: "soon" }))).status).toBe(400);
  });
});
