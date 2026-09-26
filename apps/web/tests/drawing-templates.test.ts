import { describe, expect, it } from "vitest";
import {
  BUILT_IN_TEMPLATES,
  drawingTemplatesProblem,
  findTemplate,
  saveTemplate,
  templateFrom,
  templatePatch,
  templatesFor,
} from "../src/lib/drawing-templates";
import {
  DEFAULT_PREFERENCES,
  parsePreferences,
  preferencesProblem,
} from "../src/lib/chart-preferences";
import { LEGACY_PROP } from "../src/lib/pattern-fixes";
import { degreeLabel } from "../src/lib/wave-degrees";

const fib = {
  type: "fibretracement",
  style: { lineColor: "#2962ff", lineWidth: 2, lineStyle: "dashed" },
  props: {
    levels: [
      { ratio: 0, color: "#787b86", enabled: true },
      { ratio: 0.618, color: "#f7c948", enabled: true, label: "GP" },
      { ratio: 0.65, color: "#f7c948", enabled: false },
    ],
    numbersSize: "small",
    labelsSize: "large",
  },
};

describe("a drawing template keeps a tool's look and settings", () => {
  it("captures colours, style and Fibonacci levels, never the points", () => {
    const template = templateFrom(
      { ...fib, props: { ...fib.props, [LEGACY_PROP]: true } },
      " Golden ",
      "t1",
    );
    expect(template).toMatchObject({ id: "t1", name: "Golden", type: "fibretracement" });
    expect(template.style).toEqual(fib.style);
    expect(template.props).toEqual(fib.props);
    expect(template.props).not.toHaveProperty(LEGACY_PROP);
  });

  it("applying one restyles a drawing and keeps its text and point markers", () => {
    const template = templateFrom(fib, "Golden", "t1");
    const target = {
      type: "fibretracement",
      style: { lineColor: "#000000", lineWidth: 1, lineStyle: "solid", fillOpacity: 0.2 },
      text: { value: "my fib", size: "small" },
      props: { levels: [{ ratio: 0.5, color: "#000000", enabled: true }], [LEGACY_PROP]: true },
    };
    const patch = templatePatch({ ...template, text: { size: "large" } }, target);
    expect(patch.style).toEqual({ ...fib.style, fillOpacity: 0.2 });
    expect(patch.text).toEqual({ value: "my fib", size: "large" });
    expect(patch.props?.levels).toEqual(fib.props.levels);
    expect(patch.props?.[LEGACY_PROP]).toBe(true);
    // The template is copied, so editing the drawing later never changes it.
    (patch.props!.levels as { ratio: number }[])[0]!.ratio = 99;
    expect((template.props!.levels as { ratio: number }[])[0]!.ratio).toBe(0);
  });

  it("saving under an existing name for the same tool updates it", () => {
    const first = saveTemplate([], templateFrom(fib, "Golden", "t1"));
    const again = saveTemplate(
      first,
      templateFrom({ ...fib, style: { lineColor: "#ff0000" } }, "golden", "t2"),
    );
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ id: "t1", style: { lineColor: "#ff0000" } });
    expect(
      saveTemplate(again, templateFrom({ ...fib, type: "fibextension" }, "Golden", "t3")),
    ).toHaveLength(2);
  });

  it("each tool lists its built-in templates before yours", () => {
    const mine = templateFrom(fib, "Mine", "t1");
    const list = templatesFor([mine], "fibretracement");
    expect(list.at(-1)).toBe(mine);
    expect(list.slice(0, -1).every((t) => t.builtIn)).toBe(true);
    expect(templatesFor([mine], "elliottimpulse").map((t) => t.props?.degree)).toContain("primary");
    expect(findTemplate([mine], "t1")).toBe(mine);
    expect(findTemplate([], BUILT_IN_TEMPLATES[0]!.id)).toBe(BUILT_IN_TEMPLATES[0]);
  });

  it("built-in templates are valid and uniquely named per tool", () => {
    const keys = BUILT_IN_TEMPLATES.map((t) => t.id);
    expect(new Set(keys).size).toBe(keys.length);
    // Built-ins are not stored, so they pass validation only through their own list.
    expect(drawingTemplatesProblem(BUILT_IN_TEMPLATES, {})).toMatch(/invalid id/);
    const stored = BUILT_IN_TEMPLATES.map(({ builtIn: _b, ...t }, i) => ({ ...t, id: `t${i}` }));
    expect(drawingTemplatesProblem(stored, {})).toBeNull();
  });
});

describe("drawing templates are saved with the chart preferences", () => {
  it("older preferences load with no templates", () => {
    const { drawingTemplates: _t, defaultDrawingTemplates: _d, ...old } = DEFAULT_PREFERENCES;
    const parsed = parsePreferences(JSON.stringify(old));
    expect(parsed.drawingTemplates).toEqual([]);
    expect(parsed.defaultDrawingTemplates).toEqual({});
  });

  it("templates and a tool's default are validated", () => {
    const ok = {
      ...DEFAULT_PREFERENCES,
      drawingTemplates: [templateFrom(fib, "Golden", "t1")],
      defaultDrawingTemplates: {
        fibretracement: "t1",
        elliottimpulse: "builtin:elliottimpulse:primary",
      },
    };
    expect(preferencesProblem(ok)).toBeNull();
    const bad = {
      ...ok,
      drawingTemplates: [{ ...ok.drawingTemplates[0], style: { lineColor: "red; x" } }],
    };
    expect(preferencesProblem(bad)).toMatch(/colour/);
    const huge = {
      ...ok,
      drawingTemplates: [{ ...ok.drawingTemplates[0], props: { x: "y".repeat(20_000) } }],
    };
    expect(preferencesProblem(huge)).toMatch(/too large/);
  });
});

describe("Elliott wave degrees label the count for its size", () => {
  it("each degree has its own notation", () => {
    const impulse = ["0", "1", "2", "3", "4", "5"];
    expect(impulse.map((l) => degreeLabel(l, "primary"))).toEqual(["⓪", "①", "②", "③", "④", "⑤"]);
    expect(impulse.map((l) => degreeLabel(l, "intermediate")).slice(1, 3)).toEqual(["(1)", "(2)"]);
    expect(degreeLabel("4", "cycle")).toBe("IV");
    expect(degreeLabel("3", "minute")).toBe("(iii)");
    expect(degreeLabel("5", "subminuette")).toBe("[v]");
    expect(degreeLabel("B", "primary")).toBe("Ⓑ");
    expect(degreeLabel("C", "minuette")).toBe("c");
    expect(degreeLabel("A", "grand-supercycle")).toBe("((A))");
    expect(degreeLabel("3", undefined)).toBe("3");
  });
});
