import { isResolution, type Resolution } from "./market-data";

/**
 * How charts look and start, kept on the journal server so every browser agrees.
 *
 * A look is stored as the DIFFERENCE from Vela's theme defaults (a partial Vela chart
 * config), never as a full config: settings you never touched keep following the light or
 * dark theme, while the ones you changed stay yours in both.
 */
export type StyleDiff = { [key: string]: StyleValue };
type StyleValue = string | number | boolean | null | StyleDiff;

/** Vela config sections a look may change. Market-, event- and layout-specific ones stay out. */
export const STYLE_SECTIONS = [
  "layout",
  "grid",
  "crosshair",
  "priceScale",
  "animations",
  "panes",
  "margins",
  "candles",
  "bars",
  "line",
  "area",
  "baseline",
  "series",
  "sessions",
] as const;

export interface ChartTemplate {
  id: string;
  name: string;
  style: StyleDiff;
}

export interface SymbolPrefs {
  /** A friendlier name for lists (the provider's symbol is still what is requested). */
  label?: string;
  /** Colour tag in the watchlist. */
  color?: string;
  favorite?: boolean;
  /** Candle size a new chart of this symbol opens with. */
  resolution?: Resolution;
  /** Price decimals on the axis; absent = automatic. */
  decimals?: number;
  /** This symbol's own look, over the default one. */
  style?: StyleDiff;
}

export type LineStyle = "solid" | "dashed" | "dotted";
export type TextSize = "tiny" | "small" | "normal" | "large" | "huge";

/** A drawing tool's starting style. */
export interface ToolStyle {
  lineColor?: string;
  lineWidth?: number;
  lineStyle?: LineStyle;
  fillColor?: string;
  fillOpacity?: number;
  textColor?: string;
  textSize?: TextSize;
}

export type SnapMode = "off" | "weak" | "strong";

export interface ChartDefaults {
  /** Candle size for a symbol opened for the first time. */
  resolution: Resolution;
  /** Charts open streaming or paused. */
  live: boolean;
  volume: boolean;
  /** Time axis zone: the journal's own timezone, UTC or an IANA zone. */
  timeZone: string;
  magnet: SnapMode;
  /** Keep a drawing tool armed after placing a drawing. */
  stayInDrawingMode: boolean;
  /** Save the style you last used with each tool as its new starting style. */
  rememberToolStyles: boolean;
}

export interface ChartPreferences {
  version: 1;
  /** The look every chart starts with. */
  style: StyleDiff;
  templates: ChartTemplate[];
  defaults: ChartDefaults;
  /** Keyed by `provider|symbol`. */
  symbols: Record<string, SymbolPrefs>;
  /** Keyed by Vela drawing type. */
  tools: Record<string, ToolStyle>;
  /** Extra ink colours for the drawing toolbar. */
  palette: string[];
  /** Starred drawing tools, in order. */
  favoriteTools: string[];
}

export const JOURNAL_TIME_ZONE = "journal";

export const DEFAULT_CHART_DEFAULTS: ChartDefaults = {
  resolution: "5m",
  live: true,
  volume: true,
  timeZone: JOURNAL_TIME_ZONE,
  magnet: "off",
  stayInDrawingMode: false,
  rememberToolStyles: true,
};

export const DEFAULT_PREFERENCES: ChartPreferences = {
  version: 1,
  style: {},
  templates: [],
  defaults: DEFAULT_CHART_DEFAULTS,
  symbols: {},
  tools: {},
  palette: [],
  favoriteTools: [],
};

export const symbolPrefsKey = (provider: string, symbol: string) => `${provider}|${symbol}`;

// ── Looks ──

const updown = (up: string, down: string): StyleDiff => ({
  candles: {
    upColor: up,
    downColor: down,
    borderUpColor: up,
    borderDownColor: down,
    wickUpColor: up,
    wickDownColor: down,
  },
  bars: { upColor: up, downColor: down },
  baseline: { topLineColor: up, bottomLineColor: down },
});

