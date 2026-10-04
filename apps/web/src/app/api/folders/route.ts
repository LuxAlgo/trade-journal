import { db, folders } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { newId, nowIso } from "@/server/ids";

export const POST = handler(async (request: Request) => {
  const body: unknown = await request.json();
  const name = body && typeof body === "object" && "name" in body ? body.name : null;
  if (typeof name !== "string" || !name.trim())
    return bad("Enter a folder name.", 400, "folder_name_required");
  if (name.trim().length > 100)
    return bad("Folder names must be 100 characters or fewer.", 400, "folder_name_too_long");
  const id = newId();
  db.insert(folders).values({ id, name: name.trim(), kind: "user", createdAt: nowIso() }).run();
  return ok({ id });
});
