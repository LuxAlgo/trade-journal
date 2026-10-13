import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { formatTimestamp } from "../src/lib/timezone";

const scratch = mkdtempSync(join(tmpdir(), "journal-flex-xml-"));
vi.stubEnv("JOURNAL_DATA_DIR", scratch);
vi.stubEnv("JOURNAL_PASSWORD", "");
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const { db, accounts, executions, trades, settings } = await import("../src/db");
const { encryptJson } = await import("../src/server/crypto");
const { setSetting } = await import("../src/server/settings");
const { syncAccount } = await import("../src/server/sync");
const { POST: importFile, GET: importFormats } = await import("../src/app/api/import/route");
const { GET: tradeDetail } = await import("../src/app/api/trades/[key]/route");

// Synthetic fills shaped like the #16 report: NYMEX MCL executions whose Flex
// dateTime carries no offset and is in the exchange's local time.
interface Fill {
  time: string;
  side?: "BUY" | "SELL";
  price?: string;
  extra?: string;
}
const reported: Fill[] = [
  { time: "20260918;085905", side: "BUY", price: "68.12" },
  { time: "20260918;100830", side: "SELL", price: "68.40" },
];
const flexXml = (fills: Fill[] = reported, account = "U_TEST") =>
  `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Trades" type="AF">
<FlexStatements count="1">
<FlexStatement accountId="${account}" fromDate="20260918" toDate="20260918" period="LastBusinessDay" whenGenerated="20260919;020000">
<Trades>
${fills
  .map(
    ({ time, side = "BUY", price = "68.12", extra = "" }) =>
      `<Trade accountId="${account}" currency="USD" assetCategory="FUT" symbol="MCLX6" multiplier="100" tradeDate="${time.slice(0, 8)}" dateTime="${time}" buySell="${side}" quantity="${side === "SELL" ? -1 : 1}" tradePrice="${price}" ibCommission="-0.62" levelOfDetail="EXECUTION"${extra} />`,
  )
  .join("\n")}
</Trades>
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`;

const post = (body: object) =>
  importFile(
    new Request("http://localhost/api/import", { method: "POST", body: JSON.stringify(body) }),
  );
const preview = async (content: string, extra: object = {}) =>
  (
    await post({ mode: "preview", accountId: "file", content, fileName: "flex.xml", ...extra })
  ).json();
const commit = (content: string, extra: object = {}) =>
  post({ mode: "commit", accountId: "file", content, fileName: "flex.xml", ...extra });
const times = (rows: { executedAt: string }[]) => rows.map((row) => row.executedAt).sort();
const stored = (accountId = "file") =>
  db.select().from(executions).where(eq(executions.accountId, accountId)).all();

let statement = flexXml();
const mockFlexService = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/SendRequest?"))
        return new Response(
          "<FlexStatementResponse><Status>Success</Status><ReferenceCode>test</ReferenceCode></FlexStatementResponse>",
        );
      if (url.includes("/GetStatement?")) return new Response(statement);
      throw new Error(`Unexpected network request: ${url}`);
    }),
  );

beforeEach(() => {
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  db.insert(accounts)
    .values({ id: "file", name: "IBKR file", kind: "import", createdAt: "2026-01-01" })
    .run();
  db.insert(accounts)
    .values({
      id: "ibkr",
      name: "IBKR sync",
      kind: "sync",
      broker: "ibkr-flex",
      credentialsEnc: encryptJson({ flexToken: "test-only", flexQueryId: "test-only" }),
      createdAt: "2026-01-01",
    })
    .run();
  setSetting("importTimeZone", "America/New_York");
  setSetting("timeZone", "Europe/Rome");
  statement = flexXml();
  mockFlexService();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

describe("IBKR Flex Query XML upload honours the statement timezone (#16)", () => {
  it("stores the report's New York fills at the right instant and shows them in Rome", async () => {
    const result = await preview(flexXml());
    expect(result).toMatchObject({
      detected: "ibkr-flex-xml",
      needsMapping: false,
      timeZone: "America/New_York",
      totals: { executions: 2, skippedRows: 0 },
    });
    expect(result.errors).toBeUndefined();
    expect(times(result.executions)).toEqual([
      "2026-09-18T12:59:05.000Z",
      "2026-09-18T14:08:30.000Z",
    ]);

    const response = await commit(flexXml());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ inserted: 2, duplicates: 0 });
    const trade = db.select().from(trades).get()!;
    expect(trade).toMatchObject({
      openedAt: "2026-09-18T12:59:05.000Z",
      closedAt: "2026-09-18T14:08:30.000Z",
    });
    const detail = await (
      await tradeDetail(new Request("http://localhost/api/trades/x"), {
        params: Promise.resolve({ key: trade.key }),
      })
    ).json();
    expect(
      detail.executions
        .map((fill: { executedAt: string }) => formatTimestamp(fill.executedAt, detail.timeZone))
        .sort(),
    ).toEqual(["2026-09-18 14:59:05", "2026-09-18 16:08:30"]);
  });

  it.each([
    ["UTC", ["2026-09-18T08:59:05.000Z", "2026-09-18T10:08:30.000Z"]],
    ["America/New_York", ["2026-09-18T12:59:05.000Z", "2026-09-18T14:08:30.000Z"]],
    ["Pacific/Kiritimati", ["2026-09-17T18:59:05.000Z", "2026-09-17T20:08:30.000Z"]],
  ])("reads naive Flex times in the chosen timezone %s", async (timeZone, expected) => {
    setSetting("importTimeZone", timeZone);
    expect(times((await preview(flexXml())).executions)).toEqual(expected);
    expect(times((await preview(flexXml(), { timeZone })).executions)).toEqual(expected);
  });

  it("keeps an explicit offset regardless of the statement timezone", async () => {
    const result = await preview(flexXml([{ time: "20260918;085905-0500" }]), {
      timeZone: "Pacific/Kiritimati",
    });
    expect(times(result.executions)).toEqual(["2026-09-18T13:59:05.000Z"]);
  });

  it("treats a re-upload of the same statement as duplicates", async () => {
    expect(await (await commit(flexXml())).json()).toMatchObject({ inserted: 2 });
    expect(await (await commit(flexXml())).json()).toMatchObject({ inserted: 0, duplicates: 2 });
    expect(stored()).toHaveLength(2);
  });

  it("lists Flex XML among the auto-detected formats", async () => {
    const { formats } = await (await importFormats()).json();
    expect(formats).toContainEqual({
      id: "ibkr-flex-xml",
      label: "Interactive Brokers (Flex Query XML)",
    });
  });
});

