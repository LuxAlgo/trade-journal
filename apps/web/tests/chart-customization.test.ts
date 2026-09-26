import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUILT_IN_TEMPLATES,
  DEFAULT_PREFERENCES,
  effectiveStyle,
  mergeStyle,
  parsePreferences,
  preferencesProblem,
  sameToolStyle,
  styleDiff,
  styleValue,
  tickForDecimals,
  toolStyleOf,
  withStyleValue,
  type ChartPreferences,
} from "../src/lib/chart-preferences";
import {
  addFolder,
  addLayer,
  assignDrawings,
  defaultLayers,
  drawingName,
  layersProblem,
  placeFolder,
  placeLayer,
  renameDrawing,
  setLayerColor,
  showEverything,
  soloLayer,
  syncAssignments,
  unlockEverything,
  updateLayer,
} from "../src/lib/chart-layers";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-customization-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db } = await import("../src/db");
const route = await import("../src/app/api/chart-preferences/route");

const themeBase = {
  version: 1,
  layout: { background: "#151619", textColor: "#b2b5be", fontSize: 11 },
  candles: { upColor: "#089981", downColor: "#f23645", bodyVisible: true },
  grid: { vertLines: { visible: true, color: "#20222c" } },
  timeScale: { timezone: "UTC" },
  marks: { visible: true },
};

describe("a chart look is what you changed from the theme", () => {
  it("keeps only the settings that differ, within look sections", () => {
    const current = {
      ...themeBase,
      candles: { ...themeBase.candles, upColor: "#2962ff" },
      grid: { vertLines: { visible: false, color: "#20222c" } },
      marks: { visible: false },
      timeScale: { timezone: "Europe/Madrid" },
    };
    // Event marks and the time zone are not part of a look.
    expect(styleDiff(themeBase, current)).toEqual({
      candles: { upColor: "#2962ff" },
      grid: { vertLines: { visible: false } },
    });
    expect(styleDiff(themeBase, themeBase)).toEqual({});
  });

  it("a look over either theme changes only what it names", () => {
    const light = { ...themeBase, layout: { ...themeBase.layout, background: "#ffffff" } };
    const look = { candles: { upColor: "#2962ff" } };
    expect(styleValue(mergeStyle(light, look), "layout.background")).toBe("#ffffff");
    expect(styleValue(mergeStyle(light, look), "candles.upColor")).toBe("#2962ff");
    expect(styleValue(mergeStyle(light, look), "candles.downColor")).toBe("#f23645");
  });

  it("edits one setting by path", () => {
    expect(
      withStyleValue(
        { grid: { vertLines: { color: "#111111" } } },
        "grid.vertLines.visible",
        false,
      ),
    ).toEqual({
      grid: { vertLines: { color: "#111111", visible: false } },
    });
  });

  it("a symbol's own look goes over the default look", () => {
    const prefs: ChartPreferences = {
      ...DEFAULT_PREFERENCES,
      style: { candles: { upColor: "#2962ff", downColor: "#f57c00" } },
      symbols: { "binance|BTCUSDT": { style: { candles: { upColor: "#ffffff" } } } },
    };
    expect(effectiveStyle(prefs, "binance|BTCUSDT")).toEqual({
      candles: { upColor: "#ffffff", downColor: "#f57c00" },
    });
    expect(effectiveStyle(prefs, "binance|ETHUSDT")).toEqual(prefs.style);
  });

  it("built-in looks are valid differences", () => {
    for (const template of BUILT_IN_TEMPLATES)
      expect(preferencesProblem({ ...DEFAULT_PREFERENCES, style: template.style })).toBeNull();
  });
});

describe("chart preferences are validated before they are stored", () => {
  const valid = (patch: Partial<ChartPreferences>) =>
    preferencesProblem({ ...DEFAULT_PREFERENCES, ...patch });

  it("accepts a full set of preferences", () => {
    expect(
      valid({
        templates: [{ id: "look-1", name: "Mine", style: { layout: { background: "#000000" } } }],
        defaults: { ...DEFAULT_PREFERENCES.defaults, timeZone: "Europe/Madrid", magnet: "strong" },
        symbols: {
          "binance|BTCUSDT": {
            label: "Bitcoin",
            color: "#e11d48",
            favorite: true,
            resolution: "4h",
            decimals: 1,
          },
        },
        tools: { trendline: { lineColor: "#e11d48", lineWidth: 3, lineStyle: "dashed" } },
        palette: ["#123456"],
        favoriteTools: ["fibretracement"],
      }),
    ).toBeNull();
  });

  it("rejects unknown sections, bad colours, zones and sizes", () => {
    expect(valid({ style: { marks: { visible: false } } })).toMatch(/unknown section/);
    expect(valid({ tools: { trendline: { lineColor: "red; drop" } } })).toMatch(/colour/);
    expect(valid({ tools: { trendline: { lineWidth: 99 } } })).toMatch(/width/);
    expect(
      valid({ defaults: { ...DEFAULT_PREFERENCES.defaults, timeZone: "Mars/Olympus" } }),
    ).toMatch(/time zone/);
    expect(valid({ symbols: { k: { decimals: 20 } } })).toMatch(/decimals/);
    expect(valid({ palette: Array(30).fill("#000000") })).toMatch(/ink/);
  });

  it("falls back to defaults for broken or partial stored data", () => {
    expect(parsePreferences("{")).toEqual(DEFAULT_PREFERENCES);
    expect(
      parsePreferences(JSON.stringify({ ...DEFAULT_PREFERENCES, defaults: { volume: false } }))
        .defaults,
    ).toEqual({
      ...DEFAULT_PREFERENCES.defaults,
      volume: false,
    });
  });

  it("turns decimals into the axis tick size", () => {
    expect(tickForDecimals(2)).toBe(0.01);
    expect(tickForDecimals(0)).toBe(1);
    expect(tickForDecimals(undefined)).toBeUndefined();
  });

  it("remembers a drawing's style as its tool style", () => {
    const style = toolStyleOf({
      style: {
        lineColor: "#e11d48",
        lineWidth: 2,
        lineStyle: "dotted",
        fillColor: "#000000",
        fillOpacity: 0.2,
      },
      text: { color: "#ffffff", size: "large" },
    });
    expect(style).toEqual({
      lineColor: "#e11d48",
      lineWidth: 2,
      lineStyle: "dotted",
      fillColor: "#000000",
      fillOpacity: 0.2,
      textColor: "#ffffff",
      textSize: "large",
    });
    expect(
      sameToolStyle({ lineWidth: 2, lineColor: "#e11d48" }, { lineColor: "#e11d48", lineWidth: 2 }),
    ).toBe(true);
  });
});

