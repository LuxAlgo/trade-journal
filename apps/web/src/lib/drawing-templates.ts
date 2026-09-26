import { LEGACY_PROP } from "./pattern-fixes";

/**
 * Drawing templates: a named look for one drawing tool, like TradingView's. A template keeps
 * the line and fill style, the text look (not the words) and the tool's own settings, such as
 * a Fibonacci tool's levels (ratio, colour, shown, label) or an Elliott wave's degree.
 * Applying one never moves a drawing. A tool can have a default template for new drawings.
 */

export interface TemplateStyle {
  lineColor?: string;
  lineWidth?: number;
  lineStyle?: "solid" | "dashed" | "dotted";
  fillColor?: string;
  fillOpacity?: number;
  arrowLeft?: boolean;
  arrowRight?: boolean;
}

export interface TemplateText {
  color?: string;
  size?: string;
  hAlign?: string;
  vAlign?: string;
  bold?: boolean;
  italic?: boolean;
}

export interface DrawingTemplate {
  id: string;
  name: string;
  /** Vela drawing type, e.g. `fibretracement`, `elliottimpulse`. */
  type: string;
  style?: TemplateStyle;
  text?: TemplateText;
  /** The tool's own settings (Vela `props`): Fibonacci levels, wave degree, flags… */
  props?: Record<string, unknown>;
  /** Shipped with the journal; can be applied and made default, not changed. */
  builtIn?: boolean;
}

/** The parts of a drawing a template reads and writes. */
export interface TemplateTarget {
  type: string;
  style: Record<string, unknown>;
  text?: Record<string, unknown>;
  props?: Record<string, unknown>;
}

export const MAX_DRAWING_TEMPLATES = 300;
export const MAX_TEMPLATES_PER_TOOL = 40;
const MAX_PROPS_BYTES = 16_000;
const STYLE_KEYS = [
  "lineColor",
  "lineWidth",
  "lineStyle",
  "fillColor",
  "fillOpacity",
  "arrowLeft",
  "arrowRight",
] as const;
const TEXT_KEYS = ["color", "size", "hAlign", "vAlign", "bold", "italic"] as const;
/** Props that describe a drawing's points rather than its look, never copied. */
const GEOMETRY_PROPS = new Set([LEGACY_PROP]);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const pick = <K extends string>(
  source: Record<string, unknown> | undefined,
  keys: readonly K[],
) => {
  const out: Partial<Record<K, unknown>> = {};
  for (const key of keys) if (source?.[key] !== undefined) out[key] = source[key];
  return out;
};

/** A template from a drawing on the chart. */
export function templateFrom(drawing: TemplateTarget, name: string, id: string): DrawingTemplate {
  const props = Object.fromEntries(
    Object.entries(drawing.props ?? {}).filter(([key]) => !GEOMETRY_PROPS.has(key)),
  );
  const text = pick(drawing.text, TEXT_KEYS) as TemplateText;
  return {
    id,
    name: name.trim().slice(0, 60),
    type: drawing.type,
    style: pick(drawing.style, STYLE_KEYS) as TemplateStyle,
    ...(Object.keys(text).length ? { text } : {}),
    ...(Object.keys(props).length ? { props: clone(props) } : {}),
  };
}

/**
 * What applying a template changes on a drawing: its style, the look of its text (the words
 * stay) and its tool settings. Points, and props that describe them, are left alone.
 */
export function templatePatch(template: DrawingTemplate, drawing: TemplateTarget) {
  const kept = Object.fromEntries(
    Object.entries(drawing.props ?? {}).filter(([key]) => GEOMETRY_PROPS.has(key)),
  );
  return {
    style: { ...drawing.style, ...template.style },
    ...(drawing.text && template.text ? { text: { ...drawing.text, ...template.text } } : {}),
    ...(template.props || Object.keys(kept).length
      ? { props: { ...drawing.props, ...clone(template.props ?? {}), ...kept } }
      : {}),
  };
}

/** The templates a tool offers: built-ins first, then yours, each group in its order. */
export const templatesFor = (templates: DrawingTemplate[], type: string) => [
  ...BUILT_IN_TEMPLATES.filter((t) => t.type === type),
  ...templates.filter((t) => t.type === type),
];

