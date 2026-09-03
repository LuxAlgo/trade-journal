import type { ImportedExecution } from "@luxalgo/journal-importers";
import { bad, handler, ok } from "@/server/api";
import { insertExecutions } from "@/server/executions";

interface ManualBody {
  accountId: string;
  executions: ImportedExecution[];
}

/** Manual trade entry: the client sends raw fills (entry legs + exit legs). */
export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as ManualBody;
  if (!body.accountId || !Array.isArray(body.executions) || body.executions.length === 0) {
    return bad("accountId and a non-empty executions array are required");
  }
  for (const row of body.executions) {
    if (
      !row ||
      typeof row.symbol !== "string" ||
      !row.symbol.trim() ||
      !["buy", "sell"].includes(row.side) ||
      typeof row.executedAt !== "string" ||
      !Number.isFinite(Date.parse(row.executedAt)) ||
      !Number.isFinite(row.quantity) ||
      !(row.quantity > 0) ||
      !Number.isFinite(row.price) ||
      !Number.isFinite(row.fee ?? 0)
    ) {
      return bad("every execution needs symbol, side, quantity > 0, price, executedAt");
    }
  }
  const rows = body.executions.map((row) => ({
    ...row,
    symbol: row.symbol.trim().toUpperCase(),
    fee: row.fee ?? 0,
  }));
  return ok(insertExecutions(body.accountId, rows, "manual"));
});