describe("the chart preferences API", () => {
  beforeEach(() => vi.stubEnv("JOURNAL_PASSWORD", ""));
  const put = (body: unknown) =>
    route.PUT(
      new Request("http://journal.test/api/chart-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  it("starts from defaults and keeps what is saved", async () => {
    expect((await (await route.GET()).json()).preferences).toEqual(DEFAULT_PREFERENCES);
    const next = {
      ...DEFAULT_PREFERENCES,
      style: { candles: { upColor: "#2962ff" } },
      palette: ["#abcdef"],
    };
    expect((await put(next)).status).toBe(200);
    expect((await (await route.GET()).json()).preferences).toEqual(next);
  });

  it("refuses invalid documents without changing the stored ones", async () => {
    const before = (await (await route.GET()).json()).preferences;
    const response = await put({ ...DEFAULT_PREFERENCES, version: 2 });
    expect(response.status).toBe(400);
    expect((await (await route.GET()).json()).preferences).toEqual(before);
  });
});

describe("organising layers", () => {
  const doc = () => {
    let d = addLayer(defaultLayers(), "Levels");
    d = addLayer(d, "Patterns");
    d = addFolder(d, "Weekly");
    return d;
  };

  it("drag a layer before another, into a folder, or out of it", () => {
    const d = doc();
    const [main, levels, patterns] = d.layers.map((l) => l.id);
    expect(placeLayer(d, patterns!, { beforeId: main! }).layers.map((l) => l.id)).toEqual([
      patterns,
      main,
      levels,
    ]);
    const folder = d.folders[0]!.id;
    const inFolder = placeLayer(d, levels!, { folderId: folder });
    expect(inFolder.layers.find((l) => l.id === levels)!.folderId).toBe(folder);
    // Dropped before a layer inside a folder, it joins that folder.
    expect(
      placeLayer(inFolder, main!, { beforeId: levels! }).layers.find((l) => l.id === main)!
        .folderId,
    ).toBe(folder);
    expect(
      placeLayer(inFolder, levels!, { folderId: null }).layers.find((l) => l.id === levels)!
        .folderId,
    ).toBeNull();
  });

  it("reorders folders", () => {
    const d = addFolder(doc(), "Daily");
    const [weekly, daily] = d.folders.map((f) => f.id);
    expect(placeFolder(d, daily!, weekly!).folders.map((f) => f.id)).toEqual([daily, weekly]);
  });

  it("moves several drawings at once, and names them", () => {
    const d = doc();
    const target = d.layers[1]!.id;
    const moved = assignDrawings(d, ["a", "b"], target);
    expect(moved.assignments).toMatchObject({ a: target, b: target });
    const named = renameDrawing(moved, "a", "  Weekly high  ");
    expect(drawingName(named, "a")).toBe("Weekly high");
    expect(drawingName(renameDrawing(named, "a", ""), "a")).toBeNull();
    // Names of deleted drawings are dropped with them.
    expect(syncAssignments(named, ["b"]).names).toEqual({});
    expect(layersProblem(named)).toBeNull();
  });

  it("solo shows one layer; show all and unlock all undo it", () => {
    const d = updateLayer(doc(), doc().layers[0]!.id, { locked: true });
    const target = d.layers[2]!.id;
    const solo = soloLayer(d, target);
    expect(solo.layers.map((l) => l.visible)).toEqual([false, false, true]);
    expect(showEverything(solo).layers.every((l) => l.visible)).toBe(true);
    expect(unlockEverything(d).layers.every((l) => !l.locked)).toBe(true);
  });

  it("layer colours are hex only", () => {
    const d = doc();
    const id = d.layers[0]!.id;
    expect(setLayerColor(d, id, "#16a34a").layers[0]!.color).toBe("#16a34a");
    expect(setLayerColor(d, id, "javascript:").layers[0]!.color).toBeUndefined();
    expect(
      layersProblem({ ...d, layers: [{ ...d.layers[0]!, color: "red" }, ...d.layers.slice(1)] }),
    ).toMatch(/colour/);
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});
