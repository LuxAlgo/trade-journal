import Database from "better-sqlite3";

/**
 * Idempotent schema bootstrap, run by the app at startup. Self-hosted software
 * should never make its user run a migration tool; new columns arrive as
 * additive `ALTER TABLE` guards in `migrate` below.
 *
 * Keep in sync with schema.ts.
 */
export const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  broker TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  initial_balance REAL NOT NULL DEFAULT 0,
  profit_calc_method TEXT NOT NULL DEFAULT 'fifo',
  credentials_enc TEXT,
  auto_sync INTEGER NOT NULL DEFAULT 0,
  last_sync_at TEXT,
  ibkr_sync_time_zone TEXT,
  snapshot_json TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  fee REAL NOT NULL DEFAULT 0,
  executed_at TEXT NOT NULL,
  asset_class TEXT,
  source TEXT NOT NULL,
  import_metadata_json TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS executions_account_hash ON executions (account_id, content_hash);
CREATE INDEX IF NOT EXISTS executions_account_symbol ON executions (account_id, symbol);

CREATE TABLE IF NOT EXISTS trades (
  key TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  asset_class TEXT,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  quantity REAL NOT NULL,
  open_quantity REAL NOT NULL,
  avg_entry REAL NOT NULL,
  avg_exit REAL,
  gross_pnl REAL NOT NULL,
  fees REAL NOT NULL,
  net_pnl REAL NOT NULL,
  execution_count INTEGER NOT NULL,
  execution_ids_json TEXT NOT NULL,
  exits_json TEXT NOT NULL,
  duration_ms INTEGER,
  notes TEXT,
  tags_json TEXT,
  mistakes_json TEXT,
  playbook_id TEXT,
  rating INTEGER,
  stop_loss REAL,
  profit_target REAL,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS trades_account_closed ON trades (account_id, closed_at);
CREATE INDEX IF NOT EXISTS trades_symbol ON trades (symbol);
CREATE INDEX IF NOT EXISTS trades_opened ON trades (opened_at);
CREATE INDEX IF NOT EXISTS trades_account_opened ON trades (account_id, opened_at);

CREATE TABLE IF NOT EXISTS market_csv_datasets (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, symbol TEXT NOT NULL,
 resolution TEXT NOT NULL, currency TEXT NOT NULL, price_basis TEXT NOT NULL,
 bars_json TEXT NOT NULL, imported_at TEXT NOT NULL,
 bar_count INTEGER NOT NULL, first_time INTEGER NOT NULL, last_time INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS market_csv_symbol_resolution ON market_csv_datasets(symbol, resolution);

CREATE TABLE IF NOT EXISTS trade_excursions (
  trade_key TEXT PRIMARY KEY REFERENCES trades(key) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  provider TEXT NOT NULL,
  symbol TEXT NOT NULL,
  resolution TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  estimate_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_days (
  date TEXT PRIMARY KEY,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  tags_json TEXT,
  trade_key TEXT,
  day_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_folder ON notes (folder_id);

CREATE TABLE IF NOT EXISTS playbooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rules_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS attachments_owner ON attachments(owner_type, owner_id);
CREATE TABLE IF NOT EXISTS note_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, content TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trade_rule_checks (id TEXT PRIMARY KEY, trade_key TEXT NOT NULL, playbook_id TEXT NOT NULL, rule TEXT NOT NULL, followed INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS trade_rule_checks_trade ON trade_rule_checks(trade_key);
CREATE TABLE IF NOT EXISTS progress_rules (id TEXT PRIMARY KEY, title TEXT NOT NULL, stage TEXT NOT NULL, weekdays_json TEXT NOT NULL, created_at TEXT NOT NULL, archived_at TEXT);
CREATE TABLE IF NOT EXISTS progress_checks (id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, date TEXT NOT NULL, done INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS progress_checks_date ON progress_checks(date);
CREATE TABLE IF NOT EXISTS missed_trades (id TEXT PRIMARY KEY, symbol TEXT NOT NULL, direction TEXT NOT NULL, observed_at TEXT NOT NULL, playbook_id TEXT, entry REAL, stop REAL, target REAL, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, archived_at TEXT);

INSERT OR IGNORE INTO folders (id, name, kind, created_at) VALUES
  ('all', 'All notes', 'system', '2026-01-01T00:00:00Z'),
  ('trade-notes', 'Trade notes', 'system', '2026-01-01T00:00:00Z'),
  ('daily-journal', 'Daily journal', 'system', '2026-01-01T00:00:00Z'),
  ('session-recaps', 'Session recaps', 'system', '2026-01-01T00:00:00Z'),
  ('my-notes', 'My notes', 'system', '2026-01-01T00:00:00Z');

CREATE TABLE IF NOT EXISTS prop_accounts (
 id TEXT PRIMARY KEY, firm TEXT NOT NULL, name TEXT NOT NULL, program TEXT NOT NULL,
 status TEXT NOT NULL, currency TEXT NOT NULL, size_minor INTEGER, parent_id TEXT REFERENCES prop_accounts(id),
 journal_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
 opened_on TEXT NOT NULL, closed_on TEXT, renewal_on TEXT, renewal_minor INTEGER, notes TEXT NOT NULL DEFAULT '',
 archived INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prop_entries (
 id TEXT PRIMARY KEY, account_id TEXT REFERENCES prop_accounts(id), firm TEXT NOT NULL, kind TEXT NOT NULL,
 category TEXT NOT NULL, currency TEXT NOT NULL, amount_minor INTEGER NOT NULL, split_bps INTEGER NOT NULL,
 fee_minor INTEGER NOT NULL, occurred_on TEXT NOT NULL, due_on TEXT, status TEXT NOT NULL,
 parent_id TEXT REFERENCES prop_entries(id), reference TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
 voided INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS prop_entries_account_date ON prop_entries(account_id, occurred_on);
CREATE INDEX IF NOT EXISTS prop_entries_date ON prop_entries(occurred_on);
CREATE TABLE IF NOT EXISTS prop_receipts (
 id TEXT PRIMARY KEY, payout_id TEXT NOT NULL REFERENCES prop_entries(id), kind TEXT NOT NULL, amount_minor INTEGER NOT NULL,
 occurred_on TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
 voided INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS prop_receipts_payout ON prop_receipts(payout_id);
CREATE TABLE IF NOT EXISTS prop_audit (
 id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, before_json TEXT,
 after_json TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS prop_audit_entity ON prop_audit(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS import_sources (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 format TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS import_source_aliases (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 format TEXT NOT NULL, alias_key TEXT NOT NULL,
 source_id TEXT NOT NULL REFERENCES import_sources(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS import_source_alias_unique ON import_source_aliases(account_id, format, alias_key);
CREATE TABLE IF NOT EXISTS import_batches (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 format TEXT NOT NULL, fingerprint TEXT NOT NULL, raw_hash TEXT NOT NULL, time_zone TEXT NOT NULL,
 source_ids_json TEXT NOT NULL, from_time TEXT NOT NULL, to_time TEXT NOT NULL,
 snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS import_batch_unique ON import_batches(account_id, format, fingerprint);
`;

const hasColumn = (sqlite: Database.Database, table: string, name: string) =>
  (sqlite.pragma(`table_info(${table})`) as { name: string }[]).some(
    (column) => column.name === name,
  );

function migrate(sqlite: Database.Database) {
  sqlite.exec(BOOTSTRAP_SQL);
  if (!hasColumn(sqlite, "folders", "deleted_at")) {
    sqlite.exec("ALTER TABLE folders ADD COLUMN deleted_at TEXT");
  }
  if (!hasColumn(sqlite, "accounts", "ibkr_sync_time_zone")) {
    sqlite.exec("ALTER TABLE accounts ADD COLUMN ibkr_sync_time_zone TEXT");
  }
  // Additive upgrade: existing executions retain their fields and dedup hashes.
  if (!hasColumn(sqlite, "executions", "import_metadata_json")) {
    sqlite.exec("ALTER TABLE executions ADD COLUMN import_metadata_json TEXT");
  }
  // Materialize CSV bounds once so connection and range lookups never scan candle JSON.
  for (const name of ["bar_count", "first_time", "last_time"]) {
    if (!hasColumn(sqlite, "market_csv_datasets", name))
      sqlite.exec(`ALTER TABLE market_csv_datasets ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`);
  }
  sqlite.exec(`UPDATE market_csv_datasets SET
    bar_count = json_array_length(bars_json),
    first_time = json_extract(bars_json, '$[0].time'),
    last_time = json_extract(bars_json, '$[#-1].time') WHERE bar_count = 0`);
}

const SETUP_DEADLINE_MS = 15_000;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

/**
 * `next build` imports route modules from several workers at once and each one
 * opens the journal. SQLite refuses some lock upgrades immediately instead of
 * waiting out busy_timeout (switching a fresh file to WAL, for one), so setup
 * retries those with a short, jittered backoff.
 */
function retryWhileBusy<T>(step: () => T): T {
  const deadline = Date.now() + SETUP_DEADLINE_MS;
  for (let delay = 5; ; delay = Math.min(delay * 2, 250)) {
    try {
      return step();
    } catch (error) {
      const busy = error instanceof Database.SqliteError && error.code.startsWith("SQLITE_BUSY");
      if (!busy || Date.now() >= deadline) throw error;
      Atomics.wait(sleeper, 0, 0, delay * (0.5 + Math.random()));
    }
  }
}

/** Opens the journal and brings its schema up to date; safe to call from many processes at once. */
export function openJournalDatabase(file: string): Database.Database {
  const sqlite = new Database(file);
  retryWhileBusy(() => sqlite.pragma("journal_mode = WAL"));
  sqlite.pragma("foreign_keys = ON");
  // One write lock covers every column check and ALTER, so concurrent first runs
  // cannot both decide a column is missing.
  retryWhileBusy(() => sqlite.transaction(() => migrate(sqlite)).immediate());
  return sqlite;
}
