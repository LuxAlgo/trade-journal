import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@/server/ai", () => ({ runAi: vi.fn(async () => "Controlled AI response") }));

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-chart-journal-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const {
  db,
  accounts,
  executions,
  trades,
  missedTrades,
  chartAnalyses,
  journalDays,
  economicEvents,
} = await import("../src/db");
const { insertExecutions } = await import("../src/server/executions");
const { setCalendarEnabled } = await import("../src/server/economic-calendar");
const { marketTransport } = await import("../src/server/market-data/transport");
const { deleteSetting } = await import("../src/server/settings");
const { runAi } = await import("../src/server/ai");
const overlaysRoute = await import("../src/app/api/chart-overlays/route");
const eventsRoute = await import("../src/app/api/economic-events/route");
const analysesRoute = await import("../src/app/api/analyses/route");
const analysisRoute = await import("../src/app/api/analyses/[id]/route");
const recapRoute = await import("../src/app/api/ai/recap/route");
const critiqueRoute = await import("../src/app/api/ai/critique/route");

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const json = (url: string, body: unknown, method = "POST") =>
  new Request(`http://journal.test${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const get = (url: string) => new Request(`http://journal.test${url}`);
const context = (id: string) => ({ params: Promise.resolve({ id }) });

const fill = (symbol: string, side: "buy" | "sell", price: number, at: string) => ({
  symbol,
  side,
  quantity: 1,
  price,
  fee: 0,
  executedAt: at,
});
const zone = {
  id: "zone-1",
  low: 100,
  high: 102,
  kind: "support",
  label: "Weekly demand",
  start: Date.parse("2026-09-01T00:00:00Z"),
  visible: true,
};
const analysis = (patch: Record<string, unknown> = {}) => ({
  symbol: "BTCUSDT",
  provider: "market-csv",
  resolution: "4h",
  rangeFrom: Date.parse("2026-08-01T00:00:00Z"),
  rangeTo: Date.parse("2026-09-02T00:00:00Z"),
  drawings: { version: 1, drawings: [] },
  image: PNG,
  ...patch,
});
const imagesSent = () => vi.mocked(runAi).mock.calls.at(-1)?.[2] ?? [];
const promptSent = () => vi.mocked(runAi).mock.calls.at(-1)![0];

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  vi.unstubAllGlobals();
  marketTransport.clear();
  for (const table of [
    trades,
    executions,
    accounts,
    missedTrades,
    chartAnalyses,
    journalDays,
    economicEvents,
  ])
    db.delete(table).run();
  setCalendarEnabled(false);
  deleteSetting("economicCalendar:fetchedAt");
  deleteSetting("economicCalendar:error");
  db.insert(accounts)
    .values({ id: "a", name: "Main", kind: "manual", createdAt: "2026-01-01", currency: "USD" })
    .run();
  vi.mocked(runAi).mockClear();
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("trades and missed trades on a chart", () => {
  it("a Binance chart shows journal trades on the same coin with their fills", async () => {
    insertExecutions(
      "a",
      [
        fill("BTC/USD", "buy", 100, "2026-09-01T10:00:00Z"),
        fill("BTC/USD", "sell", 110, "2026-09-01T12:00:00Z"),
        fill("BTC/USD", "buy", 105, "2026-09-02T09:00:00Z"),
        fill("ETHUSD", "buy", 50, "2026-09-01T10:00:00Z"),
      ],
      "manual",
    );
    db.insert(missedTrades)
      .values([
        {
          id: "m1",
          symbol: "BTCUSD",
          direction: "short",
          observedAt: "2026-09-01T15:00:00Z",
          entry: 112,
          stop: 115,
          target: 100,
          notes: "",
          createdAt: "2026-09-01",
        },
        {
          id: "m2",
          symbol: "BTCUSD",
          direction: "long",
          observedAt: "2026-08-01T15:00:00Z",
          notes: "",
          createdAt: "2026-08-01",
          archivedAt: "2026-08-02",
        },
      ])
      .run();
    const response = await overlaysRoute.GET(get("/api/chart-overlays?symbol=BTCUSDT"));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.symbols).toEqual(["BTC/USD", "BTCUSD"]);
    expect(data.trades.map((t: { status: string }) => t.status).sort()).toEqual(["open", "win"]);
    const won = data.trades.find((t: { status: string }) => t.status === "win");
    expect(won).toMatchObject({ direction: "long", avgEntry: 100, avgExit: 110, netPnl: 10 });
    expect(won.fills.map((f: { side: string; price: number }) => [f.side, f.price])).toEqual([
      ["buy", 100],
      ["sell", 110],
    ]);
    // Archived missed trades stay off the chart.
    expect(data.missed.map((m: { id: string }) => m.id)).toEqual(["m1"]);
  });

  it("adds journal symbols named by hand and needs a chart symbol", async () => {
    insertExecutions(
      "a",
      [
        fill("MESZ6", "buy", 5000, "2026-09-01T14:00:00Z"),
        fill("MESZ6", "sell", 5010, "2026-09-01T15:00:00Z"),
      ],
      "manual",
    );
    const none = await (await overlaysRoute.GET(get("/api/chart-overlays?symbol=ES1!"))).json();
    expect(none.trades).toEqual([]);
    const added = await (
      await overlaysRoute.GET(get("/api/chart-overlays?symbol=ES1!&extra=MESZ6"))
    ).json();
    expect(added.trades).toHaveLength(1);
    expect((await overlaysRoute.GET(get("/api/chart-overlays"))).status).toBe(400);
  });
});