/** Ready-made looks; each is a difference from the theme, so all work in light and dark. */
export const BUILT_IN_TEMPLATES: ChartTemplate[] = [
  { id: "builtin-theme", name: "Theme default", style: {} },
  {
    id: "builtin-outline",
    name: "Outline candles",
    style: { candles: { bodyVisible: false, borderVisible: true } },
  },
  {
    id: "builtin-blue-orange",
    name: "Blue and orange",
    style: updown("#2962ff", "#f57c00"),
  },
  { id: "builtin-mono", name: "Monochrome", style: updown("#9aa0ad", "#5d606b") },
  {
    id: "builtin-clean",
    name: "No grid",
    style: { grid: { vertLines: { visible: false }, horzLines: { visible: false } } },
  },
  { id: "builtin-heikin", name: "Heikin Ashi", style: { series: { style: "heikinashi" } } },
  { id: "builtin-line", name: "Line", style: { series: { style: "line" } } },
  { id: "builtin-area", name: "Area", style: { series: { style: "area" } } },
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Deep merge: `over` wins, objects merge key by key. */
export function mergeStyle(base: StyleDiff, over: StyleDiff): StyleDiff {
  const out: StyleDiff = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = out[key];
    out[key] =
      isObject(value) && isObject(current)
        ? mergeStyle(current as StyleDiff, value as StyleDiff)
        : value;
  }
  return out;
}

/** The settings in `current` that differ from `base`, within the look sections. */
export function styleDiff(base: unknown, current: unknown): StyleDiff {
  const walk = (a: unknown, b: unknown): StyleValue | undefined => {
    if (isObject(b)) {
      const out: StyleDiff = {};
      for (const [key, value] of Object.entries(b)) {
        const diff = walk(isObject(a) ? a[key] : undefined, value);
        if (diff !== undefined) out[key] = diff;
      }
      return Object.keys(out).length ? out : undefined;
    }
    if (b === a) return undefined;
    if (typeof b === "string" || typeof b === "number" || typeof b === "boolean" || b === null)
      return b;
    return undefined;
  };
  const out: StyleDiff = {};
  if (!isObject(current)) return out;
  for (const section of STYLE_SECTIONS) {
    const diff = walk(isObject(base) ? base[section] : undefined, current[section]);
    if (diff !== undefined) out[section] = diff;
  }
  return out;
}

/** Read one setting from a config (or a look over it) by dot path. */
export function styleValue(config: unknown, path: string): unknown {
  let node: unknown = config;
  for (const part of path.split(".")) {
    if (!isObject(node)) return undefined;
    node = node[part];
  }
  return node;
}

/** A look with one setting (dot path) changed. */
export function withStyleValue(style: StyleDiff, path: string, value: StyleValue): StyleDiff {
  const parts = path.split(".");
  const patch: StyleDiff = {};
  let node = patch;
  parts.forEach((part, i) => {
    if (i === parts.length - 1) node[part] = value;
    else node = node[part] = {};
  });
  return mergeStyle(style, patch);
}

/** The look a chart of this symbol uses: the default, then the symbol's own. */
export const effectiveStyle = (prefs: ChartPreferences, key: string | null): StyleDiff =>
  key && prefs.symbols[key]?.style
    ? mergeStyle(prefs.style, prefs.symbols[key]!.style!)
    : prefs.style;

export const templatesOf = (prefs: ChartPreferences) => [...BUILT_IN_TEMPLATES, ...prefs.templates];

// ── Validation ──

const KEY = /^[A-Za-z0-9_-]{1,40}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]{5,40}\))$/;
const MAX_STYLE_BYTES = 16 * 1024;
export const MAX_TEMPLATES = 50;
export const MAX_SYMBOLS = 500;
export const MAX_PALETTE = 24;

export const isColor = (value: unknown): value is string =>
  typeof value === "string" && COLOR.test(value);

export function styleProblem(value: unknown): string | null {
  if (!isObject(value)) return "A chart look must be an object.";
  const walk = (node: Record<string, unknown>, depth: number): boolean =>
    depth <= 4 &&
    Object.entries(node).every(
      ([key, v]) =>
        KEY.test(key) &&
        (isObject(v)
          ? walk(v, depth + 1)
          : v === null ||
            typeof v === "boolean" ||
            (typeof v === "number" && Number.isFinite(v)) ||
            (typeof v === "string" && v.length <= 64)),
    );
  if (!Object.keys(value).every((k) => (STYLE_SECTIONS as readonly string[]).includes(k)))
    return "A chart look has an unknown section.";
  if (!walk(value, 1)) return "A chart look has an invalid setting.";
  if (JSON.stringify(value).length > MAX_STYLE_BYTES) return "A chart look is too large.";
  return null;
}

