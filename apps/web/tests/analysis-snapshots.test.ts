import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analysisEmbedFromSrc,
  analysisIdFromSrc,
  snapshotMarkdown,
} from "../src/lib/chart-analysis";

vi.mock("@/server/ai", () => ({ runAi: vi.fn(async () => "Controlled AI response") }));

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-snapshots-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, accounts, chartAnalyses, chartAnalysisSnapshots, executions, journalDays, trades } =
  await import("../src/db");
const { setSetting } = await import("../src/server/settings");
const { insertExecutions } = await import("../src/server/executions");
const { runAi } = await import("../src/server/ai");
const analysesRoute = await import("../src/app/api/analyses/route");
const analysisRoute = await import("../src/app/api/analyses/[id]/route");
const historyRoute = await import("../src/app/api/analyses/[id]/snapshots/route");
const snapshotRoute = await import("../src/app/api/analyses/[id]/snapshots/[day]/route");
const imageRoute = await import("../src/app/api/analyses/[id]/snapshots/[day]/image/route");
const dayRoute = await import("../src/app/api/analysis-snapshots/route");
const recapRoute = await import("../src/app/api/ai/recap/route");

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const png = (marker: number) =>
  `data:image/png;base64,${Buffer.concat([PNG_BYTES, Buffer.from([marker])]).toString("base64")}`;
