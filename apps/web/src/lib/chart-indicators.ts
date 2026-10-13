import { libraryIndicator } from "./indicator-library";

/** Where an indicator's code comes from. */
export type IndicatorRef =
  { kind: "library"; key: string } | { kind: "script"; id: string } | { kind: "inline" };

type InputValue = string | number | boolean;

/** One indicator on an analysis: its code source, the user's input/prop edits, visibility. */
export interface StoredIndicator {
  /** The chart indicator id (stable across reloads). */
  id: string;
  ref: IndicatorRef;
  title: string;
  /** The code last run, kept so the indicator still loads if its script is deleted. */
  source: string;
  inputs: Record<string, InputValue>;
  props: Record<string, InputValue>;
  visible: boolean;
}

/** A user-written indicator in the shared "My indicators" library. */
export interface ChartScript {
  id: string;
  name: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export const MAX_INDICATORS = 20;
export const MAX_SCRIPT_BYTES = 200_000;
export const MAX_SCRIPT_NAME = 80;
/** Room left for indicators inside the 10 MB save alongside drawings and the snapshot. */
export const MAX_INDICATORS_BYTES = 1024 * 1024;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const bytes = (value: string) => new TextEncoder().encode(value).length;
const isInput = (v: unknown): v is InputValue =>
  typeof v === "string" ? v.length <= 1000 : typeof v === "boolean" || Number.isFinite(v);

const valuesProblem = (value: unknown): boolean =>
  !value ||
  typeof value !== "object" ||
  Array.isArray(value) ||
  Object.keys(value).length > 100 ||
  !Object.entries(value).every(([k, v]) => k.length <= 200 && isInput(v));

/** Plain-language problem with a stored indicator list, or null when valid. */
export function indicatorsProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return "Indicators must be a list.";
  if (value.length > MAX_INDICATORS) return `Keep at most ${MAX_INDICATORS} indicators per chart.`;
  const ids = new Set<string>();
  for (const item of value as unknown[]) {
    const i = item as Partial<StoredIndicator> | null;
    if (!i || typeof i.id !== "string" || !ID.test(i.id) || ids.has(i.id))
      return "An indicator has an invalid id.";
    ids.add(i.id);
    const ref = i.ref as Partial<IndicatorRef> | undefined;
    const refOk =
      (ref?.kind === "library" && typeof (ref as { key?: unknown }).key === "string") ||
      (ref?.kind === "script" && typeof (ref as { id?: unknown }).id === "string") ||
      ref?.kind === "inline";
    if (!refOk) return "An indicator has an unknown source.";
    if (typeof i.title !== "string" || i.title.length > 200)
      return "An indicator title is invalid.";
    if (typeof i.source !== "string" || !i.source.trim() || bytes(i.source) > MAX_SCRIPT_BYTES)
      return "An indicator's code is missing or too long.";
    if (valuesProblem(i.inputs) || valuesProblem(i.props))
      return "An indicator has invalid settings.";
    if (typeof i.visible !== "boolean") return "An indicator has invalid visibility.";
  }
  if (bytes(JSON.stringify(value)) > MAX_INDICATORS_BYTES)
    return "The chart's indicators are too large to save.";
  return null;
}

export const parseIndicators = (json: string | null | undefined): StoredIndicator[] => {
  if (!json) return [];
  try {
    const value = JSON.parse(json) as unknown;
    return indicatorsProblem(value) ? [] : (value as StoredIndicator[]);
  } catch {
    return [];
  }
};

/** Problem with a user script, or null when it can be saved. */
export function scriptProblem(input: { name?: unknown; source?: unknown }): string | null {
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > MAX_SCRIPT_NAME)
    return `Name the indicator (up to ${MAX_SCRIPT_NAME} characters).`;
  if (typeof input.source !== "string" || !input.source.trim())
    return "Write the indicator's code.";
  if (bytes(input.source) > MAX_SCRIPT_BYTES) return "The code is longer than 200 KB.";
  return null;
}

/**
 * The code an indicator should run now: the current library or saved script, so editing
 * a script updates every chart using it; the stored copy when that source is gone.
 */
export function resolveSource(indicator: StoredIndicator, scripts: ChartScript[]): string {
  if (indicator.ref.kind === "library")
    return libraryIndicator(indicator.ref.key)?.source ?? indicator.source;
  if (indicator.ref.kind === "script") {
    const id = indicator.ref.id;
    return scripts.find((s) => s.id === id)?.source ?? indicator.source;
  }
  return indicator.source;
}

/** The title from `indicator("…")`, for naming a script from its code. */
export function declaredTitle(source: string): string | null {
  const match = source.match(/\b(?:indicator|strategy)\s*\(\s*(?:title\s*=\s*)?(["'])(.*?)\1/);
  return match?.[2]?.trim() || null;
}

/** Pine errors often carry a line ("line 12"); pull it out to mark the editor. */
export function errorLine(message: string): number | null {
  const match = message.match(/\bline[:\s]+(\d+)/i) ?? message.match(/\((\d+):\d+\)/);
  const line = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(line) && line > 0 ? line : null;
}
