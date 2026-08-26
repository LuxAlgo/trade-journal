import { db, folders } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { newId, nowIso } from "@/server/ids";

export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as { name?: string };
  if (!body.name) return bad("name is required");
  const id = newId();
  db.insert(folders).values({ id, name: body.name, kind: "user", createdAt: nowIso() }).run();
  return ok({ id });
});
