import { BRIEF_SECTION_DEFINITIONS, type BriefSectionKey, type MorningBrief } from "../ai/morning-brief-contract";
import { sanitizeMorningBriefDiagnostic } from "../ai/morning-brief-diagnostics";
import { assembleMorningBrief, failedBriefSection, persistBriefSection, readPersistedBriefSections } from "../ai/morning-brief-assembly";
import { searchFirecrawlBriefSources } from "../ai/firecrawl-brief-fallback";
import { collectTier1News } from "../ai/news-intake/collector";
import { selectBriefSourceBundle } from "../ai/news-intake/bundle-selector";
import { loadTier1NewsConfig } from "../ai/news-intake/config";
import {
  NEWS_INTAKE_SCHEMA_STATEMENTS,
  persistNewsCollection,
  readCurrentNewsBundle,
} from "../ai/news-intake/repository";
import { collectTier2News } from "../ai/news-intake/tier2";
import {
  generateOpenAIBriefSection,
  generateQwenBriefSection,
  QWEN_BRIEF_SECTION_MODEL,
  type BriefSectionGenerator,
  type GeneratedBriefSection,
  type MorningBriefMarketContext,
} from "../ai/morning-brief-providers";
import { bucketLimitLadder, calculateBreadth, calculateLimitPremium, classifyLimitStatus, rankLeaders, rankSectors } from "../domain/metrics";
import { buildMarketComparison } from "../domain/comparison";
import type { Breadth, DailyReview, Quote, SectorMetric } from "../domain/types";
import { createEastmoneyProvider } from "../data/eastmoney";
import type { BoardPools, IndexSnapshot, MarketAggregate } from "../data/provider";
import { loadGlobalOvernightSnapshot } from "../data/global/overnight";
import type { GlobalPoint } from "../data/global/types";
import { runDomesticPipeline } from "../data/market-pipeline";
import type { SourceAudit } from "../data/quality";
import { fetchTencentQuotes } from "../data/tencent";
import { withRetry } from "../data/resilience";
import { runHistoryBackfillBatch } from "../history/backfill";
import {
  createD1NewHighStateStore,
  newHighBootstrapTargetDate,
  patchBackfilledReviewHighCounts,
} from "../history/new-high-d1-store";
import { newHighBootstrapRunStatus, runNewHighBootstrapBatch, updateDailyNewHighSnapshot } from "../history/new-high-pipeline";
import { beijingDateParts, jobForBeijingTime, type ScheduledJob } from "./schedule";

const MINIMUM_ALL_A_UNIVERSE = 5_000;
// The 110s batch deadline stays below the 180s stale lease window, so a live job cannot be reclaimed.
export const MORNING_BRIEF_LEASE_MS = 3 * 60 * 1_000;
export const MORNING_BRIEF_BATCH_DEADLINE_MS = 110 * 1_000;
const GLOBAL_SNAPSHOT_REQUEST_TIMEOUT_MS = 8 * 1_000;
const DEADLINE_REQUEST_SAFETY_MS = 1_000;
const FIRECRAWL_FALLBACK_MINIMUM_REMAINING_MS = 40 * 1_000;
const QWEN_BUNDLE_RETRY_MINIMUM_REMAINING_MS = 30 * 1_000;
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
  FIRECRAWL_API_KEY?: string;
  FIRECRAWL_API_URL?: string;
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

