import { handler, ok } from "@/server/api";
import { createScript, listScripts } from "@/server/chart-scripts";

export const GET = handler(() => ok({ scripts: listScripts() }));

export const POST = handler(async (request: Request) => {
  const body = ((await request.json()) ?? {}) as { name?: unknown; source?: unknown };
  return ok({ script: createScript(body) });
});
