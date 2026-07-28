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

export const jobCheckpoints = sqliteTable("job_checkpoints", {
  tradeDate: text("trade_date").notNull(),
  jobKey: text("job_key").notNull(),
  stage: text("stage").notNull().default("main"),
  status: text("status").notNull(),
  attempt: integer("attempt").notNull().default(0),
  expectedAt: text("expected_at").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  nextRetryAt: text("next_retry_at"),
  message: text("message").notNull().default(""),
  resultJson: text("result_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tradeDate, table.jobKey, table.stage] }),
  index("job_checkpoints_due_idx").on(table.tradeDate, table.status, table.nextRetryAt),
]);

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

export const newHighBootstrapFailures = sqliteTable("new_high_bootstrap_failures", {
  symbol: text("symbol").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error").notNull(),
  nextRetryAt: text("next_retry_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("new_high_bootstrap_retry_idx").on(table.nextRetryAt, table.attempts),
]);

export const historyBarContributions = sqliteTable("history_bar_contributions", {
  symbol: text("symbol").primaryKey(),
  name: text("name").notNull(),
  isST: integer("is_st", { mode: "boolean" }).notNull(),
  firstDate: text("first_date").notNull(),
  targetDate: text("target_date").notNull(),
  barsJson: text("bars_json").notNull(),
  source: text("source").notNull(),
  status: text("status").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("history_contribution_progress_idx").on(table.targetDate, table.status),
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

export const briefMarketEvidence = sqliteTable("brief_market_evidence", {
  tradeDate: text("trade_date").notNull(),
  provider: text("provider").notNull(),
  referenceDate: text("reference_date").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull(),
  receivedAt: text("received_at").notNull(),
}, (table) => [primaryKey({ columns: [table.tradeDate, table.provider] })]);

export const structuredMarketSignals = sqliteTable("structured_market_signals", {
  tradeDate: text("trade_date").notNull(),
  dataset: text("dataset").notNull(),
  provider: text("provider").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull(),
  marketTime: text("market_time"),
  receivedAt: text("received_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tradeDate, table.dataset, table.provider] }),
]);

export const briefSources = sqliteTable("brief_sources", {
  sourceId: text("source_id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  industryKeysJson: text("industry_keys_json").notNull(),
  sourceTier: integer("source_tier").notNull(),
  transport: text("transport").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastStatus: text("last_status"),
  lastSuccessAt: text("last_success_at"),
  lastError: text("last_error"),
  latencyMs: integer("latency_ms"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("brief_sources_url_tier_idx").on(table.url, table.sourceTier)]);

export const briefItems = sqliteTable("brief_items", {
  itemId: text("item_id").notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  title: text("title").notNull(),
  excerpt: text("excerpt"),
  publishedAt: text("published_at"),
  receivedAt: text("received_at").notNull(),
  fetchDate: text("fetch_date").notNull(),
  runId: text("run_id").notNull(),
  sourceIdsJson: text("source_ids_json").notNull(),
  sourceNamesJson: text("source_names_json").notNull(),
  industryKeysJson: text("industry_keys_json").notNull(),
  sourceTier: integer("source_tier").notNull(),
  verificationStatus: text("verification_status").notNull(),
  corroboratingUrlsJson: text("corroborating_urls_json").notNull(),
  contentHash: text("content_hash").notNull(),
  filterStatus: text("filter_status").notNull(),
  filterReason: text("filter_reason"),
}, (table) => [
  primaryKey({ columns: [table.fetchDate, table.itemId] }),
  index("brief_items_date_run_idx").on(table.fetchDate, table.runId),
]);

export const briefFetchRuns = sqliteTable("brief_fetch_runs", {
  runId: text("run_id").primaryKey(),
  fetchDate: text("fetch_date").notNull(),
  sourceTier: integer("source_tier").notNull(),
  transport: text("transport").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status").notNull(),
  sourceTotal: integer("source_total").notNull(),
  sourceSuccess: integer("source_success").notNull(),
  rawItemCount: integer("raw_item_count").notNull(),
  keptItemCount: integer("kept_item_count").notNull(),
  filteredItemCount: integer("filtered_item_count").notNull(),
  errorSummaryJson: text("error_summary_json").notNull().default("[]"),
}, (table) => [
  index("brief_fetch_runs_date_tier_idx").on(table.fetchDate, table.sourceTier, table.finishedAt),
]);
