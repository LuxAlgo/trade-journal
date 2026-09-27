import { describe, expect, it } from "vitest";
import type { StoredDrawing } from "../src/lib/chart-analysis";
import { describeDrawings, drawingFacts, fibPrices, fmtPrice } from "../src/lib/analysis-text";
import {
  analysisLevels,
  describeDay,
  levelOutcome,
  sessionSummary,
  type DayLevel,
} from "../src/lib/day-levels";
import {
  defaultLayers,
  nestDrawings,
  renameDrawing,
  syncAssignments,
  updateLayer,
} from "../src/lib/chart-layers";
import type { MarketBar } from "../src/lib/market-data";

const T = Date.UTC(2026, 8, 25, 12, 0);
const drawing = (
  id: string,
  type: string,
  anchors: [number, number][],
  extra: Partial<StoredDrawing> = {},
): StoredDrawing => ({
  id,
  type,
  paneId: "price",
  anchors: anchors.map(([minutes, price]) => ({ time: T + minutes * 60_000, price })),
  style: {},
  visible: true,
  ...extra,
});
const bar = (
  minutes: number,
  open: number,
  high: number,
  low: number,
  close: number,
): MarketBar => ({
  time: T + minutes * 60_000,
  open,
  high,
  low,
  close,
  volume: 1,
});

describe("chart analyses are described to the AI with their prices", () => {
  it("levels, lines and boxes give their prices and times", () => {
    expect(drawingFacts(drawing("a", "hline", [[0, 84210.5]]))).toBe("at 84210.5");
    expect(
      drawingFacts(
        drawing("b", "trendline", [
          [0, 80000],
          [60, 81500],
        ]),
      ),
    ).toBe("80000 at 2026-09-25 12:00 → 81500 at 2026-09-25 13:00");
    expect(
      drawingFacts(
        drawing("c", "box", [
          [60, 82000],
          [0, 81000],
        ]),
      ),
    ).toBe("81000 to 82000, 2026-09-25 12:00 to 2026-09-25 13:00");
    expect(fmtPrice(0.000012345678)).toBe("0.000012345678");
  });

  it("Fibonacci tools list the prices of their shown levels, as the chart draws them", () => {
    const levels = [
      { ratio: 0, enabled: true },
      { ratio: 0.618, enabled: true, label: "GP" },
      { ratio: 0.786, enabled: false },
      { ratio: 1, enabled: true },
    ];
    const retracement = drawing(
      "f",
      "fibretracement",
      [
        [0, 100],
        [60, 200],
      ],
      { props: { levels } },
    );
    expect(fibPrices(retracement)).toEqual([
      { ratio: 0, price: 100 },
      { ratio: 0.618, price: 161.8, label: "GP" },
      { ratio: 1, price: 200 },
    ]);
    // The trend-based extension projects the first move from the third point.
    const trend = drawing(
      "t",
      "fibextensiontrend",
      [
        [0, 100],
        [60, 150],
        [120, 130],
      ],
      {
        props: { levels: [{ ratio: 1, enabled: true }] },
      },
    );
    expect(fibPrices(trend)).toEqual([{ ratio: 1, price: 180 }]);
  });

  it("Elliott counts list their labelled points in the notation of their degree", () => {
    const impulse = drawing(
      "w",
      "elliottimpulse",
      [
        [0, 100],
        [10, 110],
        [20, 105],
        [30, 125],
        [40, 118],
        [50, 135],
      ],
      { props: { degree: "primary" } },
    );
    const facts = drawingFacts(impulse);
    expect(facts.startsWith("Primary degree: ⓪ 100 at")).toBe(true);
    expect(facts).toContain("⑤ 135 at 2026-09-25 12:50");
  });

  it("nested drawings are indented under their wave, named and numbered like the Layers panel", () => {
    const drawings = [
      drawing("wave", "elliottimpulse", [
        [0, 100],
        [60, 140],
      ]),
      drawing("sub", "elliottimpulse", [
        [0, 100],
        [20, 120],
      ]),
      drawing("level", "hline", [[0, 150]]),
      drawing("gone", "hline", [[0, 90]], { visible: false }),
    ];
    let layers = syncAssignments(
      defaultLayers(),
      drawings.map((d) => d.id),
    );
    layers = renameDrawing(nestDrawings(layers, ["sub"], "wave"), "wave", "Wave (3)");
    const { lines, hidden } = describeDrawings(drawings, layers);
    expect(lines[0]).toMatch(/^1 Elliott impulse \(1-5\) "Wave \(3\)" \[Main\]: /);
    expect(lines[1]).toMatch(/^ {2}1\.1 Elliott impulse/);
    expect(lines[2]).toMatch(/^2 Horizontal line \[Main\]: at 150$/);
    expect(hidden).toBe(1);
    // A hidden layer hides its drawings from the description too.
    const off = updateLayer(layers, "layer-main", { visible: false });
    expect(describeDrawings(drawings, off)).toMatchObject({ lines: [], hidden: 4 });
  });
});

