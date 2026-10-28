import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  xtbWorkbook,
  type ClosedLot,
  type OpenLot,
} from "../../../packages/importers/tests/xtb-fixture";

const scratch = mkdtempSync(join(tmpdir(), "journal-xtb-"));
vi.stubEnv("JOURNAL_DATA_DIR", scratch);
vi.stubEnv("JOURNAL_PASSWORD", "");
const { db, accounts, executions, trades } = await import("../src/db");
const { POST } = await import("../src/app/api/import/route");

const post = (body: object) =>
  POST(new Request("http://localhost/api/import", { method: "POST", body: JSON.stringify(body) }));
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const upload = (mode: "preview" | "commit", bytes: Uint8Array, extra: object = {}) =>
  post({
    mode,
    accountId: "xtb",
    content: base64(bytes),
    encoding: "xlsx",
    fileName: "account.xlsx",
    timeZone: "Europe/Bucharest",
    ...extra,
  });
const state = () => ({
  executions: db.select().from(executions).all().length,
  trades: db
    .select()
    .from(trades)
    .all()
    .map((trade) => [trade.status, trade.openQuantity, trade.netPnl])
    .sort(),
});

// Synthetic account and positions in the layout of real xStation exports.
const ACCOUNT = 10000001;
const lot = (positionId: number, volume: number, openPrice: number, openTime: string): OpenLot => ({
  instrument: "Synthetic ETF",
  ticker: "SYN.DE",
  category: "ETF",
  type: "BUY",
  volume,
  openPrice,
  openTime: new Date(openTime),
  positionId,
});
const lots = [
  lot(3000000002, 4.5, 750.25, "2026-10-07T17:57:32.940Z"),
  lot(3000000003, 0.3, 731.1, "2026-09-30T15:07:43.479Z"),
];
const close = (open: OpenLot, changes: Partial<ClosedLot> = {}): ClosedLot => ({
  ...open,
  closePrice: open.openPrice + 10,
  closeTime: new Date("2026-10-12T09:00:00.000Z"),
  net: open.volume * 10,
  gross: open.volume * 10,
  ...changes,
});
const holdings = xtbWorkbook(ACCOUNT, { open: lots });
const later = (closed: ClosedLot) =>
  xtbWorkbook(ACCOUNT, { closed: [closed], open: lots.slice(1) });

beforeEach(() => {
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.insert(accounts)
    .values({ id: "xtb", name: "XTB", kind: "import", createdAt: "2026-01-01" })
    .run();
});
afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

describe("XTB .xlsx upload (#42)", () => {
  it("previews and imports a workbook decoded on the server, once", async () => {
    const preview = await (await upload("preview", holdings)).json();
    expect(preview).toMatchObject({
      detected: "xtb",
      totals: { executions: 2, skippedRows: 0 },
    });
    expect(preview.errors).toBeUndefined();
    expect(await (await upload("commit", holdings)).json()).toMatchObject({ inserted: 2 });
    expect(await (await upload("commit", holdings)).json()).toMatchObject({
      inserted: 0,
      duplicates: 2,
    });
    expect(state()).toEqual({
      executions: 2,
      trades: [
        ["open", 0.3, 0],
        ["open", 4.5, 0],
      ],
    });
  });

  it("closes a holding when a later workbook reports the close", async () => {
    await upload("commit", holdings);
    const result = await (await upload("commit", later(close(lots[0]!)))).json();
    expect(result).toMatchObject({ inserted: 1, duplicates: 2 });
    expect(state()).toEqual({
      executions: 3,
      trades: [
        ["open", 0.3, 0],
        ["win", 0, 45],
      ],
    });
  });

  it("treats a rounding difference in the later close as the same lot", async () => {
    await upload("commit", holdings);
    const drifted = close(lots[0]!, {
      openTime: new Date("2026-10-07T17:57:33.000Z"),
      openPrice: 750.2500004,
    });
    const preview = await (await upload("preview", later(drifted))).json();
    expect(preview.warnings.join(" ")).toMatch(/1 open holding\(s\) imported earlier are closed/);
    expect(await (await upload("commit", later(drifted))).json()).toMatchObject({
      inserted: 1,
      duplicates: 2,
    });
    expect(state().trades).toEqual([
      ["open", 0.3, 0],
      ["win", 0, 45],
    ]);
  });

  it("refuses a later close that changes the lot instead of booking a phantom position", async () => {
    await upload("commit", holdings);
    const before = state();
    const partial = later(close(lots[0]!, { volume: 2, net: 20, gross: 20 }));
    const preview = await (await upload("preview", partial)).json();
    expect(preview.errors.join(" ")).toMatch(/XTB position 3000000002 was imported earlier/);
    const response = await upload("commit", partial);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/partial close.*Nothing was saved/);
    expect(state()).toEqual(before);
  });

  it("refuses AI parsing, column mapping and oversized or non-workbook uploads", async () => {
    const statuses = await Promise.all([
      upload("preview", holdings, { ai: { provider: "openai", model: "test" } }),
      upload("preview", holdings, { mapping: { symbol: "Ticker" } }),
      post({ mode: "preview", content: "not base64!", encoding: "xlsx" }),
      post({
        mode: "preview",
        content: base64(new TextEncoder().encode("Closed Positions")),
        encoding: "xlsx",
      }),
      post({
        mode: "preview",
        content: base64(new Uint8Array(5 * 1024 * 1024 + 1)),
        encoding: "xlsx",
      }),
    ]);
    const bodies = await Promise.all(statuses.map((response) => response.json()));
    expect(statuses.map((response) => response.status)).toEqual([400, 400, 400, 400, 400]);
    expect(bodies.map((body) => body.error)).toEqual([
      expect.stringMatching(/Turn off AI parsing/),
      expect.stringMatching(/Turn off AI parsing/),
      expect.stringMatching(/not an \.xlsx workbook/),
      expect.stringMatching(/not an \.xlsx workbook/),
      expect.stringMatching(/5 MB or less/),
    ]);
    expect(state().executions).toBe(0);
  });
});
