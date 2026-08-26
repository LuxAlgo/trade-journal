import { eq } from "drizzle-orm";
import { db, playbooks, trades } from "@/db";
import { bad, handler, ok } from "@/server/api";

type Params = { params: Promise<{ id: string }> };

export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const existing = db.select().from(playbooks).where(eq(playbooks.id, id)).get();
  if (!existing) return bad("Playbook not found", 404);
  const body = (await request.json()) as { name?: string; description?: string; rules?: string[] };
  db.update(playbooks)
    .set({
      name: body.name ?? existing.name,
      description: body.description ?? existing.description,
      rulesJson: body.rules ? JSON.stringify(body.rules) : existing.rulesJson,
    })
    .where(eq(playbooks.id, id))
    .run();
  return ok({ updated: true });
});

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  db.transaction((tx) => {
    tx.update(trades).set({ playbookId: null }).where(eq(trades.playbookId, id)).run();
    tx.delete(playbooks).where(eq(playbooks.id, id)).run();
  });
  return ok({ deleted: true });
});
