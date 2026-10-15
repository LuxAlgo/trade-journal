import { afterAll, expect, it } from "vitest";
import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { BOOTSTRAP_SQL } from "../src/db/bootstrap";

// `next build` opens the journal from several worker processes at once. Each child
// here loads the real bootstrap module and spins until a shared start time, so their
// first-run setup overlaps the way build workers do.
const run = promisify(execFile);
const bootstrapUrl = pathToFileURL(
  fileURLToPath(new URL("../src/db/bootstrap.ts", import.meta.url)),
).href;
const child = `
const [file, start, url] = process.argv.slice(1);
const { openJournalDatabase } = await import(url);
while (Date.now() < Number(start));
openJournalDatabase(file).close();
`;
const scratch = mkdtempSync(join(tmpdir(), "journal-concurrent-init-"));
const PROCESSES = 12;

async function openConcurrently(file: string) {
  const start = Date.now() + 1500;
  const results = await Promise.allSettled(
    Array.from({ length: PROCESSES }, () =>
      run(
        process.execPath,
        [
          "--experimental-strip-types",
          "--no-warnings",
          "--input-type=module",
          "-e",
          child,
          file,
          String(start),
          bootstrapUrl,
        ],
        { timeout: 30_000 },
      ),
    ),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [String((result.reason as { stderr?: string }).stderr)] : [],
  );
  expect(failures).toEqual([]);
  const sqlite = new Database(file, { readonly: true });
  try {
    expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    const columns = (table: string) =>
      (sqlite.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name);
    expect(columns("accounts")).toContain("ibkr_sync_time_zone");
    expect(columns("executions")).toContain("import_metadata_json");
    expect(columns("folders")).toContain("deleted_at");
    expect(sqlite.prepare("SELECT count(*) AS n FROM folders").get()).toEqual({ n: 5 });
  } finally {
    sqlite.close();
  }
}

it.each([1, 2, 3])(
  "creates a fresh journal from concurrent processes without SQLITE_BUSY (batch %i)",
  async (round) => {
    await openConcurrently(join(scratch, `fresh-${round}.db`));
  },
  60_000,
);

it("upgrades a legacy rollback-journal database from concurrent processes", async () => {
  const file = join(scratch, "legacy.db");
  const legacy = new Database(file);
  legacy.exec(
    BOOTSTRAP_SQL.replace("  ibkr_sync_time_zone TEXT,\n", "").replace(
      "  import_metadata_json TEXT,\n",
      "",
    ),
  );
  expect(legacy.pragma("journal_mode", { simple: true })).toBe("delete");
  legacy.close();
  await openConcurrently(file);
}, 60_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));
