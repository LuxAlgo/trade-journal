import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analysisIdFromSrc,
  analysisMarkdown,
  appendAnalysisEmbed,
  drawingsProblem,
  maxSpanMs,
  utcDayRange,
  type DrawingsDocument,
} from "../src/lib/chart-analysis";
import { DEFAULT_STYLUS, parseStylusPreference } from "../src/lib/stylus";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-analysis-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, chartAnalyses, journalDays, marketCsvDatasets } = await import("../src/db");
const { importCsvDataset } = await import("../src/server/market-data/csv");
const analysesRoute = await import("../src/app/api/analyses/route");
const analysisRoute = await import("../src/app/api/analyses/[id]/route");
const imageRoute = await import("../src/app/api/analyses/[id]/image/route");
const historyRoute = await import("../src/app/api/market-data/history/route");

const stroke: DrawingsDocument = {
  version: 1,
  drawings: [
    {
      id: "dw-1",
      type: "freehand",
      paneId: "price",
      anchors: [
        { time: Date.parse("2026-09-01T14:30:00Z"), price: 101.5 },
        { time: Date.parse("2026-09-01T14:35:00Z"), price: 102.25 },
      ],
      style: { lineColor: "#2962ff", lineWidth: 2, lineStyle: "solid" },
      locked: false,
      visible: true,
      zIndex: 1,
      createdAt: 1,
    },
  ],
};
// Smallest valid PNG: signature + IHDR + IDAT + IEND for a 1x1 pixel.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const json = (url: string, body: unknown, method = "POST") =>
  new Request(`http://journal.test${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const source = {
  symbol: "TEST",
  provider: "market-csv",
  resolution: "5m",
  rangeFrom: Date.parse("2026-09-01T00:00:00Z"),
  rangeTo: Date.parse("2026-09-02T00:00:00Z"),
  drawings: stroke,
};

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  db.delete(chartAnalyses).run();
  db.delete(journalDays).run();
  db.delete(marketCsvDatasets).run();
});
afterAll(() => {
  vi.unstubAllEnvs();
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("chart analyses embed in journal notes as plain Markdown images", () => {
  const analysis = {
    id: "abc123",
    title: "Opening [range]",
    symbol: "AAPL",
    resolution: "5m" as const,
  };

  it("writes an image whose alt text cannot break out of the Markdown syntax", () => {
    expect(analysisMarkdown(analysis)).toBe(
      "![Opening range chart analysis](/api/analyses/abc123/image)",
    );
    expect(analysisMarkdown({ ...analysis, title: "" })).toBe(
      "![AAPL · 5m chart analysis](/api/analyses/abc123/image)",
    );
  });

  it("recognizes only analysis snapshot URLs as analysis embeds", () => {
    expect(analysisIdFromSrc("/api/analyses/abc123/image")).toBe("abc123");
    expect(analysisIdFromSrc("/api/analyses/abc123/image?v=2")).toBe("abc123");
    expect(analysisIdFromSrc("/api/attachments/abc123")).toBeNull();
    expect(analysisIdFromSrc("https://example.com/api/analyses/abc123/image")).toBeNull();
    expect(analysisIdFromSrc(undefined)).toBeNull();
  });

  it("appends an embed once, keeping the existing note intact", () => {
    const once = appendAnalysisEmbed("## Plan\n\nWatch the open.  \n", analysis);
    expect(once).toBe(
      "## Plan\n\nWatch the open.\n\n![Opening range chart analysis](/api/analyses/abc123/image)\n",
    );
    expect(appendAnalysisEmbed(once, analysis)).toBe(once);
    expect(appendAnalysisEmbed("", analysis)).toBe(`${analysisMarkdown(analysis)}\n`);
  });
});

describe("stored drawings are bounded, time+price anchored documents", () => {
  it("accepts Vela drawings documents", () => {
    expect(drawingsProblem(stroke)).toBeNull();
    expect(drawingsProblem({ version: 1, drawings: [] })).toBeNull();
  });

  it("rejects malformed documents before they reach the database", () => {
    const drawing = stroke.drawings[0]!;
    for (const invalid of [
      null,
      { version: 2, drawings: [] },
      { version: 1, drawings: [{ ...drawing, anchors: [{ time: "x", price: 1 }] }] },
      { version: 1, drawings: [{ ...drawing, anchors: [{ time: 1, price: Infinity }] }] },
      { version: 1, drawings: [{ ...drawing, type: "<script>" }] },
      { version: 1, drawings: [drawing, drawing] },
      { version: 1, drawings: [{ ...drawing, style: undefined }] },
    ]) {
      expect(drawingsProblem(invalid)).not.toBeNull();
    }
  });
});

describe("history ranges are whole UTC days within the candle limit", () => {
  it("covers both chosen days and never reaches past now", () => {
    const now = Date.parse("2026-09-10T12:00:00Z");
    expect(utcDayRange("2026-09-01", "2026-09-02", now)).toEqual({
      from: Date.parse("2026-09-01T00:00:00Z"),
      to: Date.parse("2026-09-03T00:00:00Z"),
    });
    expect(utcDayRange("2026-09-09", "2026-09-10", now)?.to).toBe(now);
    expect(utcDayRange("2026-09-03", "2026-09-01", now)).toBeNull();
    expect(utcDayRange("2026-09-11", "2026-09-11", now)).toBeNull();
  });

  it("bounds a request to 20,000 candles at its resolution", () => {
    expect(maxSpanMs("1m")).toBe(20_000 * 60_000);
    expect(maxSpanMs("1d")).toBe(20_000 * 86_400_000);
  });
});

describe("stylus preferences only restore known choices", () => {
  it("falls back to defaults for missing, corrupt or unknown values", () => {
    expect(parseStylusPreference(null)).toEqual(DEFAULT_STYLUS);
    expect(parseStylusPreference("{")).toEqual(DEFAULT_STYLUS);
    expect(
      parseStylusPreference(
        JSON.stringify({ penDraws: false, penTool: "highlighter", color: "red", width: 99 }),
      ),
    ).toEqual({ ...DEFAULT_STYLUS, penDraws: false, penTool: "highlighter" });
  });
});

describe("saved chart analyses", () => {
  it("saves drawings with a PNG snapshot served for journal embeds", async () => {
    const created = await analysesRoute.POST(
      json("/api/analyses", { ...source, title: "Levels", image: PNG }),
    );
    expect(created.status).toBe(200);
    const { analysis } = await created.json();
    expect(analysis).toMatchObject({ title: "Levels", drawingCount: 1, hasImage: true });

    const image = await imageRoute.GET(new Request("http://journal.test"), context(analysis.id));
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await image.arrayBuffer()).slice(1, 4)).toEqual(
      new Uint8Array([0x50, 0x4e, 0x47]),
    );

    const loaded = await analysisRoute.GET(
      new Request("http://journal.test"),
      context(analysis.id),
    );
    expect((await loaded.json()).analysis.drawings).toEqual(stroke);
  });

  it("rejects snapshots that are not PNG images and unknown data sources", async () => {
    const notPng = `data:image/png;base64,${Buffer.from("<svg/>").toString("base64")}`;
    expect(
      (await analysesRoute.POST(json("/api/analyses", { ...source, image: notPng }))).status,
    ).toBe(400);
    expect(
      (await analysesRoute.POST(json("/api/analyses", { ...source, provider: "nowhere" }))).status,
    ).toBe(400);
    expect(db.select().from(chartAnalyses).all()).toHaveLength(0);
  });

  it("adds an analysis to its journal day once, however often it is saved", async () => {
    db.insert(journalDays)
      .values({ date: "2026-09-01", note: "Pre-market plan", updatedAt: "2026-09-01" })
      .run();
    const created = await analysesRoute.POST(
      json("/api/analyses", { ...source, dayDate: "2026-09-01", addToJournal: true }),
    );
    const { analysis } = await created.json();
    const patched = await analysisRoute.PATCH(
      json(`/api/analyses/${analysis.id}`, { drawings: stroke, addToJournal: true }, "PATCH"),
      context(analysis.id),
    );
    expect(patched.status).toBe(200);
    const note = db.select().from(journalDays).get()!.note;
    expect(note.startsWith("Pre-market plan\n\n![TEST · 5m chart analysis]")).toBe(true);
    expect(note.split(`/api/analyses/${analysis.id}/image`)).toHaveLength(2);
  });

  it("clears a snapshot that no longer matches the drawings", async () => {
    const { analysis } = await (
      await analysesRoute.POST(json("/api/analyses", { ...source, image: PNG }))
    ).json();
    const patched = await analysisRoute.PATCH(
      json(`/api/analyses/${analysis.id}`, { drawings: stroke, image: null }, "PATCH"),
      context(analysis.id),
    );
    expect((await patched.json()).analysis.hasImage).toBe(false);
    const image = await imageRoute.GET(new Request("http://journal.test"), context(analysis.id));
    expect(image.status).toBe(404);
  });

  it("refuses drawings too large to arrive intact through the request size limit", () => {
    const anchors = Array.from({ length: 19_000 }, (_, i) => ({ time: i * 1000, price: 100 + i }));
    const heavy = {
      version: 1,
      drawings: Array.from({ length: 12 }, (_, i) => ({
        ...stroke.drawings[0]!,
        id: `dw-${i}`,
        anchors,
      })),
    };
    expect(drawingsProblem(heavy)).toMatch(/too large/);
  });

  it("requires a journal day before adding to the journal", async () => {
    const response = await analysesRoute.POST(
      json("/api/analyses", { ...source, addToJournal: true }),
    );
    expect(response.status).toBe(400);
    expect(db.select().from(journalDays).all()).toHaveLength(0);
  });

  it("keeps the journal text when an analysis is deleted", async () => {
    const { analysis } = await (
      await analysesRoute.POST(
        json("/api/analyses", { ...source, dayDate: "2026-09-01", addToJournal: true, image: PNG }),
      )
    ).json();
    const removed = await analysisRoute.DELETE(
      new Request("http://journal.test"),
      context(analysis.id),
    );
    expect(removed.status).toBe(200);
    expect(db.select().from(journalDays).get()!.note).toContain(analysis.id);
    const image = await imageRoute.GET(new Request("http://journal.test"), context(analysis.id));
    expect(image.status).toBe(404);
  });

  it("lists a day's analyses without loading their drawings", async () => {
    await analysesRoute.POST(json("/api/analyses", { ...source, dayDate: "2026-09-01" }));
    await analysesRoute.POST(json("/api/analyses", { ...source, dayDate: "2026-09-02" }));
    const response = await analysesRoute.GET(
      new Request("http://journal.test/api/analyses?day=2026-09-01"),
    );
    const { analyses } = await response.json();
    expect(analyses).toHaveLength(1);
    expect(analyses[0]).not.toHaveProperty("drawings");
    expect(analyses[0]).toMatchObject({ dayDate: "2026-09-01", hasImage: false });
  });

  it("needs the journal session like every other journal endpoint", async () => {
    vi.stubEnv("JOURNAL_PASSWORD", "test-password");
    const response = await analysesRoute.GET(new Request("http://journal.test/api/analyses"));
    expect(response.status).toBe(401);
  });
});

describe("chart history requests", () => {
  const csv = ["time,open,high,low,close,volume"]
    .concat(
      Array.from({ length: 12 }, (_, i) => {
        const time = new Date(Date.parse("2026-09-01T14:30:00Z") + i * 300_000).toISOString();
        return `${time},${100 + i},${101 + i},${99 + i},${100.5 + i},${1000 + i}`;
      }),
    )
    .join("\n");

  it("returns candles for a symbol without any trade", async () => {
    importCsvDataset({
      name: "Test candles",
      symbol: "TEST",
      resolution: "5m",
      currency: "USD",
      priceBasis: "raw",
      content: csv,
    });
    const response = await historyRoute.POST(
      json("/api/market-data/history", {
        provider: "market-csv",
        symbol: "TEST",
        resolution: "5m",
        from: Date.parse("2026-09-01T00:00:00Z"),
        to: Date.parse("2026-09-02T00:00:00Z"),
      }),
    );
    expect(response.status).toBe(200);
    const history = await response.json();
    expect(history.bars.length).toBeGreaterThan(0);
    expect(history.bars[0]).toMatchObject({ open: 100, close: 100.5 });
  });

  it("rejects unknown data sources as a request error", async () => {
    const response = await historyRoute.POST(
      json("/api/market-data/history", {
        provider: "nowhere",
        symbol: "TEST",
        resolution: "5m",
        from: 1,
        to: 2,
      }),
    );
    expect(response.status).toBe(400);
  });

  it("refuses ranges beyond the candle limit before contacting a provider", async () => {
    const response = await historyRoute.POST(
      json("/api/market-data/history", {
        provider: "market-csv",
        symbol: "TEST",
        resolution: "1m",
        from: Date.parse("2020-01-01T00:00:00Z"),
        to: Date.parse("2026-01-01T00:00:00Z"),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("20,000 candles");
  });

  it("returns the latest candles without dates, anchored to where a candle file ends", async () => {
    importCsvDataset({
      name: "Test candles",
      symbol: "TEST",
      resolution: "5m",
      currency: "USD",
      priceBasis: "raw",
      content: csv,
    });
    const response = await historyRoute.POST(
      json("/api/market-data/history", {
        provider: "market-csv",
        symbol: "TEST",
        resolution: "5m",
        to: Date.now(),
        limit: 5,
      }),
    );
    expect(response.status).toBe(200);
    const { bars } = await response.json();
    expect(bars).toHaveLength(5);
    expect(bars.at(-1)).toMatchObject({ open: 111 });
  });

  it("bounds how many latest candles one request can ask for", async () => {
    const response = await historyRoute.POST(
      json("/api/market-data/history", {
        provider: "market-csv",
        symbol: "TEST",
        resolution: "5m",
        to: Date.now(),
        limit: 50_000,
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("chart analyses keep their drawing layers", () => {
  it("saves folders, layers and assignments with the analysis", async () => {
    const layers = {
      version: 1,
      folders: [{ id: "folder-a", name: "Weekly", visible: false, locked: false, collapsed: true }],
      layers: [
        { id: "layer-main", name: "Main", folderId: null, visible: true, locked: false },
        { id: "layer-b", name: "Supply", folderId: "folder-a", visible: true, locked: true },
      ],
      activeLayerId: "layer-b",
      assignments: { "dw-1": "layer-b" },
    };
    const { analysis } = await (
      await analysesRoute.POST(json("/api/analyses", { ...source, layers }))
    ).json();
    const loaded = await analysisRoute.GET(
      new Request("http://journal.test"),
      context(analysis.id),
    );
    expect((await loaded.json()).analysis.layers).toEqual(layers);
  });

  it("opens older analyses with every drawing on one layer", async () => {
    const { analysis } = await (await analysesRoute.POST(json("/api/analyses", source))).json();
    expect(analysis.layers.layers).toHaveLength(1);
    expect(analysis.layers.activeLayerId).toBe(analysis.layers.layers[0].id);
  });

  it("rejects layers that reference missing folders", async () => {
    const response = await analysesRoute.POST(
      json("/api/analyses", {
        ...source,
        layers: {
          version: 1,
          folders: [],
          layers: [{ id: "l", name: "L", folderId: "ghost", visible: true, locked: false }],
          activeLayerId: "l",
          assignments: {},
        },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("finds a symbol's analyses for reopening its drawings", async () => {
    await analysesRoute.POST(json("/api/analyses", source));
    await analysesRoute.POST(json("/api/analyses", { ...source, symbol: "OTHER" }));
    const response = await analysesRoute.GET(
      new Request("http://journal.test/api/analyses?provider=market-csv&symbol=TEST"),
    );
    const { analyses } = await response.json();
    expect(analyses.map((a: { symbol: string }) => a.symbol)).toEqual(["TEST"]);
  });
});