export const findTemplate = (templates: DrawingTemplate[], id: string | undefined) =>
  id
    ? (BUILT_IN_TEMPLATES.find((t) => t.id === id) ?? templates.find((t) => t.id === id))
    : undefined;

/** Save a template, replacing one of yours with the same tool and name. */
export function saveTemplate(templates: DrawingTemplate[], next: DrawingTemplate) {
  const same = templates.find(
    (t) => t.type === next.type && t.name.toLowerCase() === next.name.toLowerCase(),
  );
  return same
    ? templates.map((t) => (t === same ? { ...next, id: same.id } : t))
    : [...templates, next];
}

// ── Validation ──

const TYPE = /^[A-Za-z0-9_-]{1,40}$/;
const ID = /^[A-Za-z0-9_:.-]{1,64}$/;
const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\))$/;
const isColor = (v: unknown) => typeof v === "string" && COLOR.test(v);

export function drawingTemplateProblem(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "A drawing template must be an object.";
  const t = value as Partial<DrawingTemplate>;
  if (typeof t.id !== "string" || !ID.test(t.id)) return "A drawing template has an invalid id.";
  if (typeof t.name !== "string" || !t.name.trim() || t.name.length > 60)
    return "A drawing template needs a name of up to 60 characters.";
  if (typeof t.type !== "string" || !TYPE.test(t.type))
    return "A drawing template has an invalid tool.";
  if (t.style !== undefined) {
    if (!t.style || typeof t.style !== "object") return "A drawing template style is invalid.";
    const s = t.style as Record<string, unknown>;
    if (!Object.keys(s).every((k) => (STYLE_KEYS as readonly string[]).includes(k)))
      return "A drawing template style has an unknown field.";
    for (const key of ["lineColor", "fillColor"] as const)
      if (s[key] !== undefined && !isColor(s[key])) return "A drawing template colour is invalid.";
    if (
      s.lineWidth !== undefined &&
      !(typeof s.lineWidth === "number" && s.lineWidth >= 1 && s.lineWidth <= 20)
    )
      return "A drawing template width is invalid.";
    if (s.lineStyle !== undefined && !["solid", "dashed", "dotted"].includes(s.lineStyle as string))
      return "A drawing template line style is invalid.";
    if (
      s.fillOpacity !== undefined &&
      !(typeof s.fillOpacity === "number" && s.fillOpacity >= 0 && s.fillOpacity <= 1)
    )
      return "A drawing template fill opacity is invalid.";
  }
  if (t.text !== undefined) {
    if (!t.text || typeof t.text !== "object") return "A drawing template text is invalid.";
    const x = t.text as Record<string, unknown>;
    if (!Object.keys(x).every((k) => (TEXT_KEYS as readonly string[]).includes(k)))
      return "A drawing template text has an unknown field.";
    if (x.color !== undefined && !isColor(x.color)) return "A drawing template colour is invalid.";
  }
  if (t.props !== undefined) {
    if (!t.props || typeof t.props !== "object" || Array.isArray(t.props))
      return "A drawing template's settings are invalid.";
    if (JSON.stringify(t.props).length > MAX_PROPS_BYTES)
      return "A drawing template's settings are too large.";
  }
  return null;
}

/** Problems with the saved templates and per-tool defaults, or null. */
export function drawingTemplatesProblem(templates: unknown, defaults: unknown): string | null {
  if (!Array.isArray(templates) || templates.length > MAX_DRAWING_TEMPLATES)
    return `Keep at most ${MAX_DRAWING_TEMPLATES} drawing templates.`;
  const ids = new Set<string>();
  const perTool = new Map<string, number>();
  for (const t of templates) {
    const problem = drawingTemplateProblem(t);
    if (problem) return problem;
    const template = t as DrawingTemplate;
    if (ids.has(template.id) || template.id.startsWith("builtin:"))
      return "A drawing template has an invalid id.";
    ids.add(template.id);
    perTool.set(template.type, (perTool.get(template.type) ?? 0) + 1);
    if (perTool.get(template.type)! > MAX_TEMPLATES_PER_TOOL)
      return `Keep at most ${MAX_TEMPLATES_PER_TOOL} templates per tool.`;
  }
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults))
    return "Default drawing templates are invalid.";
  for (const [type, id] of Object.entries(defaults as Record<string, unknown>))
    if (!TYPE.test(type) || typeof id !== "string" || !ID.test(id))
      return "A default drawing template is invalid.";
  return null;
}

