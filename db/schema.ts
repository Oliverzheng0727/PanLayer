import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const stocks = sqliteTable("stocks", {
  symbol: text("symbol").primaryKey(),
  name: text("name").notNull(),
  exchange: text("exchange").notNull(),
  board: text("board").notNull(),
  sector: text("sector").notNull().default("未分类"),
  updatedAt: text("updated_at").notNull(),
});

export const breadthSnapshots = sqliteTable("breadth_snapshots", {
  tradeDate: text("trade_date").notNull(),
  snapshotTime: text("snapshot_time").notNull(),
  rising: integer("rising").notNull(),
  falling: integer("falling").notNull(),
  flat: integer("flat").notNull(),
  source: text("source").notNull(),
  status: text("status").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.tradeDate, table.snapshotTime] })]);

export const dailyReviews = sqliteTable("daily_reviews", {
  tradeDate: text("trade_date").primaryKey(),
  payload: text("payload").notNull(),
  source: text("source").notNull(),
  status: text("status").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const morningBriefs = sqliteTable("morning_briefs", {
  tradeDate: text("trade_date").primaryKey(),
  model: text("model").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const morningBriefSections = sqliteTable("morning_brief_sections", {
  tradeDate: text("trade_date").notNull(),
  sectionKey: text("section_key").notNull(),
  model: text("model").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull().default(0),
  error: text("error").notNull().default(""),
  generatedAt: text("generated_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.tradeDate, table.sectionKey] })]);

export const jobLeases = sqliteTable("job_leases", {
  job: text("job").notNull(),
  tradeDate: text("trade_date").notNull(),
  token: text("token").notNull(),
  acquiredAt: text("acquired_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [primaryKey({ columns: [table.job, table.tradeDate] })]);

export const etfSnapshots = sqliteTable("etf_snapshots", {
  tradeDate: text("trade_date").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  price: text("price").notNull(),
  pctChange: text("pct_change").notNull(),
  amount: text("amount").notNull(),
  scale: text("scale"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.tradeDate, table.symbol] }), index("etf_trade_date_idx").on(table.tradeDate)]);

export const etfCatalogCache = sqliteTable("etf_catalog_cache", {
  tradeDate: text("trade_date").primaryKey(),
  payload: text("payload").notNull(),
  source: text("source").notNull(),
  status: text("status").notNull(),
  receivedAt: text("received_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const userEtfWatchlist = sqliteTable("user_etf_watchlist", {
  userEmail: text("user_email").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  exchange: text("exchange").notNull(),
  category: text("category").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userEmail, table.symbol] }),
  index("user_etf_watchlist_email_idx").on(table.userEmail, table.createdAt),
]);

export const jobRuns = sqliteTable("job_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  job: text("job").notNull(),
  tradeDate: text("trade_date").notNull(),
  status: text("status").notNull(),
  message: text("message").notNull().default(""),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
}, (table) => [index("job_runs_date_idx").on(table.tradeDate, table.job)]);

export const bootstrapState = sqliteTable("bootstrap_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const newHighDetails = sqliteTable("new_high_details", {
  tradeDate: text("trade_date").notNull(),
  type: text("type").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  sector: text("sector").notNull(),
  pctChange: real("pct_change").notNull(),
  close: real("close").notNull(),
  highPrice: real("high_price").notNull(),
  amount: real("amount").notNull(),
  intervalPct: real("interval_pct").notNull(),
  highDate: text("high_date").notNull(),
  isAllTime: integer("is_all_time", { mode: "boolean" }).notNull(),
}, (table) => [primaryKey({ columns: [table.tradeDate, table.type, table.symbol] }), index("new_high_date_idx").on(table.tradeDate, table.type)]);

export const newHighStates = sqliteTable("new_high_states", {
  symbol: text("symbol").primaryKey(),
  name: text("name").notNull(),
  sector: text("sector").notNull(),
  lastDate: text("last_date").notNull(),
  lastClose: real("last_close").notNull(),
  closesJson: text("closes_json").notNull(),
  allTimeHigh: real("all_time_high").notNull(),
  allTimeHighDate: text("all_time_high_date").notNull(),
  firstClose: real("first_close").notNull(),
  initializedThrough: text("initialized_through").notNull(),
  status: text("status").notNull().default("active"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("new_high_states_progress_idx").on(table.status, table.initializedThrough),
]);

export const marketSourceAudits = sqliteTable("market_source_audits", {
  tradeDate: text("trade_date").notNull(),
  snapshotTime: text("snapshot_time").notNull(),
  source: text("source").notNull(),
  marketTime: text("market_time"),
  receivedAt: text("received_at").notNull(),
  rawCount: integer("raw_count").notNull(),
  validCount: integer("valid_count").notNull(),
  invalidCount: integer("invalid_count").notNull(),
  coveragePct: real("coverage_pct").notNull(),
  directionAgreementPct: real("direction_agreement_pct"),
  priceAgreementPct: real("price_agreement_pct"),
  breadthDifference: integer("breadth_difference"),
  status: text("status").notNull(),
  message: text("message").notNull().default(""),
}, (table) => [primaryKey({ columns: [table.tradeDate, table.snapshotTime, table.source] }), index("market_audit_date_idx").on(table.tradeDate, table.snapshotTime)]);

export const globalMarketSnapshots = sqliteTable("global_market_snapshots", {
  tradeDate: text("trade_date").notNull(),
  symbol: text("symbol").notNull(),
  label: text("label").notNull(),
  provider: text("provider").notNull(),
  marketTime: text("market_time"),
  receivedAt: text("received_at").notNull(),
  value: real("value"),
  previousClose: real("previous_close"),
  pctChange: real("pct_change"),
  period: text("period").notNull(),
  status: text("status").notNull(),
  message: text("message").notNull().default(""),
}, (table) => [primaryKey({ columns: [table.tradeDate, table.symbol, table.provider] }), index("global_snapshot_date_idx").on(table.tradeDate)]);
