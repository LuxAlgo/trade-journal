import { eq, inArray } from "drizzle-orm";
import { db, trades } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { deleteExecutionsForTrades } from "@/server/executions";
import { nowIso } from "@/server/ids";

interface BulkBody {
  keys: string[];
  action: "review" | "unreview" | "tag" | "untag" | "playbook" | "delete";
  tag?: string;
  playbookId?: string | null;
}

export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as BulkBody;
  if (!Array.isArray(body.keys) || body.keys.length === 0) return bad("keys are required");
  const rows = db.select().from(trades).where(inArray(trades.key, body.keys)).all();

  switch (body.action) {
    case "review":
    case "unreview":
      db.update(trades)
        .set({ reviewedAt: body.action === "review" ? nowIso() : null })
        .where(inArray(trades.key, body.keys))
        .run();
      return ok({ updated: rows.length });
    case "tag":
    case "untag": {
      if (!body.tag) return bad("tag is required");
      for (const row of rows) {
        const tags = new Set<string>(row.tagsJson ? (JSON.parse(row.tagsJson) as string[]) : []);
        if (body.action === "tag") tags.add(body.tag);
        else tags.delete(body.tag);
        db.update(trades)
          .set({ tagsJson: JSON.stringify([...tags]) })
          .where(eq(trades.key, row.key))
          .run();
      }
      return ok({ updated: rows.length });
    }
    case "playbook":
      db.update(trades)
        .set({ playbookId: body.playbookId ?? null })
        .where(inArray(trades.key, body.keys))
        .run();
      return ok({ updated: rows.length });
    case "delete": {
      const byAccount = new Map<string, string[]>();
      for (const row of rows) {
        const ids = JSON.parse(row.executionIdsJson) as string[];
        byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), ...ids]);
      }
      for (const [accountId, executionIds] of byAccount) {
        deleteExecutionsForTrades(accountId, executionIds);
      }
      return ok({ deleted: rows.length });
    }
    default:
      return bad("Unknown action");
  }
});