// ── Built-in templates ──

const level = (ratio: number, color: string, enabled = true) => ({ ratio, color, enabled });
const GREY = "#787b86";
const RED = "#f23645";
const ORANGE = "#ff9800";
const GREEN = "#4caf50";
const TEAL = "#089981";
const BLUE = "#2962ff";
const PURPLE = "#9c27b0";
const GOLD = "#f7c948";

const fib = (
  id: string,
  type: string,
  name: string,
  levels: ReturnType<typeof level>[],
  style: TemplateStyle = {},
): DrawingTemplate => ({
  id: `builtin:${type}:${id}`,
  name,
  type,
  builtIn: true,
  style,
  props: { levels, numbersSize: "small", labelsSize: "normal" },
});

const RETRACEMENT = "fibretracement";
const EXTENSION = "fibextension";
const TREND_EXTENSION = "fibextensiontrend";

const waves = (degree: string, name: string, color: string, width: number): DrawingTemplate[] =>
  ["elliottimpulse", "elliottcorrection"].map((type) => ({
    id: `builtin:${type}:${degree}`,
    name,
    type,
    builtIn: true,
    style: { lineColor: color, lineWidth: width, lineStyle: "solid" },
    props: { degree },
  }));

export const BUILT_IN_TEMPLATES: DrawingTemplate[] = [
  fib("classic", RETRACEMENT, "Classic levels", [
    level(0, GREY),
    level(0.236, RED),
    level(0.382, ORANGE),
    level(0.5, GREEN),
    level(0.618, TEAL),
    level(0.786, BLUE),
    level(1, GREY),
  ]),
  fib("golden-pocket", RETRACEMENT, "Golden pocket (0.618 to 0.65)", [
    level(0, GREY),
    level(0.382, ORANGE),
    level(0.5, GREEN),
    level(0.618, GOLD),
    level(0.65, GOLD),
    level(0.786, BLUE),
    level(1, GREY),
  ]),
  fib("ote", RETRACEMENT, "Optimal trade entry (0.62 / 0.705 / 0.79)", [
    level(0, GREY),
    level(0.5, GREEN),
    level(0.62, TEAL),
    level(0.705, GOLD),
    level(0.79, TEAL),
    level(1, GREY),
  ]),
  fib("extensions", RETRACEMENT, "Retracement with targets (to 2.618)", [
    level(0, GREY),
    level(0.236, RED),
    level(0.382, ORANGE),
    level(0.5, GREEN),
    level(0.618, TEAL),
    level(0.786, BLUE),
    level(1, GREY),
    level(1.272, BLUE),
    level(1.618, RED),
    level(2.618, PURPLE),
  ]),
  fib(
    "minimal",
    RETRACEMENT,
    "Minimal (0.382 / 0.5 / 0.618), grey",
    [level(0, GREY), level(0.382, GREY), level(0.5, GREY), level(0.618, GREY), level(1, GREY)],
    { lineStyle: "dashed" },
  ),
  ...[EXTENSION, TREND_EXTENSION].flatMap((type) => [
    fib("classic", type, "Classic targets", [
      level(0, GREY),
      level(0.382, ORANGE),
      level(0.618, TEAL),
      level(1, GREY),
      level(1.272, BLUE),
      level(1.618, RED),
      level(2.618, PURPLE),
    ]),
    fib("wave-targets", type, "Wave 3 and 5 targets (1 / 1.618 / 2.618 / 4.236)", [
      level(0, GREY),
      level(0.618, TEAL),
      level(1, GREY),
      level(1.618, RED),
      level(2.618, PURPLE),
      level(4.236, GREEN),
    ]),
  ]),
  ...waves("primary", "Primary ①②③, green", GREEN, 3),
  ...waves("intermediate", "Intermediate (1)(2)(3), blue", BLUE, 2),
  ...waves("minor", "Minor 1 2 3, red", RED, 2),
  ...waves("minute", "Minute (i)(ii)(iii), orange", ORANGE, 1),
  ...waves("minuette", "Minuette i ii iii, purple", PURPLE, 1),
];
