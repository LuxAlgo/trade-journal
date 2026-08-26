/**
 * Idempotent schema bootstrap, run by the app at startup. Self-hosted software
 * should never make its user run a migration tool; new columns arrive as
 * additive `ALTER TABLE` guards in `MIGRATION_STEPS` below.
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

CREATE TABLE IF NOT EXISTS journal_days (
  date TEXT PRIMARY KEY,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
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

INSERT OR IGNORE INTO folders (id, name, kind, created_at) VALUES
  ('all', 'All notes', 'system', '2026-01-01T00:00:00Z'),
  ('trade-notes', 'Trade notes', 'system', '2026-01-01T00:00:00Z'),
  ('daily-journal', 'Daily journal', 'system', '2026-01-01T00:00:00Z'),
  ('session-recaps', 'Session recaps', 'system', '2026-01-01T00:00:00Z'),
  ('my-notes', 'My notes', 'system', '2026-01-01T00:00:00Z');
`;
