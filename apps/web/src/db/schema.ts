import {
  blob,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** One journal account = one broker/platform's trades (TradeZella's model, kept). */
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** SDK broker id for sync accounts; free text label otherwise. */
  broker: text("broker").notNull().default(""),
  kind: text("kind", { enum: ["sync", "import", "manual"] }).notNull(),
  currency: text("currency").notNull().default("USD"),
  initialBalance: real("initial_balance").notNull().default(0),
  profitCalcMethod: text("profit_calc_method", { enum: ["fifo", "lifo", "wavg"] })
    .notNull()
    .default("fifo"),
  /** AES-256-GCM envelope, present only for kind = "sync". */
  credentialsEnc: text("credentials_enc"),
  autoSync: integer("auto_sync", { mode: "boolean" }).notNull().default(false),
  lastSyncAt: text("last_sync_at"),
  /** Latest snapshot from sync, for display: { equity, positions } JSON. */
  snapshotJson: text("snapshot_json"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
});

export const executions = sqliteTable(
  "executions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    symbol: text("symbol").notNull(),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    quantity: real("quantity").notNull(),
    price: real("price").notNull(),
    fee: real("fee").notNull().default(0),
    executedAt: text("executed_at").notNull(),
    assetClass: text("asset_class"),
    source: text("source", { enum: ["sync", "import", "manual"] }).notNull(),
    importMetadataJson: text("import_metadata_json"),
    /** Dedup key: identical fills are inserted once per account. */
    contentHash: text("content_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("executions_account_hash").on(table.accountId, table.contentHash),
    index("executions_account_symbol").on(table.accountId, table.symbol),
  ],
);

/**
 * Materialized round trips. Computed columns are overwritten on every rebuild;
 * annotation columns (notes → reviewedAt) belong to the user and survive
 * rebuilds because the row key is rebuild-stable.
 */
export const trades = sqliteTable(
  "trades",
  {
    key: text("key").primaryKey(),
    accountId: text("account_id").notNull(),
    symbol: text("symbol").notNull(),
    assetClass: text("asset_class"),
    direction: text("direction", { enum: ["long", "short"] }).notNull(),
    status: text("status", { enum: ["open", "win", "loss", "breakeven"] }).notNull(),
    openedAt: text("opened_at").notNull(),
    closedAt: text("closed_at"),
    quantity: real("quantity").notNull(),
    openQuantity: real("open_quantity").notNull(),
    avgEntry: real("avg_entry").notNull(),
    avgExit: real("avg_exit"),
    grossPnl: real("gross_pnl").notNull(),
    fees: real("fees").notNull(),
    netPnl: real("net_pnl").notNull(),
    executionCount: integer("execution_count").notNull(),
    executionIdsJson: text("execution_ids_json").notNull(),
    exitsJson: text("exits_json").notNull(),
    durationMs: integer("duration_ms"),
    // ---- annotations (user-owned, preserved across rebuilds) ----
    notes: text("notes"),
    tagsJson: text("tags_json"),
    mistakesJson: text("mistakes_json"),
    playbookId: text("playbook_id"),
    rating: integer("rating"),
    stopLoss: real("stop_loss"),
    profitTarget: real("profit_target"),
    reviewedAt: text("reviewed_at"),
  },
  (table) => [
    index("trades_account_closed").on(table.accountId, table.closedAt),
    index("trades_symbol").on(table.symbol),
    index("trades_opened").on(table.openedAt),
    index("trades_account_opened").on(table.accountId, table.openedAt),
  ],
);

export const journalDays = sqliteTable("journal_days", {
  /** "YYYY-MM-DD" in the journal's display timezone. */
  date: text("date").primaryKey(),
  note: text("note").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const folders = sqliteTable("folders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["system", "user"] })
    .notNull()
    .default("user"),
  createdAt: text("created_at").notNull(),
});

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    folderId: text("folder_id").notNull(),
    title: text("title").notNull().default(""),
    content: text("content").notNull().default(""),
    tagsJson: text("tags_json"),
    /** Optional anchors back into the journal. */
    tradeKey: text("trade_key"),
    dayDate: text("day_date"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("notes_folder").on(table.folderId)],
);

export const playbooks = sqliteTable("playbooks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** JSON array of rule strings — the checklist. */
  rulesJson: text("rules_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  ownerType: text("owner_type").notNull(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  data: blob("data", { mode: "buffer" }).notNull(),
  createdAt: text("created_at").notNull(),
});
export const noteTemplates = sqliteTable("note_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  content: text("content").notNull(),
});
export const tradeRuleChecks = sqliteTable("trade_rule_checks", {
  id: text("id").primaryKey(),
  tradeKey: text("trade_key").notNull(),
  playbookId: text("playbook_id").notNull(),
  rule: text("rule").notNull(),
  followed: integer("followed", { mode: "boolean" }).notNull(),
});
export const progressRules = sqliteTable("progress_rules", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  stage: text("stage").notNull(),
  weekdaysJson: text("weekdays_json").notNull(),
  createdAt: text("created_at").notNull(),
  archivedAt: text("archived_at"),
});
export const progressChecks = sqliteTable("progress_checks", {
  id: text("id").primaryKey(),
  ruleId: text("rule_id").notNull(),
  date: text("date").notNull(),
  done: integer("done", { mode: "boolean" }).notNull(),
});
export const missedTrades = sqliteTable("missed_trades", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(),
  observedAt: text("observed_at").notNull(),
  playbookId: text("playbook_id"),
  entry: real("entry"),
  stop: real("stop"),
  target: real("target"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  archivedAt: text("archived_at"),
});
