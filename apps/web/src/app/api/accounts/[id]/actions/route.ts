import { eq } from "drizzle-orm";
import { accounts, db, executions, trades } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { nowIso } from "@/server/ids";
import { rebuildAccount } from "@/server/rebuild";
import { syncAccount } from "@/server/sync";

type Params = { params: Promise<{ id: string }> };

interface ActionBody {
  action: "archive" | "unarchive" | "clear" | "sync" | "transfer";
  /** For "transfer": destination account id. */
  toAccountId?: string;
}

export const POST = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!account) return bad("Account not found", 404);
  const body = (await request.json()) as ActionBody;

  switch (body.action) {
    case "archive":
      db.update(accounts).set({ archivedAt: nowIso() }).where(eq(accounts.id, id)).run();
      return ok({ archived: true });
    case "unarchive":
      db.update(accounts).set({ archivedAt: null }).where(eq(accounts.id, id)).run();
      return ok({ archived: false });
    case "clear":
      db.transaction((tx) => {
        tx.delete(trades).where(eq(trades.accountId, id)).run();
        tx.delete(executions).where(eq(executions.accountId, id)).run();
      });
      return ok({ cleared: true });
    case "sync":
      return ok({ sync: await syncAccount(id) });
    case "transfer": {
      if (!body.toAccountId) return bad("toAccountId is required");
      const destinationId = body.toAccountId;
      const destination = db.select().from(accounts).where(eq(accounts.id, destinationId)).get();
      if (!destination) return bad("Destination account not found", 404);

      // Remember annotations before the move; trade keys are account-prefixed,
      // so after the rebuild they re-anchor under the destination's prefix.
      const sourceTrades = db.select().from(trades).where(eq(trades.accountId, id)).all();
      db.transaction((tx) => {
        tx.update(executions)
          .set({ accountId: destinationId })
          .where(eq(executions.accountId, id))
          .run();
        tx.delete(trades).where(eq(trades.accountId, id)).run();
      });
      rebuildAccount(destinationId);

      for (const source of sourceTrades) {
        const hasAnnotations =
          source.notes ||
          source.tagsJson ||
          source.mistakesJson ||
          source.playbookId ||
          source.rating !== null ||
          source.stopLoss !== null ||
          source.profitTarget !== null ||
          source.reviewedAt;
        if (!hasAnnotations) continue;
        const newKey = destinationId + source.key.slice(id.length);
        db.update(trades)
          .set({
            notes: source.notes,
            tagsJson: source.tagsJson,
            mistakesJson: source.mistakesJson,
            playbookId: source.playbookId,
            rating: source.rating,
            stopLoss: source.stopLoss,
            profitTarget: source.profitTarget,
            reviewedAt: source.reviewedAt,
          })
          .where(eq(trades.key, newKey))
          .run();
      }
      return ok({ transferred: true });
    }
    default:
      return bad("Unknown action");
  }
});
