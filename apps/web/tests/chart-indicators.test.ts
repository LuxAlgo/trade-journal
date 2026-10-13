import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PineTS } from "pinets";
import {
  declaredTitle,
  errorLine,
  indicatorsProblem,
  resolveSource,
  scriptProblem,
  type StoredIndicator,
} from "../src/lib/chart-indicators";
import { INDICATOR_LIBRARY, NEW_INDICATOR_TEMPLATE } from "../src/lib/indicator-library";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-indicators-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, chartAnalyses, chartScripts } = await import("../src/db");
const scriptsRoute = await import("../src/app/api/chart-scripts/route");
const scriptRoute = await import("../src/app/api/chart-scripts/[id]/route");
const analysesRoute = await import("../src/app/api/analyses/route");
const analysisRoute = await import("../src/app/api/analyses/[id]/route");

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  db.delete(chartScripts).run();
  db.delete(chartAnalyses).run();
});
afterAll(() => {
  vi.unstubAllEnvs();
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

const json = (url: string, body: unknown, method = "POST") =>
  new Request(`http://journal.test${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const context = (id: string) => ({ params: Promise.resolve({ id }) });

// A trending, oscillating hourly series long enough for a 200-bar EMA.
const candles = Array.from({ length: 400 }, (_, i) => {
  const base = 100 + Math.sin(i / 12) * 8 + i * 0.05;
  return {
    open: base,
    high: base + 1.5,
    low: base - 1.5,
    close: base + Math.sin(i) * 0.8,
    volume: 1000 + (i % 7) * 100,
    openTime: Date.UTC(2026, 0, 1) + i * 3_600_000,
  };
});

describe("built-in indicators run on the Pine engine", () => {
  for (const indicator of [
    ...INDICATOR_LIBRARY,
    { key: "template", name: "New indicator template", source: NEW_INDICATOR_TEMPLATE },
  ]) {
    it(`${indicator.name} compiles, runs and plots`, async () => {
      const { plots } = await new PineTS(candles).run(indicator.source);
      const series = Object.entries(plots as Record<string, { data?: { value: unknown }[] }>)
        .filter(([name]) => !name.startsWith("__"))
        .map(([, plot]) => plot.data ?? []);
      expect(series.length).toBeGreaterThan(0);
      for (const data of series) expect(data).toHaveLength(candles.length);
      // At least one plotted series ends on a real number (signals plot booleans).
      expect(
        series.some((data) => {
          const last = data.at(-1)?.value;
          return typeof last === "number" ? Number.isFinite(last) : typeof last === "boolean";
        }),
      ).toBe(true);
    }, 20_000);
  }

  it("names every built-in uniquely and declares its title", () => {
    expect(new Set(INDICATOR_LIBRARY.map((i) => i.key)).size).toBe(INDICATOR_LIBRARY.length);
    for (const indicator of INDICATOR_LIBRARY) expect(declaredTitle(indicator.source)).toBeTruthy();
  });
});

const stored = (overrides: Partial<StoredIndicator> = {}): StoredIndicator => ({
  id: "ind-1",
  ref: { kind: "library", key: "rsi" },
  title: "RSI",
  source: 'indicator("RSI")',
  inputs: { Length: 21 },
  props: {},
  visible: true,
  ...overrides,
});

describe("saved indicators", () => {
  it("accept library, saved-script and inline code with their settings", () => {
    expect(
      indicatorsProblem([
        stored(),
        stored({ id: "ind-2", ref: { kind: "script", id: "abc" } }),
        stored({ id: "ind-3", ref: { kind: "inline" }, visible: false }),
      ]),
    ).toBeNull();
  });

  it("reject duplicates, unknown sources, bad settings and empty code", () => {
    for (const invalid of [
      [stored(), stored()],
      [stored({ ref: { kind: "url" } as never })],
      [stored({ inputs: { Length: Infinity } })],
      [stored({ inputs: { Length: { nested: 1 } } as never })],
      [stored({ source: "  " })],
      Array.from({ length: 21 }, (_, i) => stored({ id: `ind-${i}` })),
    ])
      expect(indicatorsProblem(invalid)).not.toBeNull();
  });

  it("run the current built-in or saved script, and a saved copy once it is gone", () => {
    const library = stored();
    expect(resolveSource(library, [])).toContain('indicator("RSI")');
    expect(resolveSource(library, [])).toContain("ta.rsi");
    const script = stored({ ref: { kind: "script", id: "s1" }, source: "old copy" });
    const scripts = [{ id: "s1", name: "Mine", source: "new code", createdAt: "", updatedAt: "" }];
    expect(resolveSource(script, scripts)).toBe("new code");
    expect(resolveSource(script, [])).toBe("old copy");
    expect(
      resolveSource(stored({ ref: { kind: "library", key: "gone" }, source: "kept" }), []),
    ).toBe("kept");
  });

  it("read a script's declared title and the line of an error", () => {
    expect(declaredTitle('//@version=5\nindicator("My EMA", overlay=true)')).toBe("My EMA");
    expect(declaredTitle("strategy(title='Breakout')")).toBe("Breakout");
    expect(declaredTitle("plot(close)")).toBeNull();
    expect(errorLine("Syntax error at line 12: unexpected token")).toBe(12);
    expect(errorLine("Unexpected token (4:10)")).toBe(4);
    expect(errorLine("undefined variable")).toBeNull();
  });

  it("require a name and code for My indicators", () => {
    expect(scriptProblem({ name: "Mine", source: "plot(close)" })).toBeNull();
    expect(scriptProblem({ name: " ", source: "plot(close)" })).not.toBeNull();
    expect(scriptProblem({ name: "Mine", source: "" })).not.toBeNull();
  });
});

describe("My indicators", () => {
  it("are created, listed, edited and deleted", async () => {
    const created = await scriptsRoute.POST(
      json("/api/chart-scripts", { name: " Breakout ", source: "plot(close)" }),
    );
    expect(created.status).toBe(200);
    const { script } = await created.json();
    expect(script.name).toBe("Breakout");
    const list = await (await scriptsRoute.GET()).json();
    expect(list.scripts.map((s: { id: string }) => s.id)).toEqual([script.id]);
    const patched = await scriptRoute.PATCH(
      json(`/api/chart-scripts/${script.id}`, { source: "plot(open)" }, "PATCH"),
      context(script.id),
    );
    expect((await patched.json()).script).toMatchObject({ name: "Breakout", source: "plot(open)" });
    const removed = await scriptRoute.DELETE(
      new Request("http://journal.test"),
      context(script.id),
    );
    expect(removed.status).toBe(200);
    expect(db.select().from(chartScripts).all()).toHaveLength(0);
  });

  it("refuse a script without a name or code", async () => {
    expect(
      (await scriptsRoute.POST(json("/api/chart-scripts", { name: "", source: "x" }))).status,
    ).toBe(400);
    expect((await scriptsRoute.POST(json("/api/chart-scripts", { name: "x" }))).status).toBe(400);
  });
});

describe("analyses keep their indicators", () => {
  const source = {
    symbol: "TEST",
    provider: "market-csv",
    resolution: "5m",
    rangeFrom: Date.parse("2026-09-01T00:00:00Z"),
    rangeTo: Date.parse("2026-09-02T00:00:00Z"),
    drawings: { version: 1, drawings: [] },
  };

  it("save each indicator's source, inputs and visibility", async () => {
    const indicators = [stored(), stored({ id: "ind-2", visible: false, inputs: { Length: 7 } })];
    const { analysis } = await (
      await analysesRoute.POST(json("/api/analyses", { ...source, indicators }))
    ).json();
    const loaded = await analysisRoute.GET(
      new Request("http://journal.test"),
      context(analysis.id),
    );
    expect((await loaded.json()).analysis.indicators).toEqual(indicators);
  });

  it("open older analyses with no indicators", async () => {
    const { analysis } = await (await analysesRoute.POST(json("/api/analyses", source))).json();
    expect(analysis.indicators).toEqual([]);
  });

  it("reject malformed indicator lists", async () => {
    const response = await analysesRoute.POST(
      json("/api/analyses", { ...source, indicators: [stored({ id: "bad id!" })] }),
    );
    expect(response.status).toBe(400);
  });
});