describe("Flex XML uploads into an IBKR sync account", () => {
  it("matches synced fills exactly when uploaded in the sync timezone", async () => {
    expect(await syncAccount("ibkr")).toMatchObject({ inserted: 2 });
    const response = await commit(flexXml(), { accountId: "ibkr" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ inserted: 0, duplicates: 2 });
    expect(stored("ibkr").map((row) => row.source)).toEqual(["sync", "sync"]);
  });

  it("refuses an upload in another timezone instead of storing every fill twice", async () => {
    await syncAccount("ibkr");
    const before = stored("ibkr");
    const previewed = await preview(flexXml(), { accountId: "ibkr", timeZone: "UTC" });
    expect(previewed.errors.join(" ")).toMatch(/syncs IBKR statements in America\/New_York/);
    const response = await commit(flexXml(), { accountId: "ibkr", timeZone: "UTC" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/upload uses UTC/);
    expect(stored("ibkr")).toEqual(before);
  });

  it("uses the zone the next sync will use when nothing has synced yet", async () => {
    const response = await commit(flexXml(), { accountId: "ibkr", timeZone: "Europe/Rome" });
    expect(response.status).toBe(400);
    expect(stored("ibkr")).toHaveLength(0);
    expect((await commit(flexXml(), { accountId: "ibkr" })).status).toBe(200);
    expect(await syncAccount("ibkr")).toMatchObject({ inserted: 0, duplicates: 2 });
  });

  it("refuses an upload into history synced before timezone-aware sync", async () => {
    await syncAccount("ibkr");
    db.update(accounts).set({ ibkrSyncTimeZone: null }).where(eq(accounts.id, "ibkr")).run();
    const response = await commit(flexXml(), { accountId: "ibkr" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/before timezone-aware sync/);
  });
});

describe("Flex XML statements that cannot be imported as-is", () => {
  it("refuses a statement that mixes IBKR accounts", async () => {
    const mixed = flexXml().replace(
      "</FlexStatements>",
      `<FlexStatement accountId="U_OTHER"><Trades><Trade accountId="U_OTHER" symbol="AAPL" buySell="BUY" quantity="1" tradePrice="200" ibCommission="-1" dateTime="20260918;093000" /></Trades></FlexStatement></FlexStatements>`,
    );
    const result = await preview(mixed);
    expect(result.errors.join(" ")).toMatch(/2 IBKR accounts \(U_TEST, U_OTHER\)/);
    expect((await commit(mixed)).status).toBe(400);
    expect(stored()).toHaveLength(0);
  });

  it("skips order and lot summaries so fills are not counted twice", async () => {
    const result = await preview(
      flexXml([
        ...reported,
        {
          time: "20260918;085905",
          side: "BUY",
          price: "68.12",
          extra: ' levelOfDetail="ORDER"',
        },
      ]).replace('levelOfDetail="EXECUTION" levelOfDetail="ORDER"', 'levelOfDetail="ORDER"'),
    );
    expect(result.totals.executions).toBe(2);
    expect(result.warnings.join(" ")).toMatch(/1 Trade summary row\(s\) \(ORDER\) were skipped/);
  });

  it("reports zero-price and unreadable rows instead of guessing", async () => {
    const result = await preview(
      flexXml([
        ...reported,
        { time: "20260918;160000", side: "SELL", price: "0" },
        { time: "2026-09-18;16:00:00" },
      ]),
    );
    expect(result.totals).toMatchObject({ executions: 2, skippedRows: 2 });
    expect(result.warnings.join(" ")).toMatch(/1 Trade row\(s\) were skipped.*zero price/);
    expect(result.warnings.join(" ")).toMatch(/1 fill\(s\) had no usable timestamp.*yyyyMMdd/);
  });

  it("returns a clear error for a statement without executions", async () => {
    const empty = flexXml([]);
    expect((await preview(empty)).errors.join(" ")).toMatch(/Execution level/);
    expect((await commit(empty)).status).toBe(400);
  });

  it("rejects a UTC offset as the statement timezone with a 400, not a crash", async () => {
    const response = await post({ mode: "preview", content: flexXml(), timeZone: "+02:00" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/named IANA statement timezone/);
  });

  it("leaves other XML to the column mapper", async () => {
    const result = await preview(`<?xml version="1.0"?>\n<Orders><Order id="1" /></Orders>`);
    expect(result).toMatchObject({ detected: null, needsMapping: true });
  });
});
