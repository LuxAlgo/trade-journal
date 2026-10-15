import { eq } from "drizzle-orm";
import { db, folders, notes } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { nowIso } from "@/server/ids";

type Params = { params: Promise<{ id: string }> };

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  return db.transaction((tx) => {
    const folder = tx.select().from(folders).where(eq(folders.id, id)).get();
    if (!folder || folder.deletedAt) return bad("Folder not found", 404);
    if (id === "all" || id === "my-notes") return bad("This folder cannot be deleted.");

    tx.update(notes).set({ folderId: "my-notes" }).where(eq(notes.folderId, id)).run();
    // Keep a tombstone so bootstrap cannot recreate a deleted built-in section.
    tx.update(folders).set({ deletedAt: nowIso() }).where(eq(folders.id, id)).run();
    return ok({ deleted: true });
  });
});
