import {
  blob,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

export const importSources = sqliteTable("import_sources", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  format: text("format").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});
export const importSourceAliases = sqliteTable(
  "import_source_aliases",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    format: text("format").notNull(),
    aliasKey: text("alias_key").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => importSources.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("import_source_alias_unique").on(table.accountId, table.format, table.aliasKey),
  ],
);
export const importBatches = sqliteTable(
  "import_batches",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    format: text("format").notNull(),
    fingerprint: text("fingerprint").notNull(),
    rawHash: text("raw_hash").notNull(),
    timeZone: text("time_zone").notNull(),
    sourceIdsJson: text("source_ids_json").notNull(),
    fromTime: text("from_time").notNull(),
    toTime: text("to_time").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("import_batch_unique").on(table.accountId, table.format, table.fingerprint),
  ],
);

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

/** Derived market-data estimates; journal fills remain authoritative. */
export const tradeExcursions = sqliteTable("trade_excursions", {
  tradeKey: text("trade_key")
    .primaryKey()
    .references(() => trades.key, { onDelete: "cascade" }),
  fingerprint: text("fingerprint").notNull(),
  provider: text("provider").notNull(),
  symbol: text("symbol").notNull(),
  resolution: text("resolution").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  estimateJson: text("estimate_json").notNull(),
});

/** User-supplied market candles, separate from execution imports and journal exports. */
export const marketCsvDatasets = sqliteTable("market_csv_datasets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  resolution: text("resolution").notNull(),
  currency: text("currency").notNull(),
  priceBasis: text("price_basis").notNull(),
  barsJson: text("bars_json").notNull(),
  barCount: integer("bar_count").notNull(),
  firstTime: integer("first_time").notNull(),
  lastTime: integer("last_time").notNull(),
  importedAt: text("imported_at").notNull(),
});

/** User-maintained prop account attempts and actual cash flows, never journal P&L. */
export const propAccounts = sqliteTable("prop_accounts", {
  id: text("id").primaryKey(),
  firm: text("firm").notNull(),
  name: text("name").notNull(),
  program: text("program").notNull(),
  status: text("status").notNull(),
  currency: text("currency").notNull(),
  sizeMinor: integer("size_minor"),
  parentId: text("parent_id").references((): AnySQLiteColumn => propAccounts.id),
  journalAccountId: text("journal_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  openedOn: text("opened_on").notNull(),
  closedOn: text("closed_on"),
  renewalOn: text("renewal_on"),
  renewalMinor: integer("renewal_minor"),
  notes: text("notes").notNull().default(""),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const propEntries = sqliteTable(
  "prop_entries",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").references(() => propAccounts.id),
    firm: text("firm").notNull(),
    kind: text("kind").notNull(),
    category: text("category").notNull(),
    currency: text("currency").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    splitBps: integer("split_bps").notNull(),
    feeMinor: integer("fee_minor").notNull(),
    occurredOn: text("occurred_on").notNull(),
    dueOn: text("due_on"),
    status: text("status").notNull(),
    parentId: text("parent_id").references((): AnySQLiteColumn => propEntries.id),
    reference: text("reference").notNull().default(""),
    notes: text("notes").notNull().default(""),
    voided: integer("voided", { mode: "boolean" }).notNull().default(false),
    revision: integer("revision").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("prop_entries_account_date").on(table.accountId, table.occurredOn),
    index("prop_entries_date").on(table.occurredOn),
  ],
);
export const propReceipts = sqliteTable(
  "prop_receipts",
  {
    id: text("id").primaryKey(),
    payoutId: text("payout_id")
      .notNull()
      .references(() => propEntries.id),
    kind: text("kind").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    occurredOn: text("occurred_on").notNull(),
    reference: text("reference").notNull().default(""),
    notes: text("notes").notNull().default(""),
    voided: integer("voided", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("prop_receipts_payout").on(table.payoutId)],
);
export const propAudit = sqliteTable(
  "prop_audit",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json").notNull(),
    reason: text("reason").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("prop_audit_entity").on(table.entityType, table.entityId)],
);
