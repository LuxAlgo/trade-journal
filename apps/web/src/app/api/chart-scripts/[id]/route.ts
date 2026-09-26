import { bad, handler, ok } from "@/server/api";
import { deleteScript, getScript, updateScript } from "@/server/chart-scripts";

type Context = { params: Promise<{ id: string }> };

export const GET = handler(async (_request: Request, { params }: Context) => {
  const script = getScript((await params).id);
  return script ? ok({ script }) : bad("Indicator not found", 404);
});

export const PATCH = handler(async (request: Request, { params }: Context) => {
  const body = ((await request.json()) ?? {}) as { name?: unknown; source?: unknown };
  const script = updateScript((await params).id, body);
  return script ? ok({ script }) : bad("Indicator not found", 404);
});

export const DELETE = handler(async (_request: Request, { params }: Context) =>
  deleteScript((await params).id) ? ok({ deleted: true }) : bad("Indicator not found", 404),
);
