import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { ImportReview, ImportReviewOptions } from "../src/lib/import-review";
const previousDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-reconciliation-"));
process.env.JOURNAL_DATA_DIR = scratch;
const {
  db,
  accounts,
  executions,
  trades,
  settings,
  attachments,
  importSources,
  importSourceAliases,
  importBatches,
} = await import("../src/db");
const { POST } = await import("../src/app/api/import/route");
const header = "Instrument,Action,Quantity,Price,Time,Account,Connection,ID,Commission";
const buy = "AAPL,Buy,1,100,2026-09-15 09:30,A,broker,e1,0";
const sell = "AAPL,Sell,1,110,2026-09-15 09:31,A,broker,e2,0";
const csv = (rows = [buy, sell]) => [header, ...rows].join("\n");
async function post(body: object) {
  return POST(
    new Request("http://localhost/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
async function preview(content = csv(), review: ImportReviewOptions = {}, accountId = "test") {
  const response = await post({ mode: "preview", content, review, accountId, timeZone: "UTC" });
  expect(response.status).toBe(200);
  return (await response.json()).reconciliation as ImportReview;
}
async function commit(content = csv(), review: ImportReviewOptions = {}, accountId = "test") {
  const plan = await preview(content, review, accountId);
  return post({
    mode: "commit",
    content,
    accountId,
    timeZone: "UTC",
    review: { ...review, previewToken: plan.token ?? undefined },
  });
}
const rows = () => db.select().from(trades).where(eq(trades.accountId, "test")).all();
const state = () => ({
  executions: db.select().from(executions).all(),
  trades: db.select().from(trades).all(),
  sources: db.select().from(importSources).all(),
  aliases: db.select().from(importSourceAliases).all(),
  batches: db.select().from(importBatches).all(),
  attachments: db.select().from(attachments).all(),
});
beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  db.delete(attachments).run();
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  db.insert(accounts)
    .values(
      ["test", "other"].map((id) => ({
        id,
        name: id,
        kind: "import" as const,
        createdAt: "2026-01-01",
      })),
    )
    .run();
});
afterAll(() => {
  vi.unstubAllEnvs();
  db.$client.close();
  if (previousDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = previousDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("NinjaTrader review protects identity and source corrections", () => {
  it("does not write while previewing and requires the reviewed token", async () => {
    const before = state(),
      plan = await preview();
    expect(plan).toMatchObject({
      inserted: 2,
      duplicates: 0,
      conflicts: [],
      totals: { netPnl: 10, closedTrades: 1, openTrades: 0 },
    });
    expect(plan.token).toBeTruthy();
    expect(state()).toEqual(before);
    const response = await post({
      mode: "commit",
      content: csv(),
      accountId: "test",
      timeZone: "UTC",
    });
    expect(response.status).toBe(400);
    expect(state()).toEqual(before);
  });

  it("exports the source identity, aliases and import history with journal data", async () => {
    await commit();
    const { GET } = await import("../src/app/api/export/route");
    const response = await GET(new Request("http://localhost/api/export"));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.importSources).toEqual(state().sources);
    expect(data.importSourceAliases).toEqual(state().aliases);
    expect(data.importBatches).toEqual(state().batches);
    expect(data.executions).toHaveLength(2);
    expect(JSON.parse(data.executions[0].importMetadataJson).ninjaTrader.sourceId).toBe(
      data.importSources[0].id,
    );
  });

  it.each(["oops", "Infinity", "$", "--2"])(
    "blocks malformed commission %s without changing the journal",
    async (value) => {
      await commit();
      const before = state();
      const changed = csv([buy.replace(/,0$/, `,${value}`), sell]);
      expect((await preview(changed)).conflicts.join(" ")).toContain("invalid commission");
      expect((await commit(changed)).status).toBe(400);
      expect(state()).toEqual(before);
    },
  );

  it("invalidates a preview after effective default fees change", async () => {
    const content = csv([buy.replace(/,0$/, ","), sell.replace(/,0$/, ",")]);
    const plan = await preview(content);
    expect(plan.totals?.netPnl).toBe(10);
    db.insert(settings)
      .values({
        key: "journalDefaults",
        value: JSON.stringify({
          feeRules: [{ id: "f", accountId: "test", symbol: "", amount: 1, mode: "execution" }],
        }),
      })
      .run();
    expect(
      (
        await post({
          mode: "commit",
          content,
          accountId: "test",
          timeZone: "UTC",
          review: { previewToken: plan.token },
        })
      ).status,
    ).toBe(400);
    expect(state().executions).toHaveLength(0);
    expect((await preview(content)).totals?.netPnl).toBe(8);
    expect((await commit(content)).status).toBe(200);
    // Defaults do not retroactively change already imported executions on reimport.
    db.update(settings)
      .set({
        value: JSON.stringify({
          feeRules: [{ id: "f", accountId: "test", symbol: "", amount: 2, mode: "execution" }],
        }),
      })
      .where(eq(settings.key, "journalDefaults"))
      .run();
    expect((await preview(content)).totals?.netPnl).toBe(8);
    expect(await (await commit(content)).json()).toMatchObject({
      inserted: 0,
      corrected: 0,
      duplicates: 2,
    });
  });

  it.each(["connection", "account missing", "account renamed"])(
    "requires source reconciliation when %s changes",
    async (change) => {
      expect((await commit()).status).toBe(200);
      const original = state();
      const changed =
        change === "connection"
          ? csv().replaceAll(",broker,", ",renamed,")
          : csv().replaceAll(",A,", change === "account missing" ? ",," : ",New name,");
      const plan = await preview(changed);
      expect(plan.token).toBeNull();
      expect(plan.conflicts.join(" ")).toContain("choose its saved source");
      expect((await commit(changed)).status).toBe(400);
      expect(state()).toEqual(original);
      const source = original.sources[0]!;
      const mapping = { sourceMappings: { [plan.sources[0]!.key]: source.id } };
      const resolved = await preview(changed, mapping);
      expect(resolved).toMatchObject({
        inserted: 0,
        duplicates: 2,
        conflicts: [],
        totals: { netPnl: 10 },
      });
      expect(await (await commit(changed, mapping)).json()).toMatchObject({
        inserted: 0,
        duplicates: 2,
      });
      expect(rows().map((t) => t.key)).toEqual(original.trades.map((t) => t.key));
      expect(db.select().from(importSourceAliases).all()).toHaveLength(2);
      expect((await preview(changed)).token).toBeTruthy();
    },
  );

  it("allows explicitly separate sources with reused execution IDs without netting accounts", async () => {
    await commit();
    const other = csv().replaceAll(",A,", ",B,");
    const plan = await preview(other);
    const options = { sourceMappings: { [plan.sources[0]!.key]: "new" } };
    expect((await commit(other, options)).status).toBe(200);
    expect(rows()).toHaveLength(2);
    expect(rows().reduce((sum, t) => sum + t.netPnl, 0)).toBe(20);
  });

  it("rejects mappings to another destination or reassignment of a saved source", async () => {
    await commit(csv(), {}, "other");
    const foreign = db.select().from(importSources).all()[0]!;
    const plan = await preview();
    expect(
      (await commit(csv(), { sourceMappings: { [plan.sources[0]!.key]: foreign.id } })).status,
    ).toBe(400);
    await commit();
    expect(
      (await commit(csv(), { sourceMappings: { [plan.sources[0]!.key]: "new" } })).status,
    ).toBe(400);
  });

  it("shows fee corrections, requires approval and preserves execution IDs, reviews and attachments", async () => {
    await commit();
    const original = state();
    const key = rows()[0]!.key;
    db.update(trades)
      .set({
        notes: "Keep this review",
        rating: 5,
        tagsJson: '["setup"]',
        reviewedAt: "2026-09-15",
      })
      .where(eq(trades.key, key))
      .run();
    db.insert(attachments)
      .values({
        id: "chart",
        ownerType: "trade",
        ownerId: key,
        name: "chart.png",
        mime: "image/png",
        size: 3,
        data: Buffer.from([1, 2, 3]),
        createdAt: "2026-09-15",
      })
      .run();
    const corrected = csv([buy.replace(/,0$/, ",1"), sell.replace(/,0$/, ",1")]);
    const plan = await preview(corrected);
    expect(plan.corrections).toHaveLength(2);
    expect(plan.token).toBeNull();
    expect(plan.totals?.netPnl).toBe(8);
    const before = state();
    expect((await commit(corrected)).status).toBe(400);
    expect(state()).toEqual(before);
    expect(await (await commit(corrected, { approveFeeCorrections: true })).json()).toMatchObject({
      inserted: 0,
      corrected: 2,
    });
    expect(rows()[0]).toMatchObject({
      key,
      notes: "Keep this review",
      rating: 5,
      tagsJson: '["setup"]',
      reviewedAt: "2026-09-15",
      netPnl: 8,
      fees: 2,
    });
    expect(
      state()
        .executions.map((e) => e.id)
        .sort(),
    ).toEqual(original.executions.map((e) => e.id).sort());
    expect(state().attachments).toEqual(before.attachments);
    expect(await (await commit(corrected)).json()).toMatchObject({
      inserted: 0,
      duplicates: 2,
      corrected: 0,
    });
  });

  it.each([
    csv([buy.replace(",100,", ",101,"), sell]),
    csv([buy.replace(",1,100,", ",2,100,"), sell]),
    csv([buy.replace("09:30", "09:29"), sell]),
    csv([buy.replace("AAPL", "MSFT"), sell]),
  ])("blocks changes to existing native execution economics", async (changed) => {
    await commit();
    const before = state();
    expect((await commit(changed)).status).toBe(400);
    expect(state()).toEqual(before);
  });

  it("rejects contradictory commissions under the same ID within a file", async () => {
    const contradictory = csv([buy, buy.replace(/,0$/, ",1"), sell]);
    const plan = await preview(contradictory);
    expect(plan.conflicts.join(" ")).toContain("contradictory");
    expect((await commit(contradictory)).status).toBe(400);
    expect(state().executions).toHaveLength(0);
  });

  it("rejects changed statement timezone for a saved source", async () => {
    await commit();
    const before = state();
    const response = await post({
      mode: "preview",
      content: csv(),
      accountId: "test",
      timeZone: "America/New_York",
    });
    const plan = (await response.json()).reconciliation;
    expect(plan.conflicts.join(" ")).toContain("different statement timezone");
    expect(plan.token).toBeNull();
    expect(state()).toEqual(before);
  });

  it("invalidates a preview when the journal or account currency changes", async () => {
    const plan = await preview();
    await commit();
    const stale = await post({
      mode: "commit",
      content: csv(),
      accountId: "test",
      timeZone: "UTC",
      review: { previewToken: plan.token },
    });
    expect(stale.status).toBe(400);
    expect(state().executions).toHaveLength(2);
    const next = await preview();
    db.insert(settings).values({ key: "journalDefaults", value: '{"feeRules":[]}' }).run();
    // Equivalent settings do not needlessly invalidate the semantic plan.
    db.update(accounts).set({ currency: "EUR" }).where(eq(accounts.id, "test")).run();
    expect(
      (
        await post({
          mode: "commit",
          content: csv(),
          accountId: "test",
          timeZone: "UTC",
          review: { previewToken: next.token },
        })
      ).status,
    ).toBe(400);
  });

  it("rolls back source mappings, fills and history when rebuilding fails", async () => {
    const before = state();
    const plan = await preview();
    db.$client.exec(
      "CREATE TRIGGER fail_review BEFORE INSERT ON trades BEGIN SELECT RAISE(FAIL, 'rebuild failure'); END",
    );
    try {
      expect(
        (
          await post({
            mode: "commit",
            content: csv(),
            accountId: "test",
            timeZone: "UTC",
            review: { previewToken: plan.token },
          })
        ).status,
      ).toBe(500);
      expect(state()).toEqual(before);
    } finally {
      db.$client.exec("DROP TRIGGER fail_review");
    }
  });
});

describe("NinjaTrader overlapping exports and chronology", () => {
  const noIds = () => csv([buy.replace(",e1,", ",,"), sell.replace(",e2,", ",,")]);
  it("requires an explicit source for a first export with no account label", async () => {
    const content = csv().replaceAll(",A,", ",,");
    const plan = await preview(content);
    expect(plan.token).toBeNull();
    expect((await commit(content)).status).toBe(400);
    expect(
      (await commit(content, { sourceMappings: { [plan.sources[0]!.key]: "new" } })).status,
    ).toBe(200);
    expect(rows()[0]?.netPnl).toBe(10);
  });

  it.each(["fifo", "lifo", "wavg"] as const)(
    "extends an open position across exports with %s while preserving its review",
    async (method) => {
      db.update(accounts).set({ profitCalcMethod: method }).where(eq(accounts.id, "test")).run();
      const entry = csv([buy.replace(",1,100,", ",2,100,")]);
      expect((await commit(entry)).status).toBe(200);
      const key = rows()[0]!.key;
      db.update(trades)
        .set({ notes: "Opening review", rating: 4 })
        .where(eq(trades.key, key))
        .run();
      expect((await commit(csv([sell]))).status).toBe(200);
      expect(rows()[0]).toMatchObject({ key, openQuantity: 1, notes: "Opening review", rating: 4 });
      const exit = sell.replace("09:31", "09:32").replace("e2", "e3").replace(",110,", ",90,");
      expect((await commit(csv([exit]))).status).toBe(200);
      expect(rows()[0]).toMatchObject({
        key,
        openQuantity: 0,
        netPnl: 0,
        notes: "Opening review",
        rating: 4,
      });
    },
  );

  it("keeps different futures expiry positions separate even when symbols normalize to the same root", async () => {
    db.insert(settings).values({ key: "multipliers", value: '{"ES":50}' }).run();
    const content = csv([buy.replace("AAPL", "ES 09-26"), sell.replace("AAPL", "ES 12-26")]);
    expect((await commit(content)).status).toBe(200);
    expect(rows()).toHaveLength(2);
    expect(
      rows()
        .map((t) => t.direction)
        .sort(),
    ).toEqual(["long", "short"]);
    expect(rows().every((t) => t.openQuantity === 1)).toBe(true);
  });

  it("rejects earlier history that would replace an annotated trade identity", async () => {
    await commit();
    db.update(trades).set({ notes: "Must survive" }).run();
    const before = state();
    const earlier = csv([buy.replace("09:30", "09:29").replace("e1", "earlier")]);
    expect((await preview(earlier)).conflicts.join(" ")).toContain(
      "replace existing trade identities",
    );
    expect((await commit(earlier)).status).toBe(400);
    expect(state()).toEqual(before);
  });

  it("reconstructs an explicit reversal into a closed long and a new short", async () => {
    const content = [
      header + ",E/X",
      buy + ",Entry",
      sell.replace(",1,110,", ",2,110,") + ",Reverse",
      buy.replace("09:30", "09:32").replace(",100,", ",105,").replace("e1", "e3") + ",Exit",
    ].join("\n");
    expect((await commit(content)).status).toBe(200);
    expect(rows()).toHaveLength(2);
    expect(
      rows()
        .map((t) => [t.direction, t.netPnl])
        .sort(),
    ).toEqual([
      ["long", 10],
      ["short", 5],
    ]);
  });

  it("recognizes repeat/reordered snapshots but requires a completeness declaration for a changed overlap", async () => {
    await commit(noIds());
    const before = state();
    const [head, ...body] = noIds().split("\n");
    expect(await (await commit([head, ...body.reverse()].join("\n"))).json()).toMatchObject({
      inserted: 0,
      duplicates: 2,
    });
    const growing = csv([
      buy.replace(",e1,", ",,"),
      buy.replace(",e1,", ",,"),
      sell.replace(",e2,", ",,"),
      sell.replace(",e2,", ",,"),
    ]);
    const plan = await preview(growing);
    expect(plan.needsCompleteHistory).toBe(true);
    expect(plan.token).toBeNull();
    expect((await commit(growing)).status).toBe(400);
    expect(state().executions).toEqual(before.executions);
    expect(await (await commit(growing, { completeHistory: true })).json()).toMatchObject({
      inserted: 2,
      duplicates: 2,
    });
    expect(rows()[0]).toMatchObject({ quantity: 2, netPnl: 20, openQuantity: 0 });
    expect(await (await commit(noIds())).json()).toMatchObject({ inserted: 0, duplicates: 2 });
  });

  it("blocks a declared complete export that omits earlier fills inside its time range", async () => {
    const first = csv([
      buy.replace(",e1,", ",,"),
      sell.replace(",e2,", ",,"),
      buy.replace("09:30", "09:32").replace(",e1,", ",,"),
    ]);
    await commit(first);
    const before = state();
    const partial = csv([
      buy.replace(",e1,", ",,"),
      buy.replace("09:30", "09:32").replace(",e1,", ",,"),
    ]);
    const plan = await preview(partial, { completeHistory: true });
    expect(plan.conflicts.join(" ")).toContain("omits or changes");
    expect((await commit(partial, { completeHistory: true })).status).toBe(400);
    expect(state()).toEqual(before);
  });

  it("blocks arbitrary same-time entry/exit ordering without supporting facts", async () => {
    const tied = csv([sell.replace("09:31", "09:30"), buy]);
    const plan = await preview(tied);
    expect(plan.conflicts.join(" ")).toContain("order is ambiguous");
    expect(plan.token).toBeNull();
    expect((await commit(tied)).status).toBe(400);
    expect(state().executions).toHaveLength(0);
  });

  it("uses millisecond precision to order opposing fills without Entry/Exit labels", async () => {
    const content = csv([
      sell.replace("09:31", "09:30:00.200"),
      buy.replace("09:30", "09:30:00.100"),
    ]);
    const plan = await preview(content);
    expect(plan.conflicts).toEqual([]);
    expect(plan.totals?.netPnl).toBe(10);
    expect((await commit(content)).status).toBe(200);
    expect(rows()[0]).toMatchObject({
      direction: "long",
      openedAt: "2026-09-15T09:30:00.100Z",
      closedAt: "2026-09-15T09:30:00.200Z",
      netPnl: 10,
    });
  });

  it.each([false, true])(
    "uses Entry/Exit to resolve a uniquely ordered same-time pair (reversed=%s)",
    async (reverse) => {
      const entry = buy + ",Entry",
        exit = sell.replace("09:31", "09:30") + ",Exit";
      const content = [header + ",E/X", ...(reverse ? [exit, entry] : [entry, exit])].join("\n");
      expect((await commit(content)).status).toBe(200);
      expect(rows()[0]).toMatchObject({ direction: "long", netPnl: 10, openQuantity: 0 });
    },
  );

  it("requires a sequence for multiple possible same-time cycles", async () => {
    const rowsWithFacts = [
      buy + ",Entry",
      sell.replace("09:31", "09:30") + ",Exit",
      buy.replace(",100,", ",105,").replace("e1", "e3") + ",Entry",
    ];
    const content = [header + ",E/X", ...rowsWithFacts].join("\n");
    expect((await commit(content)).status).toBe(400);
    const sequenced = [
      header + ",E/X,Sequence",
      ...rowsWithFacts.map((row, i) => row + "," + (i + 1)).reverse(),
    ].join("\n");
    expect((await commit(sequenced)).status).toBe(200);
    expect(rows()).toHaveLength(2);
    expect(rows().filter((t) => t.status !== "open")[0]?.netPnl).toBe(10);
  });

  it("blocks an exit with missing opening history rather than creating a false short", async () => {
    const content = [header + ",E/X", sell + ",Exit"].join("\n");
    expect((await commit(content)).status).toBe(400);
    expect(state().executions).toHaveLength(0);
  });

  it("does not silently skip malformed rows in a position reconstruction", async () => {
    const broken = csv([buy.replace(",1,100,", ",oops,100,"), sell]);
    const plan = await preview(broken);
    expect(plan.conflicts.join(" ")).toContain("invalid execution rows");
    expect((await commit(broken)).status).toBe(400);
  });
});
