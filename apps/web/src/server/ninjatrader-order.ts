import type { Execution } from "@luxalgo/journal-core";

const signed = (fill: Execution) => (fill.side === "buy" ? fill.quantity : -fill.quantity);
const allowed = (fill: Execution, position: number) => {
  const effect = fill.importMetadata?.ninjaTrader?.effect;
  const opposite = position !== 0 && Math.sign(position) !== Math.sign(signed(fill));
  if (effect === "entry") return !opposite;
  if (effect === "exit") return opposite && fill.quantity <= Math.abs(position) + 1e-9;
  if (effect === "reverse") return opposite && fill.quantity > Math.abs(position) + 1e-9;
  return true;
};
const economicOrder = (fill: Execution) =>
  JSON.stringify([
    fill.side,
    fill.price,
    fill.fee / fill.quantity,
    fill.importMetadata?.ninjaTrader?.effect,
  ]);

/**
 * Resolve only ordering supported by source facts. IDs are never treated as a
 * chronological sequence. Equal-price partials with the same fee rate may swap
 * without changing lot costs. Ambiguous opposing fills require a sequence or
 * sufficient Entry/Exit facts, rather than using the exported display order.
 */
export function orderNinjaTraderFills(fills: Execution[]): string[] {
  const conflicts: string[] = [];
  const groups = new Map<string, Execution[]>();
  for (const fill of fills) {
    if (!fill.importMetadata?.ninjaTrader) continue;
    const group = fill.importMetadata.group!;
    const bucket = groups.get(group) ?? [];
    bucket.push(fill);
    groups.set(group, bucket);
  }
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        a.executedAt.localeCompare(b.executedAt) ||
        a.importMetadata!.id.localeCompare(b.importMetadata!.id),
    );
    let position = 0,
      order = 0;
    for (let i = 0; i < group.length;) {
      const time = group[i]!.executedAt;
      const tied: Execution[] = [];
      while (i < group.length && group[i]!.executedAt === time) tied.push(group[i++]!);
      const sequences = tied.map((fill) => fill.importMetadata!.ninjaTrader!.sequence);
      const sequenced =
        sequences.every((value) => value !== undefined) && new Set(sequences).size === tied.length;
      if (sequenced)
        tied.sort(
          (a, b) =>
            a.importMetadata!.ninjaTrader!.sequence! - b.importMetadata!.ninjaTrader!.sequence!,
        );
      let failed = false;
      while (tied.length) {
        const mixed = new Set(tied.map((fill) => fill.side)).size > 1;
        const candidates = sequenced
          ? tied.slice(0, 1).filter((fill) => allowed(fill, position))
          : tied.filter((fill) => allowed(fill, position));
        if (
          !candidates.length ||
          (!sequenced &&
            ((mixed && tied.some((fill) => !fill.importMetadata!.ninjaTrader!.effect)) ||
              new Set(candidates.map(economicOrder)).size > 1))
        ) {
          conflicts.push(
            `${tied[0]!.symbol} at ${time}: execution order is ambiguous or contradicts Entry/Exit. Export more precise timestamps, a reliable Sequence column, and the missing earlier fills. No row order was guessed.`,
          );
          failed = true;
          break;
        }
        const next = candidates[0]!;
        next.importMetadata = { ...next.importMetadata!, order: order++ };
        position += signed(next);
        if (Math.abs(position) < 1e-9) position = 0;
        tied.splice(tied.indexOf(next), 1);
      }
      if (failed) break;
    }
  }
  return conflicts;
}