describe("a journal day's price action is judged against the analysis", () => {
  const day = [
    bar(0, 100, 103, 99, 102),
    bar(15, 102, 106, 101, 105),
    bar(30, 105, 105.5, 100.5, 101),
    bar(45, 101, 102, 97, 98),
  ];

  it("summarises the session", () => {
    expect(sessionSummary(day)).toMatchObject({
      open: 100,
      high: 106,
      low: 97,
      close: 98,
      highTime: T + 15 * 60_000,
      lowTime: T + 45 * 60_000,
      range: 9,
    });
    expect(sessionSummary([])).toBeNull();
  });

  it("each level is untouched, held or broken, like a chart zone", () => {
    const outcome = (level: DayLevel) => levelOutcome(level, day).status;
    expect(outcome({ label: "far", low: 120, high: 120 })).toBe("untouched");
    // Wicked into 106 and closed back below: held.
    expect(outcome({ label: "high", low: 106, high: 106 })).toBe("held");
    // Price started above 99.5 and closed below it: broken.
    expect(outcome({ label: "support", low: 99.5, high: 99.5 })).toBe("broken");
    expect(outcome({ label: "zone", low: 97.5, high: 98.5 })).toBe("testing");
  });

  it("takes levels from lines, rays that have started, Fibonacci levels and zones; never hidden ones", () => {
    const drawings = [
      drawing("h", "hline", [[0, 105]]),
      drawing("late", "hray", [[24 * 60, 104]]),
      drawing("x", "hline", [[0, 50]], { visible: false }),
      drawing(
        "f",
        "fibretracement",
        [
          [0, 100],
          [10, 110],
        ],
        {
          props: { levels: [{ ratio: 0.5, enabled: true }] },
        },
      ),
    ];
    const layers = syncAssignments(
      defaultLayers(),
      drawings.map((d) => d.id),
    );
    const zone = {
      id: "z",
      low: 97,
      high: 98,
      kind: "auto" as const,
      label: "demand",
      start: 0,
      visible: true,
    };
    const levels = analysisLevels(
      { drawings: { drawings }, layers, zones: [zone, { ...zone, id: "z2", visible: false }] },
      T + 60 * 60_000,
    );
    expect(levels.map((l) => [l.label, l.low, l.high])).toEqual([
      ["#1 Horizontal line", 105, 105],
      ["#4 Fib retracement 0.5", 105, 105],
      ['Zone "demand"', 97, 98],
    ]);
  });

  it("writes the day as plain facts for the AI", () => {
    const outcomes = [levelOutcome({ label: "Horizontal line", low: 106, high: 106 }, day)];
    const text = describeDay(sessionSummary(day)!, outcomes, 6);
    expect(text).toContain("range 9, 1.50x the average daily range");
    expect(text).toContain("Levels from the analysis: 1 of 1 reached");
    expect(text).toContain("- Horizontal line 106: held (1 rejection), day closed below");
  });
});
