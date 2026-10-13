import type { DrawingsDocument } from "./chart-analysis";

/**
 * Corrections to Vela's pattern drawing tools (@luxalgo/vela 0.6.x).
 *
 * A wave is the leg between two points, so a pattern of N waves needs N + 1 points. Vela
 * placed the Elliott impulse on five points labelled 1-5 (four waves) and the correction
 * on three points labelled A-C (two waves). The corrected tools add the origin: 0-1-2-3-4-5
 * for the five impulse waves and 0-A-B-C for the three corrective waves.
 *
 * The Shark harmonic already measures the right legs but reused the XABCD labels; its five
 * points are 0, X, A, B, C.
 */
export interface PatternFix {
  type: "elliottimpulse" | "elliottcorrection" | "shark";
  labels: string[];
  /** Point labels a drawing made with the old tool keeps (it has one point fewer). */
  legacyLabels?: string[];
  /** Replacement toolbar icon path: one vertex per point. */
  iconPath?: { from: string; to: string };
}

export const PATTERN_FIXES: PatternFix[] = [
  {
    type: "elliottimpulse",
    labels: ["0", "1", "2", "3", "4", "5"],
    legacyLabels: ["1", "2", "3", "4", "5"],
    iconPath: { from: "M3 19 8 9 12 13 17 5 21 9", to: "M2 20 6 12 9 16 15 5 18 10 22 3" },
  },
  {
    type: "elliottcorrection",
    labels: ["0", "A", "B", "C"],
    legacyLabels: ["A", "B", "C"],
    iconPath: { from: "M4 7 11 16 20 9", to: "M3 5 9 15 14 10 21 19" },
  },
  { type: "shark", labels: ["0", "X", "A", "B", "C"] },
];

/** The marker a drawing made with the old point count carries in its `props`. */
export const LEGACY_PROP = "legacyVertices";

/** How many points the old tool placed, or null when the type was not re-counted. */
export const legacyPointCount = (type: string): number | null =>
  PATTERN_FIXES.find((fix) => fix.type === type)?.legacyLabels?.length ?? null;

/**
 * Mark Elliott drawings saved with the old tool, so they keep their points and labels
 * instead of being relabelled (their first point would read "0" and the last wave would
 * be missing). Drawings with the corrected count, and already-marked ones, are untouched.
 */
export function markLegacyPatterns(doc: DrawingsDocument): DrawingsDocument {
  let changed = false;
  const drawings = doc.drawings.map((drawing) => {
    const legacy = legacyPointCount(drawing.type);
    const props = (drawing.props ?? undefined) as Record<string, unknown> | undefined;
    if (legacy === null || drawing.anchors.length !== legacy || props?.[LEGACY_PROP] === true)
      return drawing;
    changed = true;
    return { ...drawing, props: { ...props, [LEGACY_PROP]: true } };
  });
  return changed ? { ...doc, drawings } : doc;
}

/** The toolbar icon with one vertex per point; unchanged if Vela's icon differs. */
export const fixedIcon = (icon: string, fix: PatternFix): string =>
  fix.iconPath && icon.includes(fix.iconPath.from)
    ? icon.replace(fix.iconPath.from, fix.iconPath.to)
    : icon;
