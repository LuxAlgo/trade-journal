import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LiveMessage } from "../src/lib/live-market";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-background-alerts-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, chartAnalyses } = await import("../src/db");
const { alertEvents, alertWatches, pushSubscriptions, alertsDb } =
  await import("../src/server/background-alerts/store");
const { AlertEngine } = await import("../src/server/background-alerts/engine");
const push = await import("../src/server/background-alerts/delivery");
const analysesRoute = await import("../src/app/api/analyses/route");
const analysisRoute = await import("../src/app/api/analyses/[id]/route");
const pushRoute = await import("../src/app/api/alerts/push/route");
const testRoute = await import("../src/app/api/alerts/test/route");
const eventsRoute = await import("../src/app/api/alerts/events/route");
const webhookRoute = await import("../src/app/api/alerts/webhook/route");
const watchRoute = await import("../src/app/api/alerts/watch/route");

const json = (url: string, body: unknown, method = "POST") =>
  new Request(`http://journal.test${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (url: string) => new Request(`http://journal.test${url}`);
const t0 = Date.parse("2026-09-26T10:00:00Z");
const hline = (id: string, price: number) => ({
  id,
  type: "hline",
  paneId: "price",
  anchors: [{ time: t0 - 3_600_000, price }],
  style: { lineColor: "#2962ff", lineWidth: 1, lineStyle: "solid" },
  visible: true,
  locked: false,
});

async function analysis(body: Record<string, unknown> = {}) {
  const response = await analysesRoute.POST(
    json("/api/analyses", {
      symbol: "BTCUSDT",
      provider: "binance",
      resolution: "1m",
      rangeFrom: t0 - 86_400_000,
      rangeTo: t0,
      drawings: { version: 1, drawings: [hline("line-100", 100)] },
      zones: [
        {
          id: "z1",
          low: 110,
          high: 112,
          kind: "auto",
          label: "",
          start: t0 - 86_400_000,
          visible: true,
        },
      ],
      ...body,
    }),
  );
  const { analysis: created } = (await response.json()) as { analysis: { id: string } };
  const watched = await watchRoute.PUT(
    json("/api/alerts/watch", { analysisId: created.id, watched: true }, "PUT"),
  );
  expect(watched.status).toBe(200);
  return created;
}

/** An engine whose price feed and delivery the test drives. */
function harness() {
  const feeds = new Map<string, (m: LiveMessage) => void>();
  const stopped: string[] = [];
  const delivered: { title: string; body: string; url: string; tag: string }[] = [];
  let now = t0;
  const engine = new AlertEngine({
    listen: (_provider, symbol, _resolution, listener) => {
      feeds.set(symbol, listener);
      return () => stopped.push(symbol);
    },
    latest: async () => ({ time: now, close: 50 }),
    deliver: async (n) => {
      delivered.push(n);
      return 2;
    },
    now: () => now,
  });
  const price = (symbol: string, close: number, dt = 1000) => {
    now += dt;
    feeds.get(symbol)?.({ kind: "trades", trades: [[now, close, 1]] });
  };
  return { engine, feeds, stopped, delivered, price, advance: (ms: number) => (now += ms) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  const store = alertsDb();
  store.delete(alertEvents).run();
  store.delete(alertWatches).run();
  store.delete(pushSubscriptions).run();
  db.delete(chartAnalyses).run();
});
afterAll(() => {
  vi.unstubAllEnvs();
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("the server watches alerts while no page is open", () => {
  it("a price crossing a line notifies and is logged", async () => {
    const { id } = await analysis();
    const h = harness();
    h.engine.check();
    expect(h.feeds.has("BTCUSDT")).toBe(true);
    h.price("BTCUSDT", 99);
    h.price("BTCUSDT", 101);
    await flush();
    expect(h.delivered).toEqual([
      {
        title: "Chart alert",
        body: "BTCUSDT crossed above Horizontal line at 100",
        tag: `alert-${id}-line-100`,
        url: `/charts?id=${id}`,
      },
    ]);
    const events = await (
      await eventsRoute.GET(new Request(`http://journal.test/api/alerts/events?analysisId=${id}`))
    ).json();
    expect(events.events).toMatchObject([
      { message: "BTCUSDT crossed above Horizontal line at 100", delivered: 2 },
    ]);
    h.engine.stop();
  });

  it("zones alert on entering and breaking; each alert waits a minute before repeating", async () => {
    await analysis();
    const h = harness();
    h.engine.check();
    h.price("BTCUSDT", 108);
    h.price("BTCUSDT", 111);
    h.price("BTCUSDT", 113);
    await flush();
    expect(h.delivered.map((n) => n.body)).toEqual([
      "BTCUSDT entered the zone 110 to 112",
      "BTCUSDT broke above the zone 110 to 112",
    ]);
    // Back into the zone within the minute: no second "entered".
    h.price("BTCUSDT", 111);
    await flush();
    expect(h.delivered).toHaveLength(2);
    h.advance(61_000);
    h.price("BTCUSDT", 113);
    h.price("BTCUSDT", 111);
    await flush();
    expect(h.delivered.at(-1)!.body).toBe("BTCUSDT entered the zone 110 to 112");
    h.engine.stop();
  });

  it("drawings on hidden layers, and analyses switched off, are not watched", async () => {
    await analysis({
      symbol: "ETHUSDT",
      zones: [],
      layers: {
        version: 1,
        folders: [],
        layers: [{ id: "layer-main", name: "Main", folderId: null, visible: false, locked: false }],
        activeLayerId: "layer-main",
        assignments: { "line-100": "layer-main" },
      },
    });
    const { id } = await analysis();
    const h = harness();
    h.engine.check();
    // Nothing visible to watch on ETHUSDT.
    expect(h.feeds.has("ETHUSDT")).toBe(false);
    expect(h.engine.status().map((w) => w.analysisId)).toEqual([id]);
    // Switching it off stops the watch at the next check.
    await watchRoute.PUT(json("/api/alerts/watch", { analysisId: id, watched: false }, "PUT"));
    h.engine.check();
    expect(h.stopped).toContain("BTCUSDT");
    expect(h.engine.status()).toEqual([]);
    // Deleting an analysis removes its watch too.
    const other = await analysis();
    h.engine.check();
    await analysisRoute.DELETE(get(`/api/analyses/${other.id}`), ctx(other.id));
    h.engine.check();
    expect(h.engine.status()).toEqual([]);
    h.engine.stop();
  });

  it("editing a watched analysis updates its lines without reconnecting", async () => {
    const { id } = await analysis();
    const h = harness();
    h.engine.check();
    // The journal saves the analysis as usual; the watcher notices the new save.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await analysisRoute.PATCH(
      json(
        `/api/analyses/${id}`,
        { drawings: { version: 1, drawings: [hline("line-100", 100), hline("line-90", 90)] } },
        "PATCH",
      ),
      ctx(id),
    );
    h.engine.check();
    expect(h.stopped).toEqual([]);
    h.price("BTCUSDT", 91);
    h.price("BTCUSDT", 89);
    await flush();
    expect(h.delivered.at(-1)!.body).toBe("BTCUSDT crossed below Horizontal line at 90");
    h.engine.stop();
  });

  it("sources without a live feed are polled", async () => {
    await analysis({ provider: "market-csv", symbol: "TEST" });
    const h = harness();
    h.engine.check();
    await flush();
    expect(h.engine.status()[0]).toMatchObject({ symbol: "TEST", state: "polling", lastPrice: 50 });
    h.engine.stop();
  });
});

describe("delivery", () => {
  // A real browser key pair (RFC 8291's example), so messages encrypt as they would live.
  const subscription = (host = "fcm.googleapis.com", path = "abcdefghijklmnop") => ({
    endpoint: `https://${host}/fcm/send/${path}`,
    keys: {
      p256dh:
        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      auth: "BTBZMqHH6r4Tts7J_aSIgg",
    },
  });

  it("only accepts subscriptions to the browsers' push services", () => {
    expect(push.subscriptionProblem(subscription())).toBeNull();
    expect(push.subscriptionProblem(subscription("updates.push.services.mozilla.com"))).toBeNull();
    expect(push.subscriptionProblem(subscription("evil.example.com"))).toMatch(/not supported/);
    expect(
      push.subscriptionProblem({ ...subscription(), endpoint: "http://fcm.googleapis.com/x" }),
    ).toMatch(/not supported/);
  });

  it("pushes to every browser with this server's keys and drops browsers that are gone", async () => {
    // Browsers subscribe with the server's key, so it exists before they do.
    const keys = push.vapidKeys();
    push.saveSubscription(subscription(), "Android Chrome");
    push.saveSubscription(subscription("fcm.googleapis.com", "gone-device-0000"), "Old");
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = vi.spyOn(push.transport, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url, init });
      return new Response(null, { status: url.includes("gone") ? 410 : 201 });
    });
    const delivered = await push.deliver({
      title: "Chart alert",
      body: "x",
      tag: "t",
      url: "/charts",
    });
    expect(delivered).toBe(1);
    const live = calls.find((c) => !c.url.includes("gone"))!;
    const headers = live.init.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.Authorization).toContain(`k=${keys.publicKey}`);
    expect(push.listSubscriptions().map((s) => s.label)).toEqual(["Android Chrome"]);
    fetcher.mockRestore();
  });

  it("also posts to a webhook such as an ntfy topic", async () => {
    await webhookRoute.PUT(
      json("/api/alerts/webhook", { url: "https://ntfy.example/alerts" }, "PUT"),
    );
    const fetcher = vi.spyOn(push.transport, "fetch").mockResolvedValue(new Response("ok"));
    const response = await testRoute.POST();
    expect((await response.json()).delivered).toBe(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://ntfy.example/alerts");
    expect(init.body).toBe("Background alerts reach this device.");
    expect((init.headers as Record<string, string>).Title).toBe("Test alert");
    fetcher.mockRestore();
    await webhookRoute.PUT(json("/api/alerts/webhook", { url: "" }, "PUT"));
    expect(
      (await webhookRoute.PUT(json("/api/alerts/webhook", { url: "ftp://x" }, "PUT"))).status,
    ).toBe(400);
  });

  it("browsers subscribe and unsubscribe through the API", async () => {
    const state = await (await pushRoute.GET()).json();
    expect(state.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    const saved = await pushRoute.POST(
      json("/api/alerts/push", { subscription: subscription(), label: "Phone" }),
    );
    expect(saved.status).toBe(200);
    const listed = await (await pushRoute.GET()).json();
    expect(listed.devices.map((d: { label: string }) => d.label)).toEqual(["Phone"]);
    await pushRoute.DELETE(
      json("/api/alerts/push", { endpoint: subscription().endpoint }, "DELETE"),
    );
    expect((await (await pushRoute.GET()).json()).devices).toEqual([]);
    const refused = await pushRoute.POST(
      json("/api/alerts/push", { subscription: { endpoint: "https://x.test/1" } }),
    );
    expect(refused.status).toBe(400);
  });

  it("switching an analysis on is refused for analyses that don't exist", async () => {
    const response = await watchRoute.PUT(
      json("/api/alerts/watch", { analysisId: "missing", watched: true }, "PUT"),
    );
    expect(response.status).toBe(404);
  });
});
