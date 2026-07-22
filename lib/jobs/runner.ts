import { generateMorningBrief } from "../ai/morning-brief";
import { bucketLimitLadder, calculateBreadth, classifyLimitStatus, rankLeaders, rankSectors } from "../domain/metrics";
import type { Breadth, DailyReview, Quote, SectorMetric } from "../domain/types";
import { createEastmoneyProvider } from "../data/eastmoney";
import { beijingDateParts, jobForBeijingTime, type ScheduledJob } from "./schedule";

export interface PanLayerEnv {
  DB?: D1Database;
  OPENAI_API_KEY?: string;
}

export function buildDailyReview({
  date, quotes, limitPool, breadth, marginBalance, high120, allTimeHigh, source,
}: {
  date: string;
  quotes: Quote[];
  limitPool: Quote[];
  breadth: Array<Breadth & { time: string }>;
  marginBalance: number | null;
  high120: number | null;
  allTimeHigh: number | null;
  source: string;
}): DailyReview {
  const pool = new Map(limitPool.map((item) => [item.symbol, item]));
  const merged = quotes.map((item) => pool.has(item.symbol) ? { ...item, ...pool.get(item.symbol) } : item);
  const sectors = new Map<string, Quote[]>();
  merged.forEach((item) => sectors.set(item.sector, [...(sectors.get(item.sector) ?? []), item]));
  const sectorMetrics: SectorMetric[] = [...sectors].map(([name, items]) => ({
    name,
    limitUpCount: items.filter((item) => classifyLimitStatus(item) === "limit-up").length,
    averagePct: Number((items.reduce((sum, item) => sum + item.pctChange, 0) / items.length).toFixed(2)),
    amountGrowthPct: 0,
    maxStreak: Math.max(0, ...items.map((item) => item.limitStreak)),
  }));
  const limitUps = merged.filter((item) => classifyLimitStatus(item) === "limit-up");
  return {
    date,
    status: high120 === null || allTimeHigh === null ? "partial" : "complete",
    source,
    updatedAt: `${date} 16:10`,
    breadth,
    metrics: {
      limitUp: limitUps.length,
      limitDown: merged.filter((item) => classifyLimitStatus(item) === "limit-down").length,
      consecutive: limitUps.filter((item) => item.limitStreak >= 2).length,
      largeRise: merged.filter((item) => item.pctChange >= 7 && classifyLimitStatus(item) !== "limit-up").length,
      high120,
      allTimeHigh,
      marginBalance,
    },
    premium: { openPct: null, closePct: null, sampleSize: 0 },
    ladder: bucketLimitLadder(merged),
    sectors: rankSectors(sectorMetrics).slice(0, 20),
    leaders: rankLeaders(limitUps).slice(0, 20),
  };
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS breadth_snapshots (trade_date TEXT NOT NULL, snapshot_time TEXT NOT NULL, rising INTEGER NOT NULL, falling INTEGER NOT NULL, flat INTEGER NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (trade_date, snapshot_time))`,
  `CREATE TABLE IF NOT EXISTS daily_reviews (trade_date TEXT PRIMARY KEY, payload TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS morning_briefs (trade_date TEXT PRIMARY KEY, model TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS job_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT NOT NULL, trade_date TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, finished_at TEXT)`,
];

async function ensureRuntimeSchema(db: D1Database) {
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
}

async function loadBreadth(db: D1Database, date: string) {
  const result = await db.prepare("SELECT snapshot_time, rising, falling, flat FROM breadth_snapshots WHERE trade_date = ? ORDER BY snapshot_time").bind(date).all<{ snapshot_time: string; rising: number; falling: number; flat: number }>();
  return (result.results ?? []).map((row) => ({ time: String(row.snapshot_time), rising: Number(row.rising), falling: Number(row.falling), flat: Number(row.flat) }));
}

export async function runPanLayerJob(job: ScheduledJob, now: Date, env: PanLayerEnv): Promise<{ ok: boolean; message: string }> {
  if (!env.DB) throw new Error("DB binding is unavailable");
  const db = env.DB;
  await ensureRuntimeSchema(db);
  const { date } = beijingDateParts(now);
  const startedAt = new Date().toISOString();
  const label = job.type === "breadth" ? `breadth-${job.time}` : job.type;
  const run = await db.prepare("INSERT INTO job_runs (job, trade_date, status, started_at) VALUES (?, ?, 'running', ?) RETURNING id").bind(label, date, startedAt).first<{ id: number }>();
  const provider = createEastmoneyProvider();
  try {
    if (job.type === "breadth") {
      const quotes = await provider.getQuotes(job.time);
      if (quotes.length === 0) throw new Error("行情源返回空数据，可能为休市日");
      const metric = calculateBreadth(quotes);
      await db.prepare(`INSERT INTO breadth_snapshots (trade_date, snapshot_time, rising, falling, flat, source, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'complete', ?) ON CONFLICT(trade_date, snapshot_time) DO UPDATE SET rising=excluded.rising, falling=excluded.falling, flat=excluded.flat, source=excluded.source, status=excluded.status, updated_at=excluded.updated_at`).bind(date, job.time, metric.rising, metric.falling, metric.flat, provider.name, new Date().toISOString()).run();
    } else if (job.type === "close-review") {
      const [quotes, limitPool, marginBalance] = await Promise.all([provider.getQuotes("16:10"), provider.getLimitPool(date), provider.getMarginBalance(date).catch(() => null)]);
      if (quotes.length === 0) throw new Error("行情源返回空数据，可能为休市日");
      const breadth = await loadBreadth(db, date);
      const review = buildDailyReview({ date, quotes, limitPool, breadth, marginBalance, high120: null, allTimeHigh: null, source: provider.name });
      await db.prepare(`INSERT INTO daily_reviews (trade_date, payload, source, status, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(trade_date) DO UPDATE SET payload=excluded.payload, source=excluded.source, status=excluded.status, updated_at=excluded.updated_at`).bind(date, JSON.stringify(review), provider.name, review.status, new Date().toISOString()).run();
    } else {
      const brief = await generateMorningBrief({ date, apiKey: env.OPENAI_API_KEY ?? "" });
      await db.prepare(`INSERT INTO morning_briefs (trade_date, model, payload, status, updated_at) VALUES (?, 'gpt-5.6-terra', ?, 'complete', ?) ON CONFLICT(trade_date) DO UPDATE SET payload=excluded.payload, status=excluded.status, updated_at=excluded.updated_at`).bind(date, JSON.stringify(brief), new Date().toISOString()).run();
    }
    await db.prepare("UPDATE job_runs SET status='complete', finished_at=? WHERE id=?").bind(new Date().toISOString(), run?.id).run();
    return { ok: true, message: `${label} complete` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.prepare("UPDATE job_runs SET status='failed', message=?, finished_at=? WHERE id=?").bind(message, new Date().toISOString(), run?.id).run();
    throw error;
  }
}

export function scheduledJobFromDate(now: Date): ScheduledJob | null {
  return jobForBeijingTime(beijingDateParts(now).time);
}
