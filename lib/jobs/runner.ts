import { BRIEF_SECTION_DEFINITIONS, type BriefSectionKey, type MorningBrief } from "../ai/morning-brief-contract";
import { assembleMorningBrief, failedBriefSection, persistBriefSection, readPersistedBriefSections } from "../ai/morning-brief-assembly";
import {
  generateOpenAIBriefSection,
  generateQwenBriefSection,
  QWEN_BRIEF_SECTION_MODEL,
  type BriefSectionGenerator,
  type GeneratedBriefSection,
  type MorningBriefMarketContext,
} from "../ai/morning-brief-providers";
import { bucketLimitLadder, calculateBreadth, classifyLimitStatus, rankLeaders, rankSectors } from "../domain/metrics";
import type { Breadth, DailyReview, Quote, SectorMetric } from "../domain/types";
import { createEastmoneyProvider } from "../data/eastmoney";
import { loadGlobalOvernightSnapshot } from "../data/global/overnight";
import type { GlobalPoint } from "../data/global/types";
import { runDomesticPipeline } from "../data/market-pipeline";
import type { SourceAudit } from "../data/quality";
import { fetchTencentQuotes } from "../data/tencent";
import { beijingDateParts, jobForBeijingTime, type ScheduledJob } from "./schedule";

const MINIMUM_ALL_A_UNIVERSE = 5_000;
const MORNING_BRIEF_LEASE_MS = 15 * 60 * 1_000;

export interface MorningBriefLease {
  token: string;
  renew: () => Promise<boolean>;
}

export class LeaseLostError extends Error {
  constructor() {
    super("Morning brief lease is no longer current");
    this.name = "LeaseLostError";
  }
}

export interface PanLayerEnv {
  DB?: D1Database;
  DASHSCOPE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  TWELVE_DATA_API_KEY?: string;
  ALPHA_VANTAGE_API_KEY?: string;
  FRED_API_KEY?: string;
  EIA_API_KEY?: string;
}

export function resolveMorningBriefProvider(env: Pick<PanLayerEnv, "DASHSCOPE_API_KEY" | "OPENAI_API_KEY">): {
  provider: "qwen" | "openai";
  apiKey: string;
  model: string;
} {
  if (env.DASHSCOPE_API_KEY) {
    return { provider: "qwen", apiKey: env.DASHSCOPE_API_KEY, model: QWEN_BRIEF_SECTION_MODEL };
  }
  if (env.OPENAI_API_KEY) {
    return { provider: "openai", apiKey: env.OPENAI_API_KEY, model: "gpt-5.6-terra" };
  }
  throw new Error("DASHSCOPE_API_KEY is not configured and OPENAI_API_KEY fallback is unavailable");
}

export function shouldSkipMorningBrief(existingStatus: string | null | undefined, force: boolean): boolean {
  return existingStatus === "complete" && !force;
}

export async function acquireJobLease(db: D1Database, job: string, tradeDate: string, now = new Date()): Promise<string | null> {
  const token = crypto.randomUUID();
  const acquiredAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + MORNING_BRIEF_LEASE_MS).toISOString();
  const row = await db.prepare(`INSERT INTO job_leases (job, trade_date, token, acquired_at, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(job, trade_date) DO UPDATE SET token=excluded.token, acquired_at=excluded.acquired_at, expires_at=excluded.expires_at WHERE job_leases.expires_at <= ? RETURNING token`)
    .bind(job, tradeDate, token, acquiredAt, expiresAt, acquiredAt).first<{ token: string }>();
  return row?.token === token ? token : null;
}

export async function releaseJobLease(db: D1Database, job: string, tradeDate: string, token: string): Promise<void> {
  await db.prepare("DELETE FROM job_leases WHERE job = ? AND trade_date = ? AND token = ?").bind(job, tradeDate, token).run();
}

export async function renewJobLease(db: D1Database, job: string, tradeDate: string, token: string, now = new Date()): Promise<boolean> {
  const acquiredAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + MORNING_BRIEF_LEASE_MS).toISOString();
  const row = await db.prepare("UPDATE job_leases SET acquired_at = ?, expires_at = ? WHERE job = ? AND trade_date = ? AND token = ? AND expires_at > ? RETURNING token")
    .bind(acquiredAt, expiresAt, job, tradeDate, token, acquiredAt).first<{ token: string }>();
  return row?.token === token;
}

