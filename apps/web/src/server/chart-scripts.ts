import { desc, eq } from "drizzle-orm";
import { chartScripts, db } from "@/db";
import { scriptProblem, type ChartScript } from "@/lib/chart-indicators";
import { requireValue } from "./api";
import { newId, nowIso } from "./ids";

export const MAX_SCRIPTS = 500;

export const listScripts = (): ChartScript[] =>
  db.select().from(chartScripts).orderBy(desc(chartScripts.updatedAt)).all();

export const getScript = (id: string): ChartScript | null =>
  db.select().from(chartScripts).where(eq(chartScripts.id, id)).get() ?? null;

export function createScript(body: { name?: unknown; source?: unknown }): ChartScript {
  const problem = scriptProblem(body);
  requireValue(!problem, problem ?? "");
  requireValue(listScripts().length < MAX_SCRIPTS, `Keep at most ${MAX_SCRIPTS} indicators.`);
  const now = nowIso();
  const script = {
    id: newId(),
    name: (body.name as string).trim(),
    source: body.source as string,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(chartScripts).values(script).run();
  return script;
}

export function updateScript(id: string, body: { name?: unknown; source?: unknown }) {
  const current = getScript(id);
  if (!current) return null;
  const next = {
    name: body.name === undefined ? current.name : body.name,
    source: body.source === undefined ? current.source : body.source,
  };
  const problem = scriptProblem(next);
  requireValue(!problem, problem ?? "");
  db.update(chartScripts)
    .set({ name: (next.name as string).trim(), source: next.source as string, updatedAt: nowIso() })
    .where(eq(chartScripts.id, id))
    .run();
  return getScript(id);
}

/** Charts using a deleted script keep running the copy saved with them. */
export const deleteScript = (id: string): boolean =>
  db.delete(chartScripts).where(eq(chartScripts.id, id)).run().changes > 0;
