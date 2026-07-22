import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
