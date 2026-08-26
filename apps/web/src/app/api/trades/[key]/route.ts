import { eq } from "drizzle-orm";
import { db, trades } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { deleteExecutionsForTrades, listExecutions } from "@/server/executions";
import { nowIso } from "@/server/ids";
import { getTradeByKey, rowToTrade } from "@/server/trades-query";

type Params = { params: Promise<{ key: string }> };

export const GET = handler(async (_request: Request, { params }: Params) => {
  const { key } = await params;
  const row = getTradeByKey(decodeURIComponent(key));
  if (!row) return bad("Trade not found", 404);
  const trade = rowToTrade(row);
  const fills = listExecutions(row.accountId, trade.executionIds);
  return ok({ trade: row, executions: fills });
});

interface AnnotateBody {
  notes?: string | null;
  tags?: string[];
  mistakes?: string[];
  playbookId?: string | null;
  rating?: number | null;
  stopLoss?: number | null;
  profitTarget?: number | null;
  reviewed?: boolean;
}

export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { key } = await params;
  const decoded = decodeURIComponent(key);
  const row = getTradeByKey(decoded);
  if (!row) return bad("Trade not found", 404);

  const body = (await request.json()) as AnnotateBody;
  const patch: Partial<typeof trades.$inferInsert> = {};
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.tags !== undefined) patch.tagsJson = JSON.stringify(body.tags);
  if (body.mistakes !== undefined) patch.mistakesJson = JSON.stringify(body.mistakes);
  if (body.playbookId !== undefined) patch.playbookId = body.playbookId;
  if (body.rating !== undefined) patch.rating = body.rating;
  if (body.stopLoss !== undefined) patch.stopLoss = body.stopLoss;
  if (body.profitTarget !== undefined) patch.profitTarget = body.profitTarget;
  if (body.reviewed !== undefined) patch.reviewedAt = body.reviewed ? nowIso() : null;

  db.update(trades).set(patch).where(eq(trades.key, decoded)).run();
  return ok({ updated: true });
});

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { key } = await params;
  const row = getTradeByKey(decodeURIComponent(key));
  if (!row) return bad("Trade not found", 404);
  // Deleting a trade means deleting its executions; the rebuild removes the row.
  deleteExecutionsForTrades(row.accountId, JSON.parse(row.executionIdsJson) as string[]);
  return ok({ deleted: true });
});
