export type BrushTool = "freehand" | "highlighter";

export interface StylusPreference {
  /** A pen touching the chart draws even when no tool is armed. */
  penDraws: boolean;
  penTool: BrushTool;
  color: string;
  width: number;
}

/** Ink that reads on both themes; the names carry meaning, not the hue alone. */
export const STYLUS_COLORS = [
  { value: "#2962ff", label: "Blue ink" },
  { value: "#f59e0b", label: "Amber ink" },
  { value: "#e11d48", label: "Red ink" },
  { value: "#16a34a", label: "Green ink" },
  { value: "#a855f7", label: "Violet ink" },
  { value: "#737373", label: "Gray ink" },
] as const;

export const STYLUS_WIDTHS = [
  { value: 1, label: "Fine" },
  { value: 2, label: "Medium" },
  { value: 4, label: "Bold" },
] as const;

export const DEFAULT_STYLUS: StylusPreference = {
  penDraws: true,
  penTool: "freehand",
  color: STYLUS_COLORS[0].value,
  width: 2,
};

export const isBrush = (type: string | null | undefined): type is BrushTool =>
  type === "freehand" || type === "highlighter";

const KEY = "journal-stylus-v1";

/** Accept only known values so a stale or edited preference can't break the toolbar. */
export function parseStylusPreference(raw: string | null): StylusPreference {
  if (!raw) return DEFAULT_STYLUS;
  try {
    const value = JSON.parse(raw) as Partial<StylusPreference>;
    return {
      penDraws: typeof value.penDraws === "boolean" ? value.penDraws : DEFAULT_STYLUS.penDraws,
      penTool: isBrush(value.penTool) ? value.penTool : DEFAULT_STYLUS.penTool,
      color: STYLUS_COLORS.some((c) => c.value === value.color)
        ? value.color!
        : DEFAULT_STYLUS.color,
      width: STYLUS_WIDTHS.some((w) => w.value === value.width)
        ? value.width!
        : DEFAULT_STYLUS.width,
    };
  } catch {
    return DEFAULT_STYLUS;
  }
}

/** Per-browser convenience; a blocked storage only loses the remembered choice. */
export const stylusPreference = {
  read(): StylusPreference {
    try {
      return parseStylusPreference(localStorage.getItem(KEY));
    } catch {
      return DEFAULT_STYLUS;
    }
  },
  write(value: StylusPreference) {
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      // Keep the in-memory choice for this page.
    }
  },
};