const json = (url: string, body: unknown, method = "POST") =>
  new Request(`http://journal.test${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const get = (url: string) => new Request(`http://journal.test${url}`);
const ctx = (id: string, day?: string) => ({ params: Promise.resolve({ id, day: day! }) });
const drawing = (id: string) => ({
  id,
  type: "horizontal_line",
  paneId: "price",
  anchors: [{ time: Date.parse("2026-09-01T14:30:00Z"), price: 100 }],
  style: { lineColor: "#2962ff", lineWidth: 2, lineStyle: "solid" },
});
const doc = (...ids: string[]) => ({ version: 1, drawings: ids.map(drawing) });
const source = {
  symbol: "BTCUSDT",
  provider: "market-csv",
  resolution: "1h",
  rangeFrom: Date.parse("2026-08-01T00:00:00Z"),
  rangeTo: Date.parse("2026-09-05T00:00:00Z"),
};
/** Pretend the clock reads `iso`. */
const at = (iso: string) => vi.setSystemTime(new Date(iso));

const create = async (body: Record<string, unknown> = {}) =>
  (
    await (
      await analysesRoute.POST(
        json("/api/analyses", { ...source, drawings: doc("a"), image: png(1), ...body }),
      )
    ).json()
  ).analysis as { id: string };
const patch = (id: string, body: Record<string, unknown>) =>
  analysisRoute.PATCH(json(`/api/analyses/${id}`, body, "PATCH"), ctx(id));
const snapshot = async (id: string, day: string) => {
  const response = await snapshotRoute.GET(get("/"), ctx(id, day));
  return response.status === 200 ? (await response.json()).snapshot : null;
};
const image = async (id: string, day: string) => {
  const response = await imageRoute.GET(get("/"), ctx(id, day));
  return response.status === 200 ? new Uint8Array(await response.arrayBuffer()).at(-1) : null;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("JOURNAL_PASSWORD", "");
  for (const table of [chartAnalysisSnapshots, chartAnalyses, journalDays, trades, executions])
    db.delete(table).run();
  setSetting("timeZone", "UTC");
  vi.mocked(runAi).mockClear();
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

describe("each journal day keeps the analysis as it was that day", () => {
  it("today's version follows every save, and earlier days stay frozen", async () => {
    at("2026-09-01T09:00:00Z");
    const { id } = await create();
    at("2026-09-01T15:00:00Z");
    await patch(id, { drawings: doc("a", "b"), notes: "Plan: buy the retest" });
    expect((await snapshot(id, "2026-09-01")).drawings.drawings).toHaveLength(2);

    at("2026-09-02T10:00:00Z");
    await patch(id, { drawings: doc("c"), notes: "Retest failed", image: png(2) });
    const monday = await snapshot(id, "2026-09-01");
    const tuesday = await snapshot(id, "2026-09-02");
    expect(monday.drawings.drawings.map((d: { id: string }) => d.id)).toEqual(["a", "b"]);
    expect(monday.notes).toBe("Plan: buy the retest");
    expect(tuesday.drawings.drawings.map((d: { id: string }) => d.id)).toEqual(["c"]);
    // Pictures too: the new one lands on today only.
    expect(await image(id, "2026-09-01")).toBe(1);
    expect(await image(id, "2026-09-02")).toBe(2);

    const history = await (await historyRoute.GET(get("/"), ctx(id))).json();
    expect(history.snapshots.map((s: { day: string }) => s.day)).toEqual([
      "2026-09-02",
      "2026-09-01",
    ]);
  });

  it("days end at midnight in the journal timezone", async () => {
    setSetting("timeZone", "America/New_York");
    // 02:00 UTC on the 2nd is still the evening of the 1st in New York.
    at("2026-09-02T02:00:00Z");
    const { id } = await create();
    expect(await snapshot(id, "2026-09-01")).not.toBeNull();
    expect(await snapshot(id, "2026-09-02")).toBeNull();
  });

  it("the journal day lists every analysis edited that day", async () => {
    at("2026-09-01T09:00:00Z");
    const first = await create({ title: "BTC plan" });
    const second = await create({ title: "ETH plan", symbol: "ETHUSDT" });
    at("2026-09-02T09:00:00Z");
    await patch(first.id, { notes: "next day" });
    const listed = async (day: string) =>
      (await (await dayRoute.GET(get(`/api/analysis-snapshots?day=${day}`))).json()).snapshots.map(
        (s: { title: string }) => s.title,
      );
    expect(await listed("2026-09-01")).toEqual(["BTC plan", "ETH plan"]);
    expect(await listed("2026-09-02")).toEqual(["BTC plan"]);
    expect((await dayRoute.GET(get("/api/analysis-snapshots?day=nope"))).status).toBe(400);
  });

  it("Add pins the current state to the chosen day and embeds that version in its note", async () => {
    at("2026-09-03T09:00:00Z");
    const { id } = await create({ drawings: doc("x") });
    await patch(id, { dayDate: "2026-09-01", addToJournal: true });
    const note = db.select().from(journalDays).get()!.note;
    expect(note).toContain(`/api/analyses/${id}/snapshots/2026-09-01/image`);
    expect((await snapshot(id, "2026-09-01")).drawings.drawings).toHaveLength(1);
  });

  it("inserting into a day note keeps an existing day version; pinning replaces it", async () => {
    at("2026-09-01T09:00:00Z");
    const { id } = await create({ drawings: doc("old") });
    at("2026-09-02T09:00:00Z");
    await patch(id, { drawings: doc("new") });
    const post = (action: string) =>
      snapshotRoute.POST(json("/", { action }), ctx(id, "2026-09-01"));
    await post("ensure");
    expect((await snapshot(id, "2026-09-01")).drawings.drawings[0].id).toBe("old");
    await post("pin");
    expect((await snapshot(id, "2026-09-01")).drawings.drawings[0].id).toBe("new");
    expect((await post("delete")).status).toBe(400);
  });

  it("an older version can become the live analysis again", async () => {
    at("2026-09-01T09:00:00Z");
    const { id } = await create({ drawings: doc("monday") });
    at("2026-09-02T09:00:00Z");
    await patch(id, { drawings: doc("tuesday") });
    const response = await snapshotRoute.POST(
      json("/", { action: "restore" }),
      ctx(id, "2026-09-01"),
    );
    expect(response.status).toBe(200);
    const live = (await (await analysisRoute.GET(get("/"), ctx(id))).json()).analysis;
    expect(live.drawings.drawings[0].id).toBe("monday");
    // Today's version records the restore; Monday is untouched.
    expect((await snapshot(id, "2026-09-02")).drawings.drawings[0].id).toBe("monday");
    expect(await image(id, "2026-09-02")).toBe(1);
  });

  it("a day's version can be removed, and deleting the analysis removes them all", async () => {
    at("2026-09-01T09:00:00Z");
    const { id } = await create();
    at("2026-09-02T09:00:00Z");
    await patch(id, { notes: "x" });
    expect((await snapshotRoute.DELETE(get("/"), ctx(id, "2026-09-01"))).status).toBe(200);
    expect(await snapshot(id, "2026-09-01")).toBeNull();
    expect(await snapshot(id, "2026-09-02")).not.toBeNull();
    await analysisRoute.DELETE(get("/"), ctx(id));
    expect(db.select().from(chartAnalysisSnapshots).all()).toEqual([]);
  });
});

describe("journal embeds of a day's version", () => {
  it("are recognised apart from live embeds", () => {
    expect(analysisEmbedFromSrc("/api/analyses/abc/snapshots/2026-09-01/image?v=1")).toEqual({
      id: "abc",
      day: "2026-09-01",
    });
    expect(analysisEmbedFromSrc("/api/analyses/abc/image")).toEqual({ id: "abc", day: null });
    expect(analysisIdFromSrc("/api/analyses/abc/snapshots/2026-09-01/image")).toBe("abc");
    expect(analysisEmbedFromSrc("/elsewhere.png")).toBeNull();
    expect(
      snapshotMarkdown({ id: "abc", title: "Plan", symbol: "X", resolution: "1h" }, "2026-09-01"),
    ).toBe("![Plan · 2026-09-01 chart analysis](/api/analyses/abc/snapshots/2026-09-01/image)");
  });
});

describe("AI reviews of a past day see that day's version", () => {
  it("a recap reads the day's notes and picture, not the analysis as it is now", async () => {
    db.delete(accounts).run();
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
          price: 100,
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
    at("2026-09-01T09:00:00Z");
    const { id } = await create({ title: "Plan", notes: "Monday thesis" });
    at("2026-09-03T09:00:00Z");
    await patch(id, { notes: "Rewritten on Wednesday", image: png(3) });
    await recapRoute.POST(
      json("/api/ai/recap", { date: "2026-09-01", filters: {}, timeZone: "UTC" }),
    );
    const [prompt, , images] = vi.mocked(runAi).mock.calls.at(-1)!;
    expect(prompt).toContain("Monday thesis");
    expect(prompt).not.toContain("Rewritten on Wednesday");
    expect(prompt).toContain("as it stood on journal day 2026-09-01");
    expect(images?.map((b) => b.at(-1))).toEqual([1]);
  });
});