async function assertMorningBriefLease(lease: MorningBriefLease | undefined): Promise<void> {
  if (lease && !await lease.renew()) throw new LeaseLostError();
}

function isLeaseLost(error: unknown): boolean {
  return error instanceof Error && error.name === "LeaseLostError";
}

export async function failedOrMissingBriefSectionKeys(db: D1Database, date: string): Promise<BriefSectionKey[]> {
  const persisted = new Map((await readPersistedBriefSections(db, date)).map((item) => [item.section.key, item.section.status]));
  return BRIEF_SECTION_DEFINITIONS.flatMap((definition) => persisted.get(definition.key) === "complete" ? [] : [definition.key]);
}

type RejectedSection = { key: BriefSectionKey; error: string };
type SectionRunResult = GeneratedBriefSection | RejectedSection;

function beijingTimestamp(now = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1_000).toISOString().replace("Z", "+08:00");
}

function isGeneratedSection(result: SectionRunResult): result is GeneratedBriefSection {
  return "section" in result;
}

export async function loadMorningBriefMarketContext(db: D1Database, date: string): Promise<MorningBriefMarketContext> {
  const fallback: MorningBriefMarketContext = { review: null, etfs: [] };
  try {
    const reviewRow = await db.prepare("SELECT trade_date, payload, status FROM daily_reviews WHERE trade_date < ? ORDER BY trade_date DESC LIMIT 1").bind(date).first<{ trade_date: string; payload: string; status: DailyReview["status"] }>().catch(() => null);
    const etfResult = await db.prepare("SELECT category, name, symbol FROM etf_snapshots WHERE trade_date = (SELECT MAX(trade_date) FROM etf_snapshots WHERE trade_date < ?) ORDER BY category, symbol LIMIT 120").bind(date).all<{ category: string; name: string; symbol: string }>().catch(() => ({ results: [] }));
    let review: MorningBriefMarketContext["review"] = null;
    if (reviewRow?.payload) {
      const parsed = JSON.parse(reviewRow.payload) as DailyReview;
      const closeBreadth = parsed.breadth?.at(-1);
      if (parsed && typeof parsed.date === "string" && Array.isArray(parsed.sectors) && Array.isArray(parsed.leaders) && parsed.metrics && parsed.ladder) {
        review = {
          date: parsed.date, status: parsed.status, closeBreadth: closeBreadth ? { rising: closeBreadth.rising, falling: closeBreadth.falling, flat: closeBreadth.flat } : null,
          metrics: { ...parsed.metrics },
          ladder: { first: parsed.ladder.first.length, second: parsed.ladder.second.length, third: parsed.ladder.third.length, fourth: parsed.ladder.fourth.length, fivePlus: parsed.ladder.fivePlus.length },
          sectors: parsed.sectors.slice(0, 20).map((item) => ({ name: item.name, factors: { limitUpCount: item.limitUpCount, averagePct: item.averagePct, amountGrowthPct: item.amountGrowthPct, maxStreak: item.maxStreak } })),
          leaders: parsed.leaders.slice(0, 20).map((item) => ({ name: item.name, symbol: item.symbol, factors: { pctChange: item.pctChange, amount: item.amount, limitStreak: item.limitStreak, isLimitUp: classifyLimitStatus(item) === "limit-up", firstLimitTime: item.firstLimitTime, sector: item.sector } })),
        };
      }
    }
    return { review, etfs: (etfResult.results ?? []).flatMap((item) => typeof item.category === "string" && typeof item.name === "string" && typeof item.symbol === "string" ? [{ category: item.category, name: item.name, code: item.symbol }] : []) };
  } catch { return fallback; }
}