function createQwenBriefGenerator(input: {
  apiKey: string;
  firecrawlApiKey?: string;
  firecrawlEndpoint?: string;
  fetcher: typeof fetch;
  newsBundle?: import("../ai/news-intake/types").NewsBundle;
}): BriefSectionGenerator {
  const fallbackUsed = new Set<BriefSectionKey>();
  return async (sectionInput) => {
    const bundleSources = input.newsBundle
      ? selectBriefSourceBundle(input.newsBundle, sectionInput.key, sectionInput.date)
      : [];
    let primaryError: unknown;
    try {
      return await generateQwenBriefSection({
        ...sectionInput,
        apiKey: input.apiKey,
        fetcher: input.fetcher,
        externalSources: bundleSources,
      });
    } catch (error) {
      primaryError = error;
    }
    if (bundleSources.length > 0) {
      const remaining = sectionInput.deadlineAt === undefined
        ? Number.POSITIVE_INFINITY
        : sectionInput.deadlineAt - Date.now();
      if (remaining >= QWEN_BUNDLE_RETRY_MINIMUM_REMAINING_MS) {
        const diagnostic = sanitizeMorningBriefDiagnostic(primaryError);
        try {
          return await generateQwenBriefSection({
            ...sectionInput,
            attempt: Math.max(sectionInput.attempt, 2),
            previousError: diagnostic,
            apiKey: input.apiKey,
            fetcher: input.fetcher,
            externalSources: bundleSources,
          });
        } catch (error) {
          primaryError = error;
        }
      }
    }
    const remaining = sectionInput.deadlineAt === undefined
      ? Number.POSITIVE_INFINITY
      : sectionInput.deadlineAt - Date.now();
    if (!input.firecrawlApiKey
      || fallbackUsed.has(sectionInput.key)
      || remaining < FIRECRAWL_FALLBACK_MINIMUM_REMAINING_MS) {
      throw primaryError;
    }
    fallbackUsed.add(sectionInput.key);
    const primaryDiagnostic = sanitizeMorningBriefDiagnostic(primaryError);
    let externalSources;
    try {
      externalSources = await searchFirecrawlBriefSources({
        date: sectionInput.date,
        key: sectionInput.key,
        apiKey: input.firecrawlApiKey,
        endpoint: input.firecrawlEndpoint,
        fetcher: input.fetcher,
        deadlineAt: sectionInput.deadlineAt,
      });
    } catch (fallbackSearchError) {
      throw new Error(`${primaryDiagnostic}; Firecrawl fallback failed: ${sanitizeMorningBriefDiagnostic(fallbackSearchError)}`);
    }
    if (externalSources.length === 0) {
      throw new Error(`${primaryDiagnostic}; Firecrawl fallback returned no usable sources`);
    }
    const supplementedSources = [...bundleSources, ...externalSources]
      .filter((source, index, all) => all.findIndex((item) => item.id === source.id || item.url === source.url) === index);
    try {
      return await generateQwenBriefSection({
        ...sectionInput,
        attempt: Math.max(sectionInput.attempt, bundleSources.length > 0 ? 3 : 2),
        previousError: primaryDiagnostic,
        apiKey: input.apiKey,
        fetcher: input.fetcher,
        externalSources: supplementedSources,
      });
    } catch (fallbackGenerationError) {
      throw new Error(`${primaryDiagnostic}; Firecrawl fallback failed: ${sanitizeMorningBriefDiagnostic(fallbackGenerationError)}`);
    }
  };
}

export async function acquireJobLease(db: D1Database, job: string, tradeDate: string, now = new Date()): Promise<string | null> {
  const token = crypto.randomUUID();
  const acquiredAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + MORNING_BRIEF_LEASE_MS).toISOString();
  const staleAt = new Date(now.getTime() - MORNING_BRIEF_LEASE_MS).toISOString();
  const row = await db.prepare(`INSERT INTO job_leases (job, trade_date, token, acquired_at, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(job, trade_date) DO UPDATE SET token=excluded.token, acquired_at=excluded.acquired_at, expires_at=excluded.expires_at WHERE job_leases.expires_at <= ? OR job_leases.acquired_at <= ? RETURNING token`)
    .bind(job, tradeDate, token, acquiredAt, expiresAt, acquiredAt, staleAt).first<{ token: string }>();
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

function awaitWithAbort<T>(operation: Promise<T>, signal: AbortSignal, onAbort?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (callback: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => {
      onAbort?.();
      settle(reject, new Error("global snapshot request aborted") as T);
    };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    void operation.then((value) => settle(resolve, value), (error) => settle(reject, error));
  });
}

