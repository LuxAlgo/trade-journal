import type { Drawing, DrawingTypeMeta } from "@luxalgo/vela";
import { LEGACY_PROP, PATTERN_FIXES, fixedIcon } from "@/lib/pattern-fixes";
import { degreeLabel, isWaveDegree, type WaveDegree } from "@/lib/wave-degrees";

type DrawingInit = Parameters<DrawingTypeMeta["create"]>[0];
/** The registered classes are concrete; type only what the override touches. */
interface PatternInstance {
  vertexLabels(): string[];
  readProps(props: Record<string, unknown>): void;
  writeProps(): Record<string, unknown> | undefined;
}
type PatternClass = new (init: DrawingInit) => PatternInstance;
type RegistryApi = {
  getDrawingType(type: string): DrawingTypeMeta | undefined;
  registerDrawingType(meta: DrawingTypeMeta): void;
};

const FIXED = Symbol.for("trade-journal.pattern-fix");

/**
 * Replace Vela's Elliott wave (and Shark) tools with correctly counted ones, through Vela's
 * own "register (or replace) a drawing type" hook. The point count follows the labels, so
 * placement, handles and hit-testing all use the corrected count. Run before a chart is
 * created (its toolbar reads the registry); safe to call more than once. The Elliott tools
 * also gain a wave degree (set from the Template menu and saved in templates) that styles
 * their labels.
 */
export function applyPatternFixes(api: RegistryApi): void {
  for (const fix of PATTERN_FIXES) {
    const meta = api.getDrawingType(fix.type);
    if (!meta || (meta as unknown as Record<symbol, boolean>)[FIXED]) continue;
    // The built-in classes aren't exported; derive from an instance of the registered one.
    const Base = meta.create({ paneId: "price" }).constructor as PatternClass;
    const { labels, legacyLabels } = fix;
    const waves = fix.type.startsWith("elliott");
    class Corrected extends Base {
      // Set while the base constructor reads props; `declare` keeps them from being reset.
      declare legacyVertices?: boolean;
      /** The wave degree from its props; "" is none. */
      declare degree?: WaveDegree | "";
      vertexLabels() {
        const base = this.legacyVertices && legacyLabels ? legacyLabels : labels;
        const degree = isWaveDegree(this.degree) ? this.degree : undefined;
        return degree ? base.map((label) => degreeLabel(label, degree)) : base;
      }
      readProps(props: Record<string, unknown>) {
        super.readProps(props);
        if (props[LEGACY_PROP] === true) this.legacyVertices = true;
        if (waves) this.degree = isWaveDegree(props.degree) ? props.degree : "";
      }
      writeProps() {
        const base = super.writeProps();
        const extra = {
          ...(this.legacyVertices ? { [LEGACY_PROP]: true } : {}),
          ...(waves && isWaveDegree(this.degree) ? { degree: this.degree } : {}),
        };
        // Nothing to add keeps the base's own output (no empty props saved).
        return Object.keys(extra).length ? { ...base, ...extra } : base;
      }
    }
    api.registerDrawingType({
      ...meta,
      icon: fixedIcon(meta.icon, fix),
      create: (init) => new Corrected(init) as unknown as Drawing,
      [FIXED]: true,
    } as DrawingTypeMeta);
  }
}
