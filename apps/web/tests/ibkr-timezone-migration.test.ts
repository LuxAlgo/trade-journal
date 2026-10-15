import { afterAll, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOOTSTRAP_SQL } from "../src/db/bootstrap";

const scratch = mkdtempSync(join(tmpdir(), "journal-ibkr-upgrade-"));
vi.stubEnv("JOURNAL_DATA_DIR", scratch);
const legacy = new Database(join(scratch, "journal.db"));
legacy.exec(BOOTSTRAP_SQL.replace("  ibkr_sync_time_zone TEXT,\n", ""));
legacy.exec(
  "INSERT INTO accounts (id, name, kind, broker, created_at) VALUES ('old', 'Original history', 'sync', 'ibkr-flex', '2026-01-01')",
);
expect(
  (legacy.pragma("table_info(accounts)") as { name: string }[]).some(
    (column) => column.name === "ibkr_sync_time_zone",
  ),
).toBe(false);
const before = legacy.prepare("SELECT * FROM accounts").get();
legacy.close();
const { db, accounts } = await import("../src/db");

it("adds nullable provenance to existing accounts without claiming their old timezone", () => {
  const { ibkr_sync_time_zone, ...after } = db.$client
    .prepare("SELECT * FROM accounts")
    .get() as Record<string, unknown>;
  expect(ibkr_sync_time_zone).toBeNull();
  expect(after).toEqual(before);
  expect(db.select().from(accounts).get()?.ibkrSyncTimeZone).toBeNull();
});
afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});
