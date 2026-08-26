import { eq } from "drizzle-orm";
import { db, notes } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { nowIso } from "@/server/ids";

type Params = { params: Promise<{ id: string }> };

interface PatchNoteBody {
  title?: string;
  content?: string;
  tags?: string[];
  folderId?: string;
}

export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const existing = db.select().from(notes).where(eq(notes.id, id)).get();
  if (!existing) return bad("Note not found", 404);
  const body = (await request.json()) as PatchNoteBody;
  db.update(notes)
    .set({
      title: body.title ?? existing.title,
      content: body.content ?? existing.content,
      tagsJson: body.tags ? JSON.stringify(body.tags) : existing.tagsJson,
      folderId: body.folderId ?? existing.folderId,
      updatedAt: nowIso(),
    })
    .where(eq(notes.id, id))
    .run();
  return ok({ updated: true });
});

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  db.delete(notes).where(eq(notes.id, id)).run();
  return ok({ deleted: true });
});