const LINE_STYLES = new Set(["solid", "dashed", "dotted"]);
const TOOL_FIELDS = [
  "lineColor",
  "lineWidth",
  "lineStyle",
  "fillColor",
  "fillOpacity",
  "textColor",
  "textSize",
] as const;
const TEXT_SIZES = new Set(["tiny", "small", "normal", "large", "huge"]);

export function toolStyleProblem(value: unknown): string | null {
  if (!isObject(value)) return "A tool style must be an object.";
  const v = value as ToolStyle & Record<string, unknown>;
  if (!Object.keys(v).every((k) => (TOOL_FIELDS as readonly string[]).includes(k)))
    return "A tool style has an unknown field.";
  for (const key of ["lineColor", "fillColor", "textColor"] as const)
    if (v[key] !== undefined && !isColor(v[key])) return "A tool colour is invalid.";
  if (
    v.lineWidth !== undefined &&
    !(Number.isInteger(v.lineWidth) && v.lineWidth >= 1 && v.lineWidth <= 20)
  )
    return "A tool width is invalid.";
  if (
    v.fillOpacity !== undefined &&
    !(typeof v.fillOpacity === "number" && v.fillOpacity >= 0 && v.fillOpacity <= 1)
  )
    return "A tool fill opacity is invalid.";
  if (v.lineStyle !== undefined && !LINE_STYLES.has(v.lineStyle))
    return "A tool line style is invalid.";
  if (v.textSize !== undefined && !TEXT_SIZES.has(v.textSize))
    return "A tool text size is invalid.";
  return null;
}

