import { drawingLabel, type ChartAnalysis, type StoredDrawing } from "./chart-analysis";
import { drawingName } from "./chart-layers";
import { drawingFacts, fmtPrice } from "./analysis-text";
import type { PlanScenario } from "./analysis-plan";

/**
 * How an analysis changed from one day's version to the next, in words: drawings added,
 * removed, moved or renamed, zones and the plan edited, notes rewritten. Lets the day page
 * and the AI follow a thesis over several days.
 */

type Version = Pick<ChartAnalysis, "drawings" | "layers" | "zones" | "plan" | "notes">;

export const MAX_CHANGES = 40;

const titleOf = (drawing: StoredDrawing, version: Version) => {
  const name = drawingName(version.layers, drawing.id);
  return name ? `${drawingLabel(drawing.type)} "${name}"` : drawingLabel(drawing.type);
};

const sameAnchors = (a: StoredDrawing, b: StoredDrawing) =>
  a.anchors.length === b.anchors.length &&
  a.anchors.every((p, i) => p.time === b.anchors[i]!.time && p.price === b.anchors[i]!.price);

const scenarioText = (s: PlanScenario) =>
  `${JSON.stringify(s.name || "unnamed")} (${s.direction} at ${s.trigger === null ? "no trigger" : fmtPrice(s.trigger)}, target ${s.target === null ? "none" : fmtPrice(s.target)}, invalid at ${s.invalidation === null ? "none" : fmtPrice(s.invalidation)})`;

export function describeChanges(before: Version, after: Version): string[] {
  const changes: string[] = [];
  const old = new Map(before.drawings.drawings.map((d) => [d.id, d]));
  const now = new Map(after.drawings.drawings.map((d) => [d.id, d]));
  for (const [id, drawing] of now) {
    const was = old.get(id);
    if (!was) {
      changes.push(`Added ${titleOf(drawing, after)}: ${drawingFacts(drawing)}`);
      continue;
    }
    const oldName = drawingName(before.layers, id);
    const newName = drawingName(after.layers, id);
    if (oldName !== newName)
      changes.push(
        `Renamed ${drawingLabel(drawing.type)} ${oldName ? JSON.stringify(oldName) : "(unnamed)"} to ${newName ? JSON.stringify(newName) : "(unnamed)"}`,
      );
    if (!sameAnchors(was, drawing))
      changes.push(`Moved ${titleOf(drawing, after)}: now ${drawingFacts(drawing)}`);
    else if (JSON.stringify(was.props ?? null) !== JSON.stringify(drawing.props ?? null))
      changes.push(`Changed the settings of ${titleOf(drawing, after)}: ${drawingFacts(drawing)}`);
  }
  for (const [id, drawing] of old)
    if (!now.has(id)) changes.push(`Removed ${titleOf(drawing, before)}: ${drawingFacts(drawing)}`);

  const oldZones = new Map(before.zones.map((z) => [z.id, z]));
  const newZones = new Map(after.zones.map((z) => [z.id, z]));
  const zoneText = (z: { low: number; high: number; label: string }) =>
    `zone${z.label ? ` ${JSON.stringify(z.label)}` : ""} ${fmtPrice(z.low)} to ${fmtPrice(z.high)}`;
  for (const [id, zone] of newZones) {
    const was = oldZones.get(id);
    if (!was) changes.push(`Added ${zoneText(zone)}`);
    else if (was.low !== zone.low || was.high !== zone.high || was.label !== zone.label)
      changes.push(`Changed ${zoneText(was)} to ${zoneText(zone)}`);
  }
  for (const [id, zone] of oldZones)
    if (!newZones.has(id)) changes.push(`Removed ${zoneText(zone)}`);

  if (before.plan.bias !== after.plan.bias)
    changes.push(`Bias changed from ${before.plan.bias ?? "none"} to ${after.plan.bias ?? "none"}`);
  const oldScenarios = new Map(before.plan.scenarios.map((s) => [s.id, s]));
  for (const s of after.plan.scenarios) {
    const was = oldScenarios.get(s.id);
    if (!was) changes.push(`New scenario ${scenarioText(s)}`);
    else if (JSON.stringify(was) !== JSON.stringify(s))
      changes.push(`Scenario ${scenarioText(was)} is now ${scenarioText(s)}`);
  }
  for (const s of before.plan.scenarios)
    if (!after.plan.scenarios.some((n) => n.id === s.id))
      changes.push(`Dropped scenario ${scenarioText(s)}`);
  if (before.notes.trim() !== after.notes.trim()) changes.push("Notes rewritten");
  return changes.length > MAX_CHANGES
    ? [...changes.slice(0, MAX_CHANGES), `…and ${changes.length - MAX_CHANGES} more changes`]
    : changes;
}