describe("economic calendar is opt-in and stored locally", () => {
  const feed = [
    {
      title: "CPI m/m",
      country: "USD",
      date: new Date(Date.now() + 86_400_000).toISOString(),
      impact: "High",
      forecast: "0.2%",
      previous: "0.3%",
    },
  ];

  it("never fetches until enabled", async () => {
    const fetcher = vi.fn(async () => Response.json(feed));
    vi.stubGlobal("fetch", fetcher);
    const state = await (await eventsRoute.GET(get("/api/economic-events"))).json();
    expect(state).toMatchObject({ enabled: false, events: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stores events once enabled and refetches at most hourly", async () => {
    const fetcher = vi.fn(async () => Response.json(feed));
    vi.stubGlobal("fetch", fetcher);
    const enabled = await (
      await eventsRoute.POST(json("/api/economic-events", { action: "enable" }))
    ).json();
    expect(enabled.enabled).toBe(true);
    expect(enabled.events).toMatchObject([{ title: "CPI m/m", currency: "USD", impact: "High" }]);
    await eventsRoute.GET(get("/api/economic-events"));
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Refetching the same week updates rows in place.
    await eventsRoute.POST(json("/api/economic-events", { action: "refresh" }));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(db.select().from(economicEvents).all()).toHaveLength(1);
  });

  it("keeps stored events and reports the problem when the feed fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(feed)),
    );
    await eventsRoute.POST(json("/api/economic-events", { action: "enable" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    const state = await (
      await eventsRoute.POST(json("/api/economic-events", { action: "refresh" }))
    ).json();
    expect(state.events).toHaveLength(1);
    expect(state.error).toMatch(/could not be refreshed/);
  });

  it("rejects unknown actions and oversized windows", async () => {
    expect((await eventsRoute.POST(json("/api/economic-events", { action: "x" }))).status).toBe(
      400,
    );
    expect(
      (await eventsRoute.GET(get(`/api/economic-events?from=0&to=${4 * 366 * 86_400_000}`))).status,
    ).toBe(400);
  });
});

describe("support and resistance zones are saved with the analysis", () => {
  it("round-trips zones and rejects invalid ones", async () => {
    const { analysis: created } = await (
      await analysesRoute.POST(json("/api/analyses", analysis({ zones: [zone] })))
    ).json();
    const loaded = await (await analysisRoute.GET(get("/"), context(created.id))).json();
    expect(loaded.analysis.zones).toEqual([zone]);
    const bad = await analysisRoute.PATCH(
      json(`/api/analyses/${created.id}`, { zones: [{ ...zone, high: 90 }] }, "PATCH"),
      context(created.id),
    );
    expect(bad.status).toBe(400);
  });
});

describe("AI reviews see the chart analyses linked to a note", () => {
  const dayTrades = () =>
    insertExecutions(
      "a",
      [
        fill("BTCUSDT", "buy", 100, "2026-09-01T10:00:00Z"),
        fill("BTCUSDT", "sell", 110, "2026-09-01T12:00:00Z"),
      ],
      "manual",
    );
  const recap = (body: Record<string, unknown> = {}) =>
    recapRoute.POST(
      json("/api/ai/recap", { date: "2026-09-01", filters: {}, timeZone: "UTC", ...body }),
    );

  it("a daily recap gets the day's analyses with their notes, zones and snapshots", async () => {
    dayTrades();
    const { analysis: embedded } = await (
      await analysesRoute.POST(
        json("/api/analyses", analysis({ title: "Plan", notes: "Buy the retest", zones: [zone] })),
      )
    ).json();
    await analysesRoute.POST(
      json("/api/analyses", analysis({ title: "Day chart", dayDate: "2026-09-01" })),
    );
    db.insert(journalDays)
      .values({
        date: "2026-09-01",
        note: `My plan\n\n![Plan](/api/analyses/${embedded.id}/image)`,
        updatedAt: "2026-09-01",
      })
      .run();
    const response = await recap();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.analyses.map((a: { label: string }) => a.label)).toEqual(["Plan", "Day chart"]);
    const prompt = promptSent();
    expect(prompt).toContain("Buy the retest");
    expect(prompt).toContain("support 100 to 102");
    expect(prompt).toContain("image 2 attached");
    const images = imagesSent();
    expect(images).toHaveLength(2);
    expect(images[0]!.subarray(1, 4).toString()).toBe("PNG");
  });

  it("the trader can leave analyses out", async () => {
    dayTrades();
    await analysesRoute.POST(json("/api/analyses", analysis({ dayDate: "2026-09-01" })));
    const body = await (await recap({ includeAnalyses: false })).json();
    expect(body.analyses).toEqual([]);
    expect(imagesSent()).toEqual([]);
    expect((await recap({ includeAnalyses: "yes" })).status).toBe(400);
  });

  it("a filtered recap skips the shared note's embeds but keeps day charts of its symbols", async () => {
    dayTrades();
    const { analysis: embedded } = await (
      await analysesRoute.POST(json("/api/analyses", analysis({ title: "In note" })))
    ).json();
    await analysesRoute.POST(
      json(
        "/api/analyses",
        analysis({ title: "Other coin", symbol: "ETHUSDT", dayDate: "2026-09-01" }),
      ),
    );
    await analysesRoute.POST(
      json("/api/analyses", analysis({ title: "Same coin", dayDate: "2026-09-01" })),
    );
    db.insert(journalDays)
      .values({
        date: "2026-09-01",
        note: `![x](/api/analyses/${embedded.id}/image)`,
        updatedAt: "2026-09-01",
      })
      .run();
    const body = await (await recap({ filters: { accounts: "a" } })).json();
    expect(body.analyses.map((a: { label: string }) => a.label)).toEqual(["Same coin"]);
  });

  it("a trade critique gets analyses embedded in the trade's notes", async () => {
    dayTrades();
    const [row] = db.select().from(trades).all();
    const { analysis: linked } = await (
      await analysesRoute.POST(
        json("/api/analyses", analysis({ title: "Entry plan", notes: "Stop under 100" })),
      )
    ).json();
    db.update(trades)
      .set({ notes: `Took it early\n\n![Entry plan](/api/analyses/${linked.id}/image?v=1)` })
      .run();
    const body = await (
      await critiqueRoute.POST(json("/api/ai/critique", { key: row!.key }))
    ).json();
    expect(body.analyses).toEqual([{ id: linked.id, label: "Entry plan", image: true }]);
    expect(promptSent()).toContain("Stop under 100");
    expect(promptSent()).toContain("Took it early");
    expect(imagesSent()).toHaveLength(1);

    await critiqueRoute.POST(json("/api/ai/critique", { key: row!.key, includeAnalyses: false }));
    expect(imagesSent()).toEqual([]);
  });

  it("reviews without linked analyses send no images", async () => {
    dayTrades();
    const body = await (await recap()).json();
    expect(body.analyses).toEqual([]);
    expect(imagesSent()).toEqual([]);
    expect(promptSent()).not.toContain("Chart analysis");
  });
});
