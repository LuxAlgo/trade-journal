import type { Drawing, DrawingTypeMeta } from "@luxalgo/vela";
import { LEGACY_PROP, PATTERN_FIXES, fixedIcon } from "@/lib/pattern-fixes";

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
 * created (its toolbar reads the registry); safe to call more than once.
 */
export function applyPatternFixes(api: RegistryApi): void {
  for (const fix of PATTERN_FIXES) {
    const meta = api.getDrawingType(fix.type);
    if (!meta || (meta as unknown as Record<symbol, boolean>)[FIXED]) continue;
    // The built-in classes aren't exported; derive from an instance of the registered one.
    const Base = meta.create({ paneId: "price" }).constructor as PatternClass;
    const { labels, legacyLabels } = fix;
    class Corrected extends Base {
      // Set while the base constructor reads props; `declare` keeps it from being reset.
      declare legacyVertices?: boolean;
      vertexLabels() {
        return this.legacyVertices && legacyLabels ? legacyLabels : labels;
      }
      readProps(props: Record<string, unknown>) {
        super.readProps(props);
        if (props[LEGACY_PROP] === true) this.legacyVertices = true;
      }
      writeProps() {
        const base = super.writeProps();
        return this.legacyVertices ? { ...base, [LEGACY_PROP]: true } : base;
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
