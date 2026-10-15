import type { ImportMetadata } from "@luxalgo/journal-core";
import type { ImportedExecution } from "./types";

export type PositionFacts = NonNullable<ImportMetadata["position"]>;

/** Only explicit position actions opt into hedge matching; Buy/Sell stays netted. */
export function parsePositionAction(value: string | undefined): PositionFacts | undefined {
  const match = value?.trim().match(/^(open|close)[\s_-]*(long|short)$/i);
  if (!match) return;
  return {
    effect: match[1]!.toLowerCase() as PositionFacts["effect"],
    direction: match[2]!.toLowerCase() as PositionFacts["direction"],
  };
}

/** Account and exact symbol are already part of the engine's grouping key. */
export const positionGroup = (position: PositionFacts): string =>
  `csv-position:${JSON.stringify([position.contract ?? null, position.positionId ?? null, position.direction])}`;

export function positionFillProblem(row: ImportedExecution): string | null {
  const meta = row.importMetadata;
  const position = meta?.position;
  if (!position && !meta?.group?.startsWith("csv-position:")) return null;
  const validId = (id: unknown) =>
    id === undefined || (typeof id === "string" && id.trim().length > 0 && id.length <= 500);
  if (
    !position ||
    !["long", "short"].includes(position.direction) ||
    !["open", "close"].includes(position.effect) ||
    !validId(position.contract) ||
    !validId(position.positionId) ||
    !validId(position.executionId) ||
    (position.sequence !== undefined &&
      (!Number.isSafeInteger(position.sequence) || position.sequence < 0)) ||
    meta?.group !== positionGroup(position) ||
    meta.id !== (position.executionId ? `execution:${position.executionId}` : position.effect) ||
    meta.order !== (position.sequence ?? 0) ||
    row.side !== ((position.direction === "long") === (position.effect === "open") ? "buy" : "sell")
  )
    return `${row.symbol}: invalid Open/Close position information.`;
  return null;
}