export async function generateFullMorningBrief(input: {
  date: string;
  model: string;
  sectionKeys: BriefSectionKey[];
  generator: BriefSectionGenerator;
  db: D1Database;
  concurrency?: number;
  retries?: number;
  globalSnapshot?: import("../data/global/types").ReconciledGlobalPoint[];
  marketContext?: MorningBriefMarketContext;
  lease?: MorningBriefLease;
}): Promise<MorningBrief> {
  const requestedKeys = input.sectionKeys;
  if (new Set(requestedKeys).size !== requestedKeys.length) throw new Error("Duplicate brief section keys are not allowed");
  const globalSnapshot = input.globalSnapshot ?? (await loadGlobalOvernightSnapshot({}, fetch)).reconciled;
  await assertMorningBriefLease(input.lease);
  const persistedSections = await readPersistedBriefSections(input.db, input.date);
  const persistedByKey = new Map(persistedSections.map((item) => [item.section.key, item]));
  const results: SectionRunResult[] = Array(requestedKeys.length);
  const maxAttempts = Math.min(3, Math.max(0, input.retries ?? 2) + 1);
  const workerCount = Math.min(2, Math.max(1, input.concurrency ?? 2), requestedKeys.length);
  let cursor = 0;

  const runSectionWithRetry = async (key: BriefSectionKey): Promise<SectionRunResult> => {
    let attempts = 0;
    let error = "未知错误";
    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        const result = await input.generator({ date: input.date, key, globalSnapshot, marketContext: input.marketContext });
        await persistBriefSection(input.db, input.date, input.model, result.section, attempts, "", result.sources, input.lease);
        return result;
      } catch (caught) {
        if (isLeaseLost(caught)) throw caught;
        await assertMorningBriefLease(input.lease);
        error = caught instanceof Error ? caught.message : String(caught);
      }
    }
    const failed = failedBriefSection(key, error, beijingTimestamp());
    await persistBriefSection(input.db, input.date, input.model, failed, attempts, error, [], input.lease);
    return { key, error };
  };

  const worker = async () => {
    while (cursor < requestedKeys.length) {
      const index = cursor++;
      results[index] = await runSectionWithRetry(requestedKeys[index]);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, worker));

  const generatedByKey = new Map(results.map((result) => [isGeneratedSection(result) ? result.section.key : result.key, result]));
  const assembled = assembleMorningBrief(input.date, BRIEF_SECTION_DEFINITIONS.map(({ key }) => {
    const generated = generatedByKey.get(key);
    if (generated) return generated;
    const persisted = persistedByKey.get(key);
    if (persisted) return persisted;
    return { key, error: "模块尚未生成" };
  }), beijingTimestamp());
  await assertMorningBriefLease(input.lease);
  await input.db.prepare(`INSERT INTO morning_briefs (trade_date, model, payload, status, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(trade_date) DO UPDATE SET model=excluded.model, payload=excluded.payload, status=excluded.status, updated_at=excluded.updated_at`)
    .bind(input.date, input.model, JSON.stringify(assembled), assembled.status, new Date().toISOString())
    .run();
  return assembled;
}

export async function persistSourceAudits(db: D1Database, date: string, snapshotTime: string, audits: SourceAudit[]) {
  await Promise.all(audits.map((audit) => db.prepare(`INSERT INTO market_source_audits (trade_date, snapshot_time, source, market_time, received_at, raw_count, valid_count, invalid_count, coverage_pct, direction_agreement_pct, price_agreement_pct, breadth_difference, status, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(trade_date, snapshot_time, source) DO UPDATE SET market_time=excluded.market_time, received_at=excluded.received_at, raw_count=excluded.raw_count, valid_count=excluded.valid_count, invalid_count=excluded.invalid_count, coverage_pct=excluded.coverage_pct, direction_agreement_pct=excluded.direction_agreement_pct, price_agreement_pct=excluded.price_agreement_pct, breadth_difference=excluded.breadth_difference, status=excluded.status, message=excluded.message`)
    .bind(date, snapshotTime, audit.source, audit.marketTime, audit.receivedAt, audit.rawCount, audit.validCount, audit.invalidCount, audit.coveragePct, audit.directionAgreementPct, audit.priceAgreementPct, audit.breadthDifference, audit.status, audit.message).run()));
}