export function createDeadlineAwareBufferedFetcher(fetcher: typeof fetch, deadlineAt: number): typeof fetch {
  return async (input, init) => {
    const remaining = deadlineAt - Date.now() - DEADLINE_REQUEST_SAFETY_MS;
    if (remaining <= 0) throw new Error("Morning brief deadline budget exhausted before global snapshot request");
    const timeoutMs = Math.min(GLOBAL_SNAPSHOT_REQUEST_TIMEOUT_MS, remaining);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await awaitWithAbort(fetcher(input, { ...init, signal: controller.signal }), controller.signal);
      const body = await awaitWithAbort(response.arrayBuffer(), controller.signal, () => { void response.body?.cancel().catch(() => undefined); });
      return new Response(body.byteLength ? body : null, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`Global snapshot request timed out after ${timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
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

function marketContextTime(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : null;
}

function receivedContextTime(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function loadMorningBriefMarketContext(db: D1Database, date: string): Promise<MorningBriefMarketContext> {
  const fallback: MorningBriefMarketContext = { review: null, etfs: [], etfSnapshot: null };
  try {
    const reviewRow = await db.prepare("SELECT trade_date, payload, status, updated_at FROM daily_reviews WHERE trade_date < ? ORDER BY trade_date DESC LIMIT 1").bind(date).first<{ trade_date: string; payload: string; status: DailyReview["status"]; updated_at: string }>().catch(() => null);
    const etfResult = await db.prepare("SELECT category, name, symbol, trade_date, updated_at FROM etf_snapshots WHERE trade_date = (SELECT MAX(trade_date) FROM etf_snapshots WHERE trade_date < ?) ORDER BY category, symbol LIMIT 120").bind(date).all<{ category: string; name: string; symbol: string; trade_date: string; updated_at: string }>().catch(() => ({ results: [] }));
    let review: MorningBriefMarketContext["review"] = null;
    if (reviewRow?.payload) {
      const parsed = JSON.parse(reviewRow.payload) as DailyReview;
      const closeBreadth = parsed.breadth?.at(-1);
      if (parsed && typeof parsed.date === "string" && Array.isArray(parsed.sectors) && Array.isArray(parsed.leaders) && parsed.metrics && parsed.ladder) {
        review = {
          date: parsed.date, marketTime: marketContextTime(reviewRow.trade_date), receivedAt: receivedContextTime(reviewRow.updated_at), status: parsed.status, closeBreadth: closeBreadth ? { rising: closeBreadth.rising, falling: closeBreadth.falling, flat: closeBreadth.flat } : null,
          metrics: { ...parsed.metrics },
          ladder: { first: parsed.ladder.first.length, second: parsed.ladder.second.length, third: parsed.ladder.third.length, fourth: parsed.ladder.fourth.length, fivePlus: parsed.ladder.fivePlus.length },
          sectors: parsed.sectors.slice(0, 20).map((item) => ({ name: item.name, factors: { limitUpCount: item.limitUpCount, averagePct: item.averagePct, amountGrowthPct: item.amountGrowthPct, maxStreak: item.maxStreak } })),
          leaders: parsed.leaders.slice(0, 20).map((item) => ({ name: item.name, symbol: item.symbol, factors: { pctChange: item.pctChange, amount: item.amount, limitStreak: item.limitStreak, isLimitUp: classifyLimitStatus(item) === "limit-up", firstLimitTime: item.firstLimitTime, sector: item.sector } })),
        };
      }
    }
    const etfRows = etfResult.results ?? [];
    const etfSnapshot = etfRows[0]
      ? { marketTime: marketContextTime(etfRows[0].trade_date), receivedAt: etfRows.map((item) => receivedContextTime(item.updated_at)).filter((value): value is string => value !== null).sort().at(-1) ?? null }
      : null;
    return { review, etfs: etfRows.flatMap((item) => typeof item.category === "string" && typeof item.name === "string" && typeof item.symbol === "string" ? [{ category: item.category, name: item.name, code: item.symbol }] : []), etfSnapshot };
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
  deadlineAt?: number;
}): Promise<MorningBrief> {
  const requestedKeys = input.sectionKeys;
  if (new Set(requestedKeys).size !== requestedKeys.length) throw new Error("Duplicate brief section keys are not allowed");
  const globalSnapshot = input.globalSnapshot ?? (await loadGlobalOvernightSnapshot({}, fetch)).reconciled;
  await assertMorningBriefLease(input.lease);
  const persistedSections = await readPersistedBriefSections(input.db, input.date);
  const persistedByKey = new Map(persistedSections.map((item) => [item.section.key, item]));
  const results: SectionRunResult[] = Array(requestedKeys.length);
  const maxAttempts = Math.min(3, Math.max(0, input.retries ?? 2) + 1);
  const workerCount = Math.min(3, Math.max(1, input.concurrency ?? 2), requestedKeys.length);
  let cursor = 0;
  const deadlineError = "Morning brief batch deadline exceeded";
  const deadlineExceeded = () => input.deadlineAt !== undefined && Date.now() >= input.deadlineAt;

  const runSectionWithRetry = async (key: BriefSectionKey): Promise<SectionRunResult> => {
    let attempts = 0;
    let previousError: string | undefined;
    let error = "未知错误";
    while (attempts < maxAttempts) {
      if (deadlineExceeded()) {
        error = deadlineError;
        break;
      }
      attempts += 1;
      try {
        const result = await input.generator({ date: input.date, key, attempt: attempts, previousError, globalSnapshot, marketContext: input.marketContext, deadlineAt: input.deadlineAt });
        await persistBriefSection(input.db, input.date, input.model, result.section, attempts, "", result.sources, input.lease);
        return result;
      } catch (caught) {
        if (isLeaseLost(caught)) throw caught;
        await assertMorningBriefLease(input.lease);
        error = sanitizeMorningBriefDiagnostic(caught);
        previousError = error;
        if (deadlineExceeded()) break;
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
  date, quotes, limitPool, breadth, marginBalance, high20 = null, high120, allTimeHigh, source,
  boardPools, marketAggregate, indices = [], receivedAt = new Date().toISOString(),
}: {
  date: string;
  quotes: Quote[];
  limitPool: Quote[];
  breadth: Array<Breadth & { time: string }>;
  marginBalance: number | null;
  high20?: number | null;
  high120: number | null;
  allTimeHigh: number | null;
  source: string;
  boardPools?: BoardPools | null;
  marketAggregate?: MarketAggregate | null;
  indices?: IndexSnapshot[];
  receivedAt?: string;
}): DailyReview {
  const pool = new Map(limitPool.map((item) => [item.symbol, item]));
  const merged = quotes.map((item) => pool.has(item.symbol) ? { ...item, ...pool.get(item.symbol) } : item);
  const quoteByCode = new Map(merged.map((quote) => [quote.symbol.split(".")[0], quote]));
  const poolLimitUps = boardPools
    ? boardPools.limitUp.flatMap((item) => {
        const quote = quoteByCode.get(item.code);
        if (!quote) return [];
        return [{
          ...quote,
          name: item.name || quote.name,
          pctChange: item.pctChange ?? quote.pctChange,
          amount: item.amount ?? quote.amount,
          sector: item.industry || quote.sector || "未分类",
          firstLimitTime: item.firstLimitTime,
          limitStreak: Math.max(1, item.limitStreak),
        }];
      })
    : limitPool;
  const structure = boardPools
    ? {
        status: "complete" as const,
        source: "东方财富四池",
        message: `涨停池 ${boardPools.limitUp.length} 只，已校验连板高度、行业与首次封板时间`,
        receivedAt,
      }
    : limitPool.length > 0
      ? {
          status: "partial" as const,
          source: "东方财富涨停池",
          message: "单涨停池可用，炸板、跌停及昨日涨停池待补充",
          receivedAt,
        }
      : {
          status: "failed" as const,
          source,
          message: "涨停池不可用，连板梯队、热点板块与客观龙头暂缺",
          receivedAt,
        };
  const sectors = new Map<string, Quote[]>();
  poolLimitUps.forEach((item) => sectors.set(item.sector, [...(sectors.get(item.sector) ?? []), item]));
  const sectorMetrics: SectorMetric[] = [...sectors].map(([name, items]) => ({
    name,
    limitUpCount: items.length,
    averagePct: Number((items.reduce((sum, item) => sum + item.pctChange, 0) / items.length).toFixed(2)),
    amountGrowthPct: null,
    maxStreak: Math.max(0, ...items.map((item) => item.limitStreak)),
  }));
  const quoteLimitUps = merged.filter((item) => classifyLimitStatus(item) === "limit-up");
  const limitUps = structure.status === "failed" ? [] : poolLimitUps;
  const resolvedBreadth = breadth.length > 0 ? breadth : [{ time: "15:00", ...calculateBreadth(quotes) }];
  const rankedSectorMetrics = rankSectors(sectorMetrics).slice(0, 20);
  const comparison = boardPools ? buildMarketComparison({
    date,
    quotes,
    pools: boardPools,
    marketAggregate: marketAggregate ?? null,
    indices,
    sectors: rankedSectorMetrics,
    source,
    receivedAt,
  }) : undefined;
  const comparisonComplete = comparison
    ? Object.values(comparison.evidence).every((item) => item.status === "complete")
    : boardPools === undefined;
  const premium = boardPools
    ? calculateLimitPremium(boardPools.yesterdayLimitUp.flatMap((item) => {
        const quote = quoteByCode.get(item.code);
        if (!quote || quote.isST || quote.previousClose <= 0 || quote.open <= 0) return [];
        return [{
          previousStreak: item.previousLimitStreak,
          openPct: Number(((quote.open / quote.previousClose - 1) * 100).toFixed(4)),
          closePct: quote.pctChange,
        }];
      }))
    : { openPct: null, closePct: null, sampleSize: 0 };
  return {
    date,
    status: high20 === null || high120 === null || allTimeHigh === null || !comparisonComplete || structure.status !== "complete" ? "partial" : "complete",
    source,
    updatedAt: receivedAt,
    breadth: resolvedBreadth,
    metrics: {
      limitUp: boardPools ? boardPools.limitUp.length : quoteLimitUps.length,
      limitDown: boardPools ? boardPools.limitDown.length : merged.filter((item) => classifyLimitStatus(item) === "limit-down").length,
      consecutive: structure.status === "failed" ? null : limitUps.filter((item) => item.limitStreak >= 2).length,
      largeRise: merged.filter((item) => item.pctChange >= 7 && classifyLimitStatus(item) !== "limit-up").length,
      high20,
      high120,
      allTimeHigh,
      marginBalance,
    },
    premium,
    ladder: bucketLimitLadder(limitUps),
    sectors: rankedSectorMetrics,
    leaders: rankLeaders(limitUps).slice(0, 20),
    structure,
    comparison,
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
  `CREATE TABLE IF NOT EXISTS new_high_states (symbol TEXT PRIMARY KEY, name TEXT NOT NULL, sector TEXT NOT NULL, last_date TEXT NOT NULL, last_close REAL NOT NULL, closes_json TEXT NOT NULL, all_time_high REAL NOT NULL, all_time_high_date TEXT NOT NULL, first_close REAL NOT NULL, initialized_through TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS new_high_states_progress_idx ON new_high_states(status, initialized_through)`,
  `CREATE TABLE IF NOT EXISTS market_source_audits (trade_date TEXT NOT NULL, snapshot_time TEXT NOT NULL, source TEXT NOT NULL, market_time TEXT, received_at TEXT NOT NULL, raw_count INTEGER NOT NULL, valid_count INTEGER NOT NULL, invalid_count INTEGER NOT NULL, coverage_pct REAL NOT NULL, direction_agreement_pct REAL, price_agreement_pct REAL, breadth_difference INTEGER, status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', PRIMARY KEY (trade_date, snapshot_time, source))`,
  `CREATE TABLE IF NOT EXISTS global_market_snapshots (trade_date TEXT NOT NULL, symbol TEXT NOT NULL, label TEXT NOT NULL, provider TEXT NOT NULL, market_time TEXT, received_at TEXT NOT NULL, value REAL, previous_close REAL, pct_change REAL, period TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', PRIMARY KEY (trade_date, symbol, provider))`,
  ...NEWS_INTAKE_SCHEMA_STATEMENTS,
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
  const leaseJob = job.type === "morning-brief"
    || job.type === "new-high-bootstrap"
    || job.type === "tier1-rss-prefetch"
    || job.type === "tier2-news-prefetch"
    ? job.type
    : null;
  const leaseToken = leaseJob ? await acquireJobLease(db, leaseJob, date) : null;
  if (leaseJob && !leaseToken) return { ok: false, message: `${leaseJob} already running` };
  const morningBriefLease: MorningBriefLease | undefined = leaseJob === "morning-brief" && leaseToken
    ? { token: leaseToken, renew: () => renewJobLease(db, "morning-brief", date, leaseToken) }
    : undefined;
  let run: { id: number } | null = null;
  try {
    const startedAt = new Date().toISOString();
    const label = job.type === "breadth" ? `breadth-${job.time}` : job.type;
    run = await db.prepare("INSERT INTO job_runs (job, trade_date, status, started_at) VALUES (?, ?, 'running', ?) RETURNING id").bind(label, date, startedAt).first<{ id: number }>();
    const fetcher = options.fetcher ?? fetch;
    const provider = createEastmoneyProvider(fetcher);
    let finalStatus: "complete" | "partial" | "failed" = "complete";
    let finalMessage = "";
    if (job.type === "tier1-rss-prefetch") {
      const summary = await collectTier1News({
        date,
        config: loadTier1NewsConfig(),
        fetcher,
        now,
      });
      await persistNewsCollection(db, summary);
      finalStatus = summary.status;
      finalMessage = `${summary.sourceSuccess}/${summary.sourceTotal} sources; ${summary.keptItemCount} verified; ${summary.filteredItemCount} filtered`;
    } else if (job.type === "tier2-news-prefetch") {
      if (!env.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY is not configured");
      const bundle = await readCurrentNewsBundle(db, date);
      const summary = await collectTier2News({
        date,
        bundle,
        apiKey: env.FIRECRAWL_API_KEY,
        endpoint: env.FIRECRAWL_API_URL,
        fetcher,
        now,
      });
      await persistNewsCollection(db, summary);
      finalStatus = summary.status;
      finalMessage = `${summary.sourceSuccess}/${summary.sourceTotal} gap searches; ${summary.keptItemCount} verified`;
    } else if (job.type === "history-backfill") {
      const progress = await runHistoryBackfillBatch({
        db,
        endDate: date,
        days: job.days,
        batchSize: 5,
        fetcher,
      });
      const message = `history-backfill ${progress.completed}/${progress.target}; remaining ${progress.remaining}`;
      if (run?.id) await db.prepare("UPDATE job_runs SET status='complete', message=?, finished_at=? WHERE id=?").bind(message, new Date().toISOString(), run.id).run();
      return { ok: true, message };
    } else if (job.type === "new-high-bootstrap") {
      const targetDate = await newHighBootstrapTargetDate(db, date);
      const store = createD1NewHighStateStore(db);
      const before = await store.progress(targetDate);
      if (before.target < MINIMUM_ALL_A_UNIVERSE) {
        const universe = await withRetry(
          () => provider.getUniverse(),
          { retries: 2, delayMs: 500 },
        );
        if (universe.length < MINIMUM_ALL_A_UNIVERSE) {
          throw new Error(`股票主数据覆盖不足 ${universe.length}/${MINIMUM_ALL_A_UNIVERSE}`);
        }
        await persistStockUniverse(db, universe, new Date().toISOString());
      }
      const progress = await runNewHighBootstrapBatch({
        store,
        provider,
        targetDate,
        batchSize: 150,
        concurrency: 6,
      });
      if (progress.remaining === 0 && progress.target > 0) {
        await patchBackfilledReviewHighCounts(db, targetDate);
      }
      const message =
        `new-high-bootstrap ${progress.completed}/${progress.target}; ` +
        `remaining ${progress.remaining}; failed ${progress.failed}; ` +
        `coverage ${progress.coveragePct}%`;
      const status = newHighBootstrapRunStatus(progress);
      if (run?.id) {
        await db.prepare(
          "UPDATE job_runs SET status=?, message=?, finished_at=? WHERE id=?",
        ).bind(status, message, new Date().toISOString(), run.id).run();
      }
      return { ok: true, message };
    } else if (job.type === "breadth") {
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
      await persistStockUniverse(db, market.quotes, new Date().toISOString());
      const [limitPool, marginBalance, boardPools, marketAggregate, indices] = await Promise.all([
        withRetry(() => provider.getLimitPool(date), { retries: 2, delayMs: 250 }).catch(() => []),
        provider.getMarginBalance(date).catch(() => null),
        withRetry(() => provider.getBoardPools(date), { retries: 2, delayMs: 250 }).catch(() => null),
        withRetry(() => provider.getMarketAggregate("15:00"), { retries: 2, delayMs: 250 }).catch(() => null),
        withRetry(() => provider.getIndexSnapshots(date), { retries: 2, delayMs: 250 }).catch(() => []),
      ]);
      const highSnapshot = await updateDailyNewHighSnapshot({
        store: createD1NewHighStateStore(db),
        tradeDate: date,
        quotes: market.quotes,
      }).catch(() => ({
        high20: null,
        high120: null,
        allTimeHigh: null,
        coveragePct: 0,
        status: "partial" as const,
      }));
      const breadth = await loadBreadth(db, date);
      const review = buildDailyReview({
        date,
        quotes: market.quotes,
        limitPool,
        breadth,
        marginBalance,
        high20: highSnapshot.high20,
        high120: highSnapshot.high120,
        allTimeHigh: highSnapshot.allTimeHigh,
        source: market.source,
        boardPools,
        marketAggregate,
        indices,
        receivedAt: new Date().toISOString(),
      });
      await db.prepare(`INSERT INTO daily_reviews (trade_date, payload, source, status, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(trade_date) DO UPDATE SET payload=excluded.payload, source=excluded.source, status=excluded.status, updated_at=excluded.updated_at`).bind(date, JSON.stringify(review), market.source, review.status, new Date().toISOString()).run();
    } else {
      const deadlineAt = Date.now() + MORNING_BRIEF_BATCH_DEADLINE_MS;
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
      const snapshotFetcher = createDeadlineAwareBufferedFetcher(fetcher, deadlineAt);
      const [global, marketContext, newsBundle] = await Promise.all([
        loadGlobalOvernightSnapshot(env, snapshotFetcher),
        loadMorningBriefMarketContext(db, date),
        readCurrentNewsBundle(db, date).catch(() => ({ fetchDate: date, collectedAt: null, status: "unavailable" as const, items: [] })),
      ]);
      await assertMorningBriefLease(morningBriefLease);
      await persistGlobalPoints(db, date, global.raw, morningBriefLease);
      const ai = resolveMorningBriefProvider(env);
      const generator: BriefSectionGenerator = ai.provider === "qwen"
        ? createQwenBriefGenerator({
          apiKey: ai.apiKey,
          firecrawlApiKey: env.FIRECRAWL_API_KEY,
           firecrawlEndpoint: env.FIRECRAWL_API_URL,
           fetcher,
           newsBundle,
         })
        : ({ date: sectionDate, key, attempt, previousError, globalSnapshot, marketContext: sectionContext, deadlineAt: sectionDeadline }) => generateOpenAIBriefSection({ date: sectionDate, key, attempt, previousError, apiKey: ai.apiKey, fetcher, globalSnapshot, marketContext: sectionContext, deadlineAt: sectionDeadline });
      const brief = await generateFullMorningBrief({
        date,
        model: ai.model,
        sectionKeys: selectedKeys,
        generator,
        db,
        globalSnapshot: global.reconciled,
        marketContext,
        lease: morningBriefLease,
        concurrency: ai.provider === "qwen" ? 3 : 2,
        retries: ai.provider === "qwen" ? 0 : undefined,
        deadlineAt,
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
    if (leaseToken && leaseJob) await releaseJobLease(db, leaseJob, date, leaseToken);
  }
}

export function scheduledJobFromDate(now: Date): ScheduledJob | null {
  return jobForBeijingTime(beijingDateParts(now).time);
}
