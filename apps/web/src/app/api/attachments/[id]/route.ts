import { eq } from "drizzle-orm";
import { db, attachments } from "@/db";
import { handler, ok, bad } from "@/server/api";
type Context = { params: Promise<{ id: string }> };
export const GET = handler(async (_request: Request, { params }: Context) => {
  const { id } = await params;
  const a = db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!a) return bad("Attachment not found", 404);
  return new Response(new Uint8Array(a.data), {
    headers: {
      "Content-Type": a.mime,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${a.mime.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      "Cache-Control": "private, no-store",
    },
  });
});
export const DELETE = handler(async (_request: Request, { params }: Context) => {
  const { id } = await params;
  db.delete(attachments).where(eq(attachments.id, id)).run();
  return ok({ deleted: true });
});