const isTimeZone = (value: unknown): value is string => {
  if (value === JOURNAL_TIME_ZONE) return true;
  if (typeof value !== "string" || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

export function preferencesProblem(value: unknown): string | null {
  if (!isObject(value)) return "Chart preferences must be an object.";
  const p = value as Partial<ChartPreferences>;
  if (p.version !== 1) return "Unsupported chart preferences.";
  const style = styleProblem(p.style);
  if (style) return style;
  if (!Array.isArray(p.templates) || p.templates.length > MAX_TEMPLATES)
    return `Keep at most ${MAX_TEMPLATES} saved looks.`;
  const ids = new Set<string>();
  for (const t of p.templates as unknown[]) {
    const template = t as Partial<ChartTemplate>;
    if (
      !isObject(t) ||
      typeof template.id !== "string" ||
      !ID.test(template.id) ||
      ids.has(template.id)
    )
      return "A saved look has an invalid id.";
    ids.add(template.id);
    if (typeof template.name !== "string" || !template.name.trim() || template.name.length > 60)
      return "A saved look needs a name of up to 60 characters.";
    const problem = styleProblem(template.style);
    if (problem) return problem;
  }
  const d = p.defaults as Partial<ChartDefaults> | undefined;
  if (!isObject(d)) return "Chart defaults are missing.";
  if (!isResolution(d.resolution)) return "Choose a supported default candle size.";
  for (const key of ["live", "volume", "stayInDrawingMode", "rememberToolStyles"] as const)
    if (typeof d[key] !== "boolean") return "A chart default is invalid.";
  if (!isTimeZone(d.timeZone)) return "Choose a valid chart time zone.";
  if (!["off", "weak", "strong"].includes(d.magnet as string)) return "Choose a magnet mode.";
  if (!isObject(p.symbols) || Object.keys(p.symbols).length > MAX_SYMBOLS)
    return `Keep settings for at most ${MAX_SYMBOLS} symbols.`;
  for (const [key, s] of Object.entries(p.symbols)) {
    const sym = s as SymbolPrefs;
    if (key.length > 200 || !isObject(s)) return "A symbol setting is invalid.";
    if (sym.label !== undefined && (typeof sym.label !== "string" || sym.label.length > 60))
      return "A symbol name is invalid.";
    if (sym.color !== undefined && !isColor(sym.color)) return "A symbol colour is invalid.";
    if (sym.favorite !== undefined && typeof sym.favorite !== "boolean")
      return "A symbol setting is invalid.";
    if (sym.resolution !== undefined && !isResolution(sym.resolution))
      return "A symbol candle size is invalid.";
    if (
      sym.decimals !== undefined &&
      !(Number.isInteger(sym.decimals) && sym.decimals >= 0 && sym.decimals <= 10)
    )
      return "Price decimals must be between 0 and 10.";
    if (sym.style !== undefined) {
      const problem = styleProblem(sym.style);
      if (problem) return problem;
    }
  }
  if (!isObject(p.tools) || Object.keys(p.tools).length > 200) return "Tool styles are invalid.";
  for (const [type, tool] of Object.entries(p.tools)) {
    if (!KEY.test(type)) return "A tool style has an invalid tool.";
    const problem = toolStyleProblem(tool);
    if (problem) return problem;
  }
  if (!Array.isArray(p.palette) || p.palette.length > MAX_PALETTE || !p.palette.every(isColor))
    return `Keep at most ${MAX_PALETTE} valid ink colours.`;
  if (
    !Array.isArray(p.favoriteTools) ||
    p.favoriteTools.length > 100 ||
    !p.favoriteTools.every((t) => typeof t === "string" && KEY.test(t))
  )
    return "Favourite tools are invalid.";
  return null;
}

/** Stored preferences, or the defaults for anything missing or broken. */
export function parsePreferences(json: string | null | undefined): ChartPreferences {
  if (!json) return DEFAULT_PREFERENCES;
  try {
    const value = JSON.parse(json) as Partial<ChartPreferences>;
    const merged = {
      ...DEFAULT_PREFERENCES,
      ...value,
      defaults: { ...DEFAULT_CHART_DEFAULTS, ...(isObject(value.defaults) ? value.defaults : {}) },
    };
    return preferencesProblem(merged) ? DEFAULT_PREFERENCES : (merged as ChartPreferences);
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** Tick size Vela's price axis expects for a number of decimals. */
export const tickForDecimals = (decimals: number | undefined) =>
  decimals === undefined ? undefined : Number((10 ** -decimals).toFixed(decimals));

// ── Drawing tools ──

/** Tools offered in the defaults editor, with the style fields that matter for each. */
export const TOOL_DEFAULTS: { type: string; label: string; fill?: boolean; text?: boolean }[] = [
  { type: "trendline", label: "Trend line" },
  { type: "ray", label: "Ray" },
  { type: "extendedline", label: "Extended line" },
  { type: "hline", label: "Horizontal line" },
  { type: "hray", label: "Horizontal ray" },
  { type: "vline", label: "Vertical line" },
  { type: "arrow", label: "Arrow" },
  { type: "box", label: "Rectangle", fill: true, text: true },
  { type: "ellipse", label: "Ellipse", fill: true },
  { type: "triangle", label: "Triangle", fill: true },
  { type: "parallelchannel", label: "Parallel channel", fill: true },
  { type: "fibretracement", label: "Fib retracement" },
  { type: "fibextension", label: "Fib extension" },
  { type: "text", label: "Text", text: true },
  { type: "callout", label: "Callout", fill: true, text: true },
  { type: "note", label: "Note", text: true },
  { type: "pricelabel", label: "Price label", text: true },
  { type: "datepricerange", label: "Date and price range" },
  { type: "position", label: "Position" },
];

/** A drawing's style fields as a `ToolStyle` (for remembering the last one used). */
export function toolStyleOf(drawing: {
  style?: Record<string, unknown>;
  text?: { color?: unknown; size?: unknown } | undefined;
}): ToolStyle {
  const s = drawing.style ?? {};
  const out: ToolStyle = {};
  if (isColor(s.lineColor)) out.lineColor = s.lineColor;
  if (
    typeof s.lineWidth === "number" &&
    Number.isInteger(s.lineWidth) &&
    s.lineWidth >= 1 &&
    s.lineWidth <= 20
  )
    out.lineWidth = s.lineWidth;
  if (typeof s.lineStyle === "string" && LINE_STYLES.has(s.lineStyle))
    out.lineStyle = s.lineStyle as LineStyle;
  if (isColor(s.fillColor)) out.fillColor = s.fillColor;
  if (typeof s.fillOpacity === "number" && s.fillOpacity >= 0 && s.fillOpacity <= 1)
    out.fillOpacity = s.fillOpacity;
  if (isColor(drawing.text?.color)) out.textColor = drawing.text!.color as string;
  if (typeof drawing.text?.size === "string" && TEXT_SIZES.has(drawing.text.size))
    out.textSize = drawing.text.size as TextSize;
  return out;
}

export const sameToolStyle = (a: ToolStyle | undefined, b: ToolStyle) =>
  TOOL_FIELDS.every((key) => (a ?? {})[key] === b[key]);