export async function persistGlobalPoints(db: D1Database, date: string, points: GlobalPoint[], lease?: MorningBriefLease) {
  for (const point of points) {
    await assertMorningBriefLease(lease);
    await db.prepare(`INSERT INTO global_market_snapshots (trade_date, symbol, label, provider, market_time, received_at, value, previous_close, pct_change, period, status, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(trade_date, symbol, provider) DO UPDATE SET label=excluded.label, market_time=excluded.market_time, received_at=excluded.received_at, value=excluded.value, previous_close=excluded.previous_close, pct_change=excluded.pct_change, period=excluded.period, status=excluded.status, message=excluded.message`)
      .bind(date, point.key, point.label, point.provider, point.marketTime, point.receivedAt, point.value, point.previousClose, point.pctChange, point.period, point.status, point.message).run();
  }
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
  const resolvedBreadth = breadth.length > 0 ? breadth : [{ time: "15:00", ...calculateBreadth(quotes) }];
  return {
    date,
    status: high120 === null || allTimeHigh === null ? "partial" : "complete",
    source,
    updatedAt: `${date} 16:10`,
    breadth: resolvedBreadth,
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
  `CREATE TABLE IF NOT EXISTS stocks (symbol TEXT PRIMARY KEY, name TEXT NOT NULL, exchange TEXT NOT NULL, board TEXT NOT NULL, sector TEXT NOT NULL DEFAULT '未分类', updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS breadth_snapshots (trade_date TEXT NOT NULL, snapshot_time TEXT NOT NULL, rising INTEGER NOT NULL, falling INTEGER NOT NULL, flat INTEGER NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (trade_date, snapshot_time))`,
  `CREATE TABLE IF NOT EXISTS daily_reviews (trade_date TEXT PRIMARY KEY, payload TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS morning_briefs (trade_date TEXT PRIMARY KEY, model TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS morning_brief_sections (trade_date TEXT NOT NULL, section_key TEXT NOT NULL, model TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', generated_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (trade_date, section_key))`,
  `CREATE TABLE IF NOT EXISTS job_leases (job TEXT NOT NULL, trade_date TEXT NOT NULL, token TEXT NOT NULL, acquired_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY (job, trade_date))`,
  `CREATE TABLE IF NOT EXISTS job_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT NOT NULL, trade_date TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, finished_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS new_high_details (trade_date TEXT NOT NULL, type TEXT NOT NULL, symbol TEXT NOT NULL, name TEXT NOT NULL, sector TEXT NOT NULL, pct_change REAL NOT NULL, close REAL NOT NULL, high_price REAL NOT NULL, amount REAL NOT NULL, interval_pct REAL NOT NULL, high_date TEXT NOT NULL, is_all_time INTEGER NOT NULL, PRIMARY KEY (trade_date, type, symbol))`,
  `CREATE TABLE IF NOT EXISTS market_source_audits (trade_date TEXT NOT NULL, snapshot_time TEXT NOT NULL, source TEXT NOT NULL, market_time TEXT, received_at TEXT NOT NULL, raw_count INTEGER NOT NULL, valid_count INTEGER NOT NULL, invalid_count INTEGER NOT NULL, coverage_pct REAL NOT NULL, direction_agreement_pct REAL, price_agreement_pct REAL, breadth_difference INTEGER, status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', PRIMARY KEY (trade_date, snapshot_time, source))`,
  `CREATE TABLE IF NOT EXISTS global_market_snapshots (trade_date TEXT NOT NULL, symbol TEXT NOT NULL, label TEXT NOT NULL, provider TEXT NOT NULL, market_time TEXT, received_at TEXT NOT NULL, value REAL, previous_close REAL, pct_change REAL, period TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', PRIMARY KEY (trade_date, symbol, provider))`,
];

async function ensureRuntimeSchema(db: D1Database) {
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
}

async function loadBreadth(db: D1Database, date: string) {
  const result = await db.prepare("SELECT snapshot_time, rising, falling, flat FROM breadth_snapshots WHERE trade_date = ? ORDER BY snapshot_time").bind(date).all<{ snapshot_time: string; rising: number; falling: number; flat: number }>();
  return (result.results ?? []).map((row) => ({ time: String(row.snapshot_time), rising: Number(row.rising), falling: Number(row.falling), flat: Number(row.flat) }));
}

export async function loadExpectedSymbols(db: D1Database): Promise<string[]> {
  try {
    const result = await db.prepare("SELECT symbol FROM stocks ORDER BY symbol").all<{ symbol: string }>();
    return (result.results ?? []).map((row) => row.symbol);
  } catch { return []; }
}

async function persistStockUniverse(db: D1Database, quotes: Quote[], updatedAt: string) {
  for (let offset = 0; offset < quotes.length; offset += 200) {
    const statements = quotes.slice(offset, offset + 200).map((quote) => db.prepare(`INSERT INTO stocks (symbol, name, exchange, board, sector, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, exchange=excluded.exchange, board=excluded.board, sector=excluded.sector, updated_at=excluded.updated_at`)
      .bind(quote.symbol, quote.name, quote.exchange, quote.board, quote.sector, updatedAt));
    if (statements.length) await db.batch(statements);
  }
}

export async function runPanLayerJob(
  job: ScheduledJob,
  now: Date,
  env: PanLayerEnv,
  options: { force?: boolean; fetcher?: typeof fetch; sectionKeys?: BriefSectionKey[]; mode?: "failed" } = {},
): Promise<{ ok: boolean; message: string }> {
  if (!env.DB) throw new Error("DB binding is unavailable");
  const db = env.DB;
  await ensureRuntimeSchema(db);
  const { date } = beijingDateParts(now);
  const leaseToken = job.type === "morning-brief" ? await acquireJobLease(db, "morning-brief", date) : null;
  if (job.type === "morning-brief" && !leaseToken) return { ok: false, message: "morning-brief already running" };
  const morningBriefLease: MorningBriefLease | undefined = leaseToken ? { token: leaseToken, renew: () => renewJobLease(db, "morning-brief", date, leaseToken) } : undefined;
  let run: { id: number } | null = null;
  try {
    const startedAt = new Date().toISOString();
    const label = job.type === "breadth" ? `breadth-${job.time}` : job.type;
    run = await db.prepare("INSERT INTO job_runs (job, trade_date, status, started_at) VALUES (?, ?, 'running', ?) RETURNING id").bind(label, date, startedAt).first<{ id: number }>();
    const fetcher = options.fetcher ?? fetch;
    const provider = createEastmoneyProvider(fetcher);
    let finalStatus: "complete" | "partial" | "failed" = "complete";
    let finalMessage = "";
    if (job.type === "breadth") {
      const expectedSymbols = await loadExpectedSymbols(db);
      const market = await runDomesticPipeline({
        at: job.time,
        expectedSymbols,
        primary: provider,
        secondary: { name: "腾讯", getQuotes: (symbols) => fetchTencentQuotes(symbols, fetcher) },
        now,
        minimumExpectedCount: MINIMUM_ALL_A_UNIVERSE,
        secondarySampleSize: 240,
      });
      await persistSourceAudits(db, date, job.time, market.audits);
      if (market.status === "failed" || market.quotes.length === 0) throw new Error("行情源返回空数据，可能为休市日");
      const updatedAt = new Date().toISOString();
      await persistStockUniverse(db, market.quotes, updatedAt);
      const metric = calculateBreadth(market.quotes);
      await db.prepare(`INSERT INTO breadth_snapshots (trade_date, snapshot_time, rising, falling, flat, source, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(trade_date, snapshot_time) DO UPDATE SET rising=excluded.rising, falling=excluded.falling, flat=excluded.flat, source=excluded.source, status=excluded.status, updated_at=excluded.updated_at`).bind(date, job.time, metric.rising, metric.falling, metric.flat, market.source, market.status, updatedAt).run();
    } else if (job.type === "close-review") {
      const expectedSymbols = await loadExpectedSymbols(db);
      const market = await runDomesticPipeline({
        at: "16:10",
        expectedSymbols,
        primary: provider,
        secondary: { name: "腾讯", getQuotes: (symbols) => fetchTencentQuotes(symbols, fetcher) },
        now,
        minimumExpectedCount: MINIMUM_ALL_A_UNIVERSE,
        secondarySampleSize: 240,
      });
      await persistSourceAudits(db, date, "16:10", market.audits);
      if (market.status === "failed" || market.quotes.length === 0) throw new Error("行情源返回空数据，可能为休市日");
      const [limitPool, marginBalance] = await Promise.all([provider.getLimitPool(date).catch(() => []), provider.getMarginBalance(date).catch(() => null)]);
      const breadth = await loadBreadth(db, date);
      const review = buildDailyReview({ date, quotes: market.quotes, limitPool, breadth, marginBalance, high120: null, allTimeHigh: null, source: market.source });
      await db.prepare(`INSERT INTO daily_reviews (trade_date, payload, source, status, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(trade_date) DO UPDATE SET payload=excluded.payload, source=excluded.source, status=excluded.status, updated_at=excluded.updated_at`).bind(date, JSON.stringify(review), market.source, review.status, new Date().toISOString()).run();
    } else {
      const existing = await db.prepare("SELECT status FROM morning_briefs WHERE trade_date = ?").bind(date).first<{ status: string }>();
      if (!options.mode && shouldSkipMorningBrief(existing?.status, Boolean(options.force))) {
        if (run?.id) await db.prepare("UPDATE job_runs SET status='complete', message='already complete; skipped', finished_at=? WHERE id=?").bind(new Date().toISOString(), run.id).run();
        return { ok: true, message: `${label} already complete; skipped` };
      }
      const selectedKeys = options.mode === "failed" ? await failedOrMissingBriefSectionKeys(db, date) : options.sectionKeys ?? BRIEF_SECTION_DEFINITIONS.map((section) => section.key);
      if (selectedKeys.length === 0) {
        if (run?.id) await db.prepare("UPDATE job_runs SET status='complete', message='no failed or missing modules; skipped', finished_at=? WHERE id=?").bind(new Date().toISOString(), run.id).run();
        return { ok: true, message: `${label} no failed or missing modules; skipped` };
      }
      const [global, marketContext] = await Promise.all([loadGlobalOvernightSnapshot(env, fetcher), loadMorningBriefMarketContext(db, date)]);
      await assertMorningBriefLease(morningBriefLease);
      await persistGlobalPoints(db, date, global.raw, morningBriefLease);
      const ai = resolveMorningBriefProvider(env);
      const generator: BriefSectionGenerator = ai.provider === "qwen"
        ? ({ date: sectionDate, key, globalSnapshot, marketContext: sectionContext }) => generateQwenBriefSection({ date: sectionDate, key, apiKey: ai.apiKey, fetcher, globalSnapshot, marketContext: sectionContext })
        : ({ date: sectionDate, key, globalSnapshot, marketContext: sectionContext }) => generateOpenAIBriefSection({ date: sectionDate, key, apiKey: ai.apiKey, fetcher, globalSnapshot, marketContext: sectionContext });
      const brief = await generateFullMorningBrief({
        date,
        model: ai.model,
        sectionKeys: selectedKeys,
        generator,
        db,
        globalSnapshot: global.reconciled,
        marketContext,
        lease: morningBriefLease,
      });
      finalStatus = brief.status;
      const failedKeys = brief.sections.filter((section) => section.status === "failed").map((section) => section.key);
      finalMessage = failedKeys.length > 0 ? `failed modules: ${failedKeys.join(", ")}` : "";
    }
    if (run?.id) await db.prepare("UPDATE job_runs SET status=?, message=?, finished_at=? WHERE id=?").bind(finalStatus, finalMessage, new Date().toISOString(), run.id).run();
    return { ok: finalStatus !== "failed", message: `${label} ${finalStatus}${finalMessage ? `; ${finalMessage}` : ""}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (run?.id) await db.prepare("UPDATE job_runs SET status='failed', message=?, finished_at=? WHERE id=?").bind(message, new Date().toISOString(), run.id).run();
    throw error;
  } finally {
    if (leaseToken) await releaseJobLease(db, "morning-brief", date, leaseToken);
  }
}

export function scheduledJobFromDate(now: Date): ScheduledJob | null {
  return jobForBeijingTime(beijingDateParts(now).time);
}
