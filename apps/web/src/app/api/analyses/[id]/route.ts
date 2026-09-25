import { bad, handler, ok } from "@/server/api";
import {
  deleteAnalysis,
  getAnalysis,
  parseAnalysisInput,
  updateAnalysis,
} from "@/server/chart-analyses";

type Context = { params: Promise<{ id: string }> };

export const GET = handler(async (_request: Request, { params }: Context) => {
  const analysis = getAnalysis((await params).id);
  return analysis ? ok({ analysis }) : bad("Chart analysis not found", 404);
});

export const PATCH = handler(async (request: Request, { params }: Context) => {
  const body = (await request.json()) as Record<string, unknown> | null;
  const analysis = updateAnalysis((await params).id, parseAnalysisInput(body, true), {
    embed: body?.addToJournal === true,
  });
  return analysis ? ok({ analysis }) : bad("Chart analysis not found", 404);
});

export const DELETE = handler(async (_request: Request, { params }: Context) =>
  deleteAnalysis((await params).id) ? ok({ deleted: true }) : bad("Chart analysis not found", 404),
);
