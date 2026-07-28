import { BRIEF_SECTION_DEFINITIONS_V3, LEGACY_BRIEF_SECTION_DEFINITIONS, type BriefBlock, type BriefSectionKey, type MorningBrief } from "../ai/morning-brief-contract";
import { sanitizeMorningBriefDiagnostic } from "../ai/morning-brief-diagnostics";
import { validateBriefPublication } from "../ai/morning-brief-validation";
import { assembleMorningBrief, failedBriefSection, persistBriefSection, readPersistedBriefSections } from "../ai/morning-brief-assembly";
import { searchFirecrawlBriefSources } from "../ai/firecrawl-brief-fallback";
import { collectTier1News } from "../ai/news-intake/collector";
import { selectBriefSourceBundle, type SelectedBriefSource } from "../ai/news-intake/bundle-selector";
import { loadTier1NewsConfig } from "../ai/news-intake/config";
import {
  NEWS_INTAKE_SCHEMA_STATEMENTS,
  persistNewsCollection,
  readCurrentNewsBundle,
} from "../ai/news-intake/repository";
import { collectTier2News } from "../ai/news-intake/tier2";
import {
  FUYAO_MARKET_EVIDENCE_SCHEMA_STATEMENT,
  persistFuyaoMarketEvidence,
  readFuyaoMarketEvidence,
} from "../ai/news-intake/market-evidence";
import {
  STRUCTURED_MARKET_SIGNALS_SCHEMA_STATEMENT,
  persistStructuredMarketSignals,
} from "../data/market-signals";
import {
  generateOpenAIBriefSection,
  generateQwenBriefSection,
  QWEN_BRIEF_SECTION_MODEL,
  type BriefSectionGenerator,
  type GeneratedBriefSection,
  type MorningBriefMarketContext,
} from "../ai/morning-brief-providers";
import { bucketLimitLadder, calculateBreadth, calculateLimitPremium, calculateOpeningBreadth, classifyLimitStatus, rankLeaders, rankSectors } from "../domain/metrics";
import { buildMarketComparison } from "../domain/comparison";
import { buildRecognitionRanking, type RecognitionBars } from "../domain/recognition";
import type { Breadth, DailyReview, Quote, RecognitionRanking, SectorMetric, StructuredMarketSignals } from "../domain/types";
import { createEastmoneyProvider } from "../data/eastmoney";
import {
  createFuyaoMcpClient,
  mergeVerifiedIndexSnapshots,
} from "../data/fuyao-mcp";
import type { BoardPools, IndexSnapshot, MarketAggregate } from "../data/provider";
import { loadGlobalOvernightSnapshot } from "../data/global/overnight";
import type { GlobalPoint } from "../data/global/types";
import { runDomesticPipeline } from "../data/market-pipeline";
import { fetchThsPopularitySnapshot } from "../data/ths-popularity";
import { applyStructuredSignalFallbacks } from "../data/structured-signal-fallback";
import {
  closeProviderCircuit,
  isProviderPermissionFailure,
  openProviderCircuit,
  readProviderCircuit,
} from "../data/provider-circuit";
import type { SourceAudit } from "../data/quality";
import { fetchTencentQuotes } from "../data/tencent";
import { withRetry } from "../data/resilience";
import { runHistoryBackfillBatch } from "../history/backfill";
import { formatEtfMetricsProgress, runEtfMetricsRefreshBatch } from "../etf/metrics-refresh";
import { breadthCompleteness } from "../history/overview";
import {
  createD1NewHighStateStore,
  newHighBootstrapTargetDate,
  patchBackfilledReviewHighCounts,
  refreshNewHighProgressSnapshot,
} from "../history/new-high-d1-store";
import { newHighBootstrapRunStatus, runNewHighBootstrapBatch, updateDailyNewHighSnapshot } from "../history/new-high-pipeline";
import { beijingDateParts, jobForBeijingTime, type ScheduledJob } from "./schedule";
import { mergeCloseReviewWithExisting, type CloseReviewStage } from "./close-review-stages";
import {
  buildJobExecutionMetadata,
  expectedAtForJob,
  nextRetryAtForCheckpoint,
  readJobExecutionMetadata,
  recordJobCheckpoint,
  retryAtForAttempt,
  scheduledJobKey,
  type JobExecutionMetadata,
  type JobExecutionTrigger,
} from "./checkpoints";

const MINIMUM_ALL_A_UNIVERSE = 5_000;
// Initial generation gives every module one fair provider slot. Targeted recovery
// runs may use the remaining time for source/provider fallbacks, while the batch
// still finishes before the 180s stale lease window.
export const MORNING_BRIEF_LEASE_MS = 3 * 60 * 1_000;
export const MORNING_BRIEF_BATCH_DEADLINE_MS = 150 * 1_000;
const GLOBAL_SNAPSHOT_REQUEST_TIMEOUT_MS = 8 * 1_000;
const DEADLINE_REQUEST_SAFETY_MS = 1_000;
const FIRECRAWL_FALLBACK_MINIMUM_REMAINING_MS = 40 * 1_000;
const QWEN_BUNDLE_RETRY_MINIMUM_REMAINING_MS = 30 * 1_000;
const OPENAI_FALLBACK_MINIMUM_REMAINING_MS = 32 * 1_000;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker));
  return results;
}
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
  FUYAO_API_KEY?: string;
  FUYAO_MCP_BASE_URL?: string;
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

export function shouldSkipMorningBrief(
  existingStatus: string | null | undefined,
  force: boolean,
  existingSchemaVersion?: MorningBrief["schemaVersion"],
  existingSectionCount?: number,
): boolean {
  if (existingStatus !== "complete" || force) return false;
  // Keep the historical two-argument behavior for callers that do not have
  // the payload available, while the scheduler explicitly opts into the
  // V3 completeness check below.
  if (existingSchemaVersion === undefined) return true;
  return existingSchemaVersion === 3 && existingSectionCount === BRIEF_SECTION_DEFINITIONS_V3.length;
}

function verifiedEvidenceFallbackSection(input: {
  key: BriefSectionKey;
  sources: SelectedBriefSource[];
  diagnostic: unknown;
}): GeneratedBriefSection {
  const definition = BRIEF_SECTION_DEFINITIONS_V3.find((section) => section.key === input.key);
  if (!definition) throw new Error(`Unknown brief section key: ${input.key}`);
  const generatedAt = beijingTimestamp();
  const sources = input.sources.slice(0, 8).map((source) => {
    const published = source.publishedAt ? new Date(source.publishedAt) : null;
    const retrieved = source.retrievedAt ? new Date(source.retrievedAt) : new Date();
    return {
      id: source.id,
      title: source.title,
      url: source.url,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published.toISOString() : null,
      retrievedAt: beijingTimestamp(Number.isNaN(retrieved.getTime()) ? new Date() : retrieved),
    };
  });
  const sourceIds = sources.map((source) => source.id);
  const blocks: BriefBlock[] = [];
  if (sources.length > 0) {
    blocks.push(
      { type: "heading", text: "已核验资讯原文" },
      {
        type: "bullets",
        items: input.sources.slice(0, sources.length).map((source) => ({
          text: `事件事实：${source.title}。原文短摘录：${source.content.slice(0, 360)}`,
          sourceIds: [source.id],
        })),
      },
    );
  }
  blocks.push({
    type: "callout",
    tone: "missing",
    text: sources.length > 0
      ? `AI深度整理暂缺，当前先展示已核验原文证据；系统将自动补全。原因：${sanitizeMorningBriefDiagnostic(input.diagnostic)}`
      : `本模块暂未查到可验证更新，系统将自动补全。原因：${sanitizeMorningBriefDiagnostic(input.diagnostic)}`,
    sourceIds: [],
  });
  return {
    section: {
      key: input.key,
      title: definition.title,
      summary: sources.length > 0
        ? `生成服务暂时不可用，已切换为 ${sources.length} 条已核验资讯的可读证据视图。`
        : "当前未查到可靠更新，模块已保留并等待自动补全。",
      tags: ["证据兜底", "自动补全"],
      status: "partial",
      generatedAt,
      blocks,
      sourceIds,
    },
    sources,
  };
}

function createQwenBriefGenerator(input: {
  apiKey: string;
  openAIApiKey?: string;
  firecrawlApiKey?: string;
  firecrawlEndpoint?: string;
  fetcher: typeof fetch;
  newsBundle?: import("../ai/news-intake/types").NewsBundle;
  deepRecovery?: boolean;
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
    // A seven-module first pass must not let one slow module consume the
    // entire batch budget and starve later modules. The scheduler retries only
    // failed modules five minutes later, when the deeper fallbacks below are
    // enabled.
    if (!input.deepRecovery) {
      return verifiedEvidenceFallbackSection({
        key: sectionInput.key,
        sources: bundleSources,
        diagnostic: primaryError,
      });
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
    if (input.firecrawlApiKey
      && !fallbackUsed.has(sectionInput.key)
      && remaining >= FIRECRAWL_FALLBACK_MINIMUM_REMAINING_MS) {
      fallbackUsed.add(sectionInput.key);
      const primaryDiagnostic = sanitizeMorningBriefDiagnostic(primaryError);
      try {
        const externalSources = await searchFirecrawlBriefSources({
          date: sectionInput.date,
          key: sectionInput.key,
          apiKey: input.firecrawlApiKey,
          endpoint: input.firecrawlEndpoint,
          fetcher: input.fetcher,
          deadlineAt: sectionInput.deadlineAt,
        });
        if (externalSources.length === 0) {
          throw new Error("Firecrawl fallback returned no usable sources");
        }
        const supplementedSources = [...bundleSources, ...externalSources]
          .filter((source, index, all) => all.findIndex((item) => item.id === source.id || item.url === source.url) === index);
        return await generateQwenBriefSection({
          ...sectionInput,
          attempt: Math.max(sectionInput.attempt, bundleSources.length > 0 ? 3 : 2),
          previousError: primaryDiagnostic,
          apiKey: input.apiKey,
          fetcher: input.fetcher,
          externalSources: supplementedSources,
        });
      } catch (fallbackError) {
        primaryError = new Error(`${primaryDiagnostic}; Firecrawl fallback failed: ${sanitizeMorningBriefDiagnostic(fallbackError)}`);
      }
    }
    const openAIRemaining = sectionInput.deadlineAt === undefined
      ? Number.POSITIVE_INFINITY
      : sectionInput.deadlineAt - Date.now();
    if (input.openAIApiKey && openAIRemaining >= OPENAI_FALLBACK_MINIMUM_REMAINING_MS) {
      const primaryDiagnostic = sanitizeMorningBriefDiagnostic(primaryError);
      try {
        return await generateOpenAIBriefSection({
          ...sectionInput,
          attempt: Math.max(sectionInput.attempt, 2),
          previousError: primaryDiagnostic,
          apiKey: input.openAIApiKey,
          fetcher: input.fetcher,
        });
      } catch (fallbackError) {
        primaryError = new Error(`${primaryDiagnostic}; OpenAI fallback failed: ${sanitizeMorningBriefDiagnostic(fallbackError)}`);
      }
    }
    return verifiedEvidenceFallbackSection({
      key: sectionInput.key,
      sources: bundleSources,
      diagnostic: primaryError,
    });
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
  const missing = BRIEF_SECTION_DEFINITIONS_V3.flatMap((definition) =>
    persisted.has(definition.key) ? [] : [definition.key]
  );
  const incomplete = BRIEF_SECTION_DEFINITIONS_V3.flatMap((definition) => {
    const status = persisted.get(definition.key);
    return status !== undefined && status !== "complete" ? [definition.key] : [];
  });
  // Finish every untouched module before retrying a partial/failed one. This
  // prevents a repeatedly rate-limited section from blocking the other six.
  return [...missing, ...incomplete];
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
  const fallback: MorningBriefMarketContext = { review: null, etfs: [], etfSnapshot: null, structuredEvidence: null };
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
    const structuredEvidence = await readFuyaoMarketEvidence(db, date);
    return {
      review,
      etfs: etfRows.flatMap((item) => typeof item.category === "string" && typeof item.name === "string" && typeof item.symbol === "string" ? [{ category: item.category, name: item.name, code: item.symbol }] : []),
      etfSnapshot,
      structuredEvidence,
    };
  } catch { return fallback; }
}

export async function generateFullMorningBrief(input: {
  date: string;
  model: string;
  sectionKeys: BriefSectionKey[];
  schemaVersion?: MorningBrief["schemaVersion"];
  generator: BriefSectionGenerator;
  db: D1Database;
  concurrency?: number;
  retries?: number;
  globalSnapshot?: import("../data/global/types").ReconciledGlobalPoint[];
  marketContext?: MorningBriefMarketContext;
  metadata?: Pick<MorningBrief, "sourceWindow" | "coverage">;
  lease?: MorningBriefLease;
  deadlineAt?: number;
}): Promise<MorningBrief> {
  const requestedKeys = input.sectionKeys;
  if (new Set(requestedKeys).size !== requestedKeys.length) throw new Error("Duplicate brief section keys are not allowed");
  const globalSnapshot = input.globalSnapshot ?? (await loadGlobalOvernightSnapshot({}, fetch)).reconciled;
  await assertMorningBriefLease(input.lease);
  const persistedSections = await readPersistedBriefSections(input.db, input.date);
  const persistedByKey = new Map(persistedSections.map((item) => [item.section.key, item]));
  const definitions = input.schemaVersion === 3
    ? BRIEF_SECTION_DEFINITIONS_V3
    : input.schemaVersion === 2
      ? LEGACY_BRIEF_SECTION_DEFINITIONS
      : input.sectionKeys.some((key) => key === "technical" || key === "funding")
        ? BRIEF_SECTION_DEFINITIONS_V3
        : LEGACY_BRIEF_SECTION_DEFINITIONS;
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
    const failed = failedBriefSection(key, error, beijingTimestamp(), definitions);
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
  const assembled = assembleMorningBrief(input.date, definitions.map(({ key }) => {
    const generated = generatedByKey.get(key);
    if (generated) return generated;
    const persisted = persistedByKey.get(key);
    if (persisted) return persisted;
    return { key, error: "模块尚未生成" };
  }), beijingTimestamp(), input.metadata);
  const publication = validateBriefPublication(assembled);
  const publishable: MorningBrief = {
    ...assembled,
    status: publication.ok ? assembled.status : assembled.status === "failed" ? "failed" : "partial",
    publication: {
      expectedAt: publication.expectedAt,
      completedAt: publication.completedAt,
      timeliness: publication.timeliness,
      issues: publication.issues,
    },
  };
  await assertMorningBriefLease(input.lease);
  await input.db.prepare(`INSERT INTO morning_briefs (trade_date, model, payload, status, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(trade_date) DO UPDATE SET model=excluded.model, payload=excluded.payload, status=excluded.status, updated_at=excluded.updated_at`)
    .bind(input.date, input.model, JSON.stringify(publishable), publishable.status, new Date().toISOString())
    .run();
  return publishable;
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
  boardPools, marketAggregate, indices = [], structuredSignals, recognitionRanking,
  receivedAt = new Date().toISOString(),
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
  structuredSignals?: StructuredMarketSignals;
  recognitionRanking?: RecognitionRanking;
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
  const fuyaoPoolEvidence = structuredSignals?.evidence.limitUpPool;
  const structure = boardPools
    ? {
        status: fuyaoPoolEvidence?.status === "failed" ? "partial" as const : "complete" as const,
        source: fuyaoPoolEvidence
          ? "扶摇 Fuyao 涨停池 / 东方财富炸板、跌停及昨日涨停池"
          : "东方财富四池",
        message: fuyaoPoolEvidence
          ? `扶摇涨停池 ${boardPools.limitUp.length} 只；东方财富补充炸板、跌停和昨日涨停`
          : `涨停池 ${boardPools.limitUp.length} 只，已校验连板高度、行业与首次封板时间`,
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
  const resolvedBreadth = breadth;
  const rankedSectorMetrics = structuredSignals?.sectors.length
    ? rankSectors(structuredSignals.sectors).slice(0, 20)
    : rankSectors(sectorMetrics).slice(0, 20);
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
  if (comparison && recognitionRanking) {
    comparison.recognition = recognitionRanking.items.map((item) => ({
      code: item.symbol.split(".")[0],
      name: item.name,
      isLimitUp: true,
      pctChange: item.pctChange,
      amount: item.amount,
      sector: item.concepts.join(" / ") || item.topic,
      limitStreak: item.limitStreak,
      firstLimitTime: null,
    }));
    comparison.evidence.recognition = {
      source: recognitionRanking.source,
      formula: "硬门槛过滤后，成交额与量能40% + 同花顺热榜30% + 连板高度30%",
      marketTime: recognitionRanking.marketTime,
      receivedAt: recognitionRanking.receivedAt,
      sampleSize: recognitionRanking.filters.ladderCandidates,
      coveragePct: recognitionRanking.evidence.barCandidateCount > 0
        ? Number((recognitionRanking.evidence.barSuccessCount / recognitionRanking.evidence.barCandidateCount * 100).toFixed(2))
        : null,
      status: recognitionRanking.status,
      message: recognitionRanking.evidence.message,
    };
  }
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
    status: high20 === null
      || high120 === null
      || allTimeHigh === null
      || !comparisonComplete
      || structure.status !== "complete"
      || (recognitionRanking !== undefined && recognitionRanking.status !== "complete")
      ? "partial"
      : "complete",
    source,
    updatedAt: receivedAt,
    breadth: resolvedBreadth,
    breadthMeta: breadthCompleteness(resolvedBreadth),
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
    structuredSignals,
    recognitionRanking,
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
  `CREATE TABLE IF NOT EXISTS job_checkpoints (trade_date TEXT NOT NULL, job_key TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'main', status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0, expected_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, next_retry_at TEXT, message TEXT NOT NULL DEFAULT '', result_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL, PRIMARY KEY (trade_date, job_key, stage))`,
  `CREATE INDEX IF NOT EXISTS job_checkpoints_due_idx ON job_checkpoints(trade_date, status, next_retry_at)`,
  `CREATE TABLE IF NOT EXISTS new_high_details (trade_date TEXT NOT NULL, type TEXT NOT NULL, symbol TEXT NOT NULL, name TEXT NOT NULL, sector TEXT NOT NULL, pct_change REAL NOT NULL, close REAL NOT NULL, high_price REAL NOT NULL, amount REAL NOT NULL, interval_pct REAL NOT NULL, high_date TEXT NOT NULL, is_all_time INTEGER NOT NULL, PRIMARY KEY (trade_date, type, symbol))`,
  `CREATE TABLE IF NOT EXISTS new_high_states (symbol TEXT PRIMARY KEY, name TEXT NOT NULL, sector TEXT NOT NULL, last_date TEXT NOT NULL, last_close REAL NOT NULL, closes_json TEXT NOT NULL, all_time_high REAL NOT NULL, all_time_high_date TEXT NOT NULL, first_close REAL NOT NULL, initialized_through TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS new_high_states_progress_idx ON new_high_states(status, initialized_through)`,
  `CREATE TABLE IF NOT EXISTS new_high_bootstrap_failures (symbol TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL, next_retry_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS new_high_bootstrap_retry_idx ON new_high_bootstrap_failures(next_retry_at, attempts)`,
  `CREATE TABLE IF NOT EXISTS market_source_audits (trade_date TEXT NOT NULL, snapshot_time TEXT NOT NULL, source TEXT NOT NULL, market_time TEXT, received_at TEXT NOT NULL, raw_count INTEGER NOT NULL, valid_count INTEGER NOT NULL, invalid_count INTEGER NOT NULL, coverage_pct REAL NOT NULL, direction_agreement_pct REAL, price_agreement_pct REAL, breadth_difference INTEGER, status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', PRIMARY KEY (trade_date, snapshot_time, source))`,
  `CREATE TABLE IF NOT EXISTS global_market_snapshots (trade_date TEXT NOT NULL, symbol TEXT NOT NULL, label TEXT NOT NULL, provider TEXT NOT NULL, market_time TEXT, received_at TEXT NOT NULL, value REAL, previous_close REAL, pct_change REAL, period TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', PRIMARY KEY (trade_date, symbol, provider))`,
  FUYAO_MARKET_EVIDENCE_SCHEMA_STATEMENT,
  STRUCTURED_MARKET_SIGNALS_SCHEMA_STATEMENT,
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

function previousWeekday(date: string): string {
  const value = new Date(`${date}T12:00:00+08:00`);
  do value.setUTCDate(value.getUTCDate() - 1);
  while (value.getUTCDay() === 0 || value.getUTCDay() === 6);
  return value.toISOString().slice(0, 10);
}

export async function resolveMorningEvidenceReferenceDate(db: D1Database, date: string): Promise<string> {
  const row = await db.prepare(
    "SELECT trade_date FROM daily_reviews WHERE trade_date < ? AND status != 'demo' ORDER BY trade_date DESC LIMIT 1",
  ).bind(date).first<{ trade_date: string }>().catch(() => null);
  return /^\d{4}-\d{2}-\d{2}$/.test(row?.trade_date ?? "") ? row!.trade_date : previousWeekday(date);
}

export function leaseLabelForJob(job: ScheduledJob): string {
  return job.type === "breadth" ? `breadth-${job.time}` : job.type;
}

async function persistOpeningBreadthBackfill({
  db,
  date,
  quotes,
  source,
  sourceStatus,
  receivedAt,
}: {
  db: D1Database;
  date: string;
  quotes: Quote[];
  source: string;
  sourceStatus: "complete" | "partial";
  receivedAt: string;
}): Promise<{ persisted: boolean; message: string }> {
  const existing = await db.prepare(
    "SELECT 1 AS present FROM breadth_snapshots WHERE trade_date = ? AND snapshot_time = '09:25'",
  ).bind(date).first<{ present: number }>();
  if (existing) return { persisted: false, message: "09:25 已有真实快照" };

  const opening = calculateOpeningBreadth(quotes);
  const minimumCount = Math.ceil(MINIMUM_ALL_A_UNIVERSE * 0.95);
  if (opening.coveragePct < 95 || opening.validCount < minimumCount) {
    return {
      persisted: false,
      message: `09:25 开盘价覆盖不足 ${opening.validCount}/${opening.expectedCount}（${opening.coveragePct}%）`,
    };
  }

  const snapshotSource = `${source}（官方开盘价回补）`;
  const snapshotStatus = sourceStatus === "complete" ? "complete" : "partial";
  await db.prepare(
    `INSERT INTO breadth_snapshots (
      trade_date, snapshot_time, rising, falling, flat, source, status, updated_at
    ) VALUES (?, '09:25', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trade_date, snapshot_time) DO NOTHING`,
  ).bind(
    date,
    opening.rising,
    opening.falling,
    opening.flat,
    snapshotSource,
    snapshotStatus,
    receivedAt,
  ).run();
  await persistSourceAudits(db, date, "09:25", [{
    source: snapshotSource,
    marketTime: `${date}T09:25:00+08:00`,
    receivedAt,
    rawCount: opening.expectedCount,
    validCount: opening.validCount,
    invalidCount: Math.max(0, opening.expectedCount - opening.validCount),
    coveragePct: opening.coveragePct,
    directionAgreementPct: null,
    priceAgreementPct: null,
    breadthDifference: null,
    status: snapshotStatus,
    message: "按当日官方开盘价相对昨收价重建集合竞价涨跌家数",
  }]);
  await recordJobCheckpoint(db, {
    tradeDate: date,
    key: "breadth-09:25",
    stage: "main",
    status: "complete",
    attempt: 1,
    expectedAt: expectedAtForJob(date, "breadth-09:25"),
    startedAt: receivedAt,
    finishedAt: receivedAt,
    nextRetryAt: null,
    message: `官方开盘价回补；${opening.validCount}只；覆盖率 ${opening.coveragePct}%`,
    resultJson: JSON.stringify({
      formula: "official open versus previous close",
      rising: opening.rising,
      falling: opening.falling,
      flat: opening.flat,
      validCount: opening.validCount,
      expectedCount: opening.expectedCount,
      coveragePct: opening.coveragePct,
      source: snapshotSource,
    }),
  });
  return {
    persisted: true,
    message: `已回补 09:25：上涨 ${opening.rising}、下跌 ${opening.falling}、平盘 ${opening.flat}`,
  };
}

export async function runPanLayerJob(
  job: ScheduledJob,
  now: Date,
  env: PanLayerEnv,
  options: {
    force?: boolean;
    fetcher?: typeof fetch;
    sectionKeys?: BriefSectionKey[];
    mode?: "failed";
    trigger?: JobExecutionTrigger;
  } = {},
): Promise<{ ok: boolean; status: "running" | "partial" | "complete" | "failed"; message: string }> {
  if (!env.DB) throw new Error("DB binding is unavailable");
  const db = env.DB;
  await ensureRuntimeSchema(db);
  const { date } = beijingDateParts(now);
  const leaseJob = leaseLabelForJob(job);
  const leaseToken = await acquireJobLease(db, leaseJob, date);
  if (!leaseToken) return { ok: true, status: "running", message: `${leaseJob} already running` };
  const morningBriefLease: MorningBriefLease | undefined = leaseJob === "morning-brief" && leaseToken
    ? { token: leaseToken, renew: () => renewJobLease(db, "morning-brief", date, leaseToken) }
    : undefined;
  let run: { id: number } | null = null;
  const checkpointKey = scheduledJobKey(job);
  const checkpointExpectedAt = expectedAtForJob(date, checkpointKey);
  const executionTrigger = options.trigger ?? "manual";
  let checkpointAttempt = 1;
  let checkpointStartedAt: string | null = null;
  let previousExecution: JobExecutionMetadata | null = null;
  const checkpointResult = (
    result: Record<string, unknown>,
    finishedAt: string | null,
    completed: boolean,
  ) => ({
    ...result,
    execution: buildJobExecutionMetadata({
      previous: previousExecution,
      trigger: executionTrigger,
      scheduledAt: checkpointExpectedAt,
      startedAt: checkpointStartedAt ?? now.toISOString(),
      finishedAt,
      completed,
    }),
  });
  const finishCheckpoint = async (
    status: "partial" | "complete" | "failed",
    message: string,
    result: Record<string, unknown> = {},
  ) => {
    const finishedAt = new Date().toISOString();
    await recordJobCheckpoint(db, {
      tradeDate: date,
      key: checkpointKey,
      stage: "main",
      status,
      attempt: checkpointAttempt,
      expectedAt: checkpointExpectedAt,
      startedAt: checkpointStartedAt,
      finishedAt,
      nextRetryAt: nextRetryAtForCheckpoint(
        checkpointKey,
        status,
        new Date(),
        checkpointAttempt,
      ),
      message,
      resultJson: JSON.stringify(checkpointResult(result, finishedAt, status === "complete")),
    });
  };
  const finishCloseStage = async (
    stage: CloseReviewStage,
    status: "partial" | "complete" | "failed",
    message: string,
    result: Record<string, unknown> = {},
  ) => {
    const finishedAt = new Date().toISOString();
    await recordJobCheckpoint(db, {
      tradeDate: date,
      key: "close-review",
      stage,
      status,
      attempt: checkpointAttempt,
      expectedAt: checkpointExpectedAt,
      startedAt: checkpointStartedAt,
      finishedAt,
      nextRetryAt: status === "complete" ? null : retryAtForAttempt(new Date(), checkpointAttempt),
      message,
      resultJson: JSON.stringify(checkpointResult(result, finishedAt, status === "complete")),
    });
  };
  try {
    const startedAt = new Date().toISOString();
    checkpointStartedAt = startedAt;
    const previousCheckpoint = await db.prepare(
      "SELECT attempt, result_json FROM job_checkpoints WHERE trade_date = ? AND job_key = ? AND stage = 'main'",
    ).bind(date, checkpointKey).first<{ attempt: number; result_json: string }>();
    checkpointAttempt = Number(previousCheckpoint?.attempt ?? 0) + 1;
    previousExecution = readJobExecutionMetadata(previousCheckpoint?.result_json);
    await recordJobCheckpoint(db, {
      tradeDate: date,
      key: checkpointKey,
      stage: "main",
      status: "running",
      attempt: checkpointAttempt,
      expectedAt: checkpointExpectedAt,
      startedAt,
      finishedAt: null,
      nextRetryAt: null,
      message: "",
      resultJson: JSON.stringify(checkpointResult({}, null, false)),
    });
    const label = job.type === "breadth" ? `breadth-${job.time}` : job.type;
    run = await db.prepare("INSERT INTO job_runs (job, trade_date, status, started_at) VALUES (?, ?, 'running', ?) RETURNING id").bind(label, date, startedAt).first<{ id: number }>();
    const fetcher = options.fetcher ?? fetch;
    const provider = createEastmoneyProvider(fetcher);
    const fuyao = env.FUYAO_API_KEY
      ? createFuyaoMcpClient({
        apiKey: env.FUYAO_API_KEY,
        baseUrl: env.FUYAO_MCP_BASE_URL,
        fetcher,
      })
      : null;
    const quotePrimary = fuyao
      ? {
          name: "扶摇 Fuyao",
          getQuotes: () => fuyao.fetchAShareQuotes([]),
        }
      : provider;
    const quoteCrossSource = fuyao
      ? {
          name: provider.name,
          getQuotes: () => provider.getQuotes("cross-check"),
        }
      : {
          name: "腾讯",
          getQuotes: (symbols: string[]) => fetchTencentQuotes(symbols, fetcher),
        };
    let finalStatus: "complete" | "partial" | "failed" = "complete";
    let finalMessage = "";
    if (job.type === "tier1-rss-prefetch") {
      const referenceDate = await resolveMorningEvidenceReferenceDate(db, date);
      const [summary, structuredEvidence] = await Promise.all([
        collectTier1News({
          date,
          config: loadTier1NewsConfig(),
          fetcher,
          now,
        }),
        fuyao
          ? fuyao.fetchMorningBriefEvidence(referenceDate, now).catch((error) => ({
              schemaVersion: 1 as const,
              provider: "扶摇 Fuyao" as const,
              status: "failed" as const,
              referenceDate,
              marketTime: `${referenceDate}T15:00:00+08:00`,
              receivedAt: now.toISOString(),
              datasetTotal: 5,
              datasetSuccess: 0,
              requestIds: [],
              indices: [],
              limitUpPool: null,
              ladder: null,
              hotStocks: [],
              dragonTiger: [],
              errors: [sanitizeMorningBriefDiagnostic(error)],
            }))
          : Promise.resolve(null),
      ]);
      await persistNewsCollection(db, summary);
      if (structuredEvidence) await persistFuyaoMarketEvidence(db, date, structuredEvidence);
      finalStatus = !structuredEvidence
        ? summary.status
        : summary.status === "failed" && structuredEvidence.status === "failed"
          ? "failed"
          : summary.status === "complete" && structuredEvidence.status === "complete"
            ? "complete"
            : "partial";
      finalMessage = [
        `RSS ${summary.sourceSuccess}/${summary.sourceTotal} sources`,
        `${summary.keptItemCount} verified`,
        `${summary.filteredItemCount} filtered`,
        structuredEvidence
          ? `Fuyao ${structuredEvidence.datasetSuccess}/${structuredEvidence.datasetTotal} datasets (${structuredEvidence.referenceDate})`
          : "Fuyao unconfigured",
      ].join("; ");
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
        definitions: BRIEF_SECTION_DEFINITIONS_V3,
      });
      await persistNewsCollection(db, summary);
      finalStatus = summary.status;
      const diagnostics = summary.errors
        .slice(0, 2)
        .map((error) => sanitizeMorningBriefDiagnostic(error))
        .filter(Boolean)
        .join("；");
      finalMessage = `${summary.sourceSuccess}/${summary.sourceTotal} gap searches; ${summary.keptItemCount} verified${diagnostics ? `; ${diagnostics}` : ""}`;
    } else if (job.type === "history-backfill") {
      const progress = await runHistoryBackfillBatch({
        db,
        endDate: date,
        days: job.days,
        batchSize: 5,
        fetcher,
        fuyaoApiKey: env.FUYAO_API_KEY,
        fuyaoBaseUrl: env.FUYAO_MCP_BASE_URL,
      });
      const message = `history-backfill ${progress.completed}/${progress.target}; remaining ${progress.remaining}`;
      if (run?.id) await db.prepare("UPDATE job_runs SET status='complete', message=?, finished_at=? WHERE id=?").bind(message, new Date().toISOString(), run.id).run();
      await finishCheckpoint(progress.remaining === 0 ? "complete" : "partial", message, progress);
      return { ok: true, status: progress.remaining === 0 ? "complete" : "partial", message };
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
        provider: fuyao
          ? {
              getAdjustedBars: async (symbol: string) => {
                const [fuyaoBars, eastmoneyBars] = await Promise.all([
                  fuyao.fetchAShareAdjustedBars(symbol, now).catch(() => []),
                  provider.getAdjustedBars(symbol).catch(() => []),
                ]);
                if (fuyaoBars.length === 0) return eastmoneyBars;
                if (eastmoneyBars.length === 0) return fuyaoBars;
                const merged = new Map(eastmoneyBars.map((bar) => [bar.date, bar]));
                fuyaoBars.forEach((bar) => merged.set(bar.date, bar));
                return [...merged.values()].toSorted((left, right) => left.date.localeCompare(right.date));
              },
            }
          : provider,
        targetDate,
        batchSize: 40,
        concurrency: 3,
      });
      const snapshot = await refreshNewHighProgressSnapshot(db, targetDate);
      const coveragePct = snapshot.target > 0
        ? Number((snapshot.completed / snapshot.target * 100).toFixed(2))
        : 0;
      const remaining = Math.max(0, snapshot.target - snapshot.completed);
      if (coveragePct >= 95 && snapshot.target > 0) {
        await patchBackfilledReviewHighCounts(db, targetDate);
      }
      const message =
        `new-high-bootstrap ${snapshot.completed}/${snapshot.target}; ` +
        `remaining ${remaining}; failed ${snapshot.failed}; ` +
        `coverage ${coveragePct}%`;
      const status = newHighBootstrapRunStatus({
        remaining,
        failed: snapshot.failed,
      });
      if (run?.id) {
        await db.prepare(
          "UPDATE job_runs SET status=?, message=?, finished_at=? WHERE id=?",
        ).bind(status, message, new Date().toISOString(), run.id).run();
      }
      await finishCheckpoint(status, message, {
        ...progress,
        ...snapshot,
        remaining,
        coveragePct,
      });
      return { ok: true, status, message };
    } else if (job.type === "etf-metrics-refresh") {
      const progress = await runEtfMetricsRefreshBatch({
        db,
        date,
        fetcher,
        batchSize: 12,
        fuyaoApiKey: env.FUYAO_API_KEY,
        fuyaoBaseUrl: env.FUYAO_MCP_BASE_URL,
      });
      const message = formatEtfMetricsProgress(progress);
      const historyStatus = progress.remaining === 0 ? "complete" : "partial";
      const finishedAt = new Date().toISOString();
      await recordJobCheckpoint(db, {
        tradeDate: date,
        key: "etf-metrics-refresh",
        stage: "history-metrics",
        status: historyStatus,
        attempt: checkpointAttempt,
        expectedAt: checkpointExpectedAt,
        startedAt: checkpointStartedAt,
        finishedAt,
        nextRetryAt: historyStatus === "complete"
          ? null
          : new Date(now.getTime() + 5 * 60_000).toISOString(),
        message,
        resultJson: JSON.stringify(progress),
      });
      const dailyMessage = `ETF 当日行情已更新；历史指标${historyStatus === "complete" ? "完整" : "后台初始化中"}；${message}`;
      if (run?.id) {
        await db.prepare(
          "UPDATE job_runs SET status=?, message=?, finished_at=? WHERE id=?",
        ).bind("complete", dailyMessage, finishedAt, run.id).run();
      }
      await finishCheckpoint("complete", dailyMessage, {
        dailySnapshot: "complete",
        historyMetrics: historyStatus,
        ...progress,
      });
      return { ok: true, status: "complete", message: dailyMessage };
    } else if (job.type === "breadth") {
      const expectedSymbols = await loadExpectedSymbols(db);
      const market = await runDomesticPipeline({
        at: job.time,
        expectedSymbols,
        primary: quotePrimary,
        secondary: quoteCrossSource,
        now,
        minimumExpectedCount: MINIMUM_ALL_A_UNIVERSE,
        secondarySampleSize: fuyao ? Number.POSITIVE_INFINITY : 240,
        mergeSecondaryMetadata: Boolean(fuyao),
      });
      await persistSourceAudits(db, date, job.time, market.audits);
      if (market.status === "failed" || market.quotes.length === 0) throw new Error("行情源返回空数据，可能为休市日");
      const updatedAt = new Date().toISOString();
      await persistStockUniverse(db, market.quotes, updatedAt);
      const currentBeijingTime = beijingDateParts(now).time;
      const delayedOpeningCapture = job.time === "09:25" && currentBeijingTime >= "09:30";
      const opening = delayedOpeningCapture ? calculateOpeningBreadth(market.quotes) : null;
      if (
        opening
        && (opening.coveragePct < 95 || opening.validCount < Math.ceil(MINIMUM_ALL_A_UNIVERSE * 0.95))
      ) {
        throw new Error(
          `09:25 开盘价覆盖不足 ${opening.validCount}/${opening.expectedCount}（${opening.coveragePct}%）`,
        );
      }
      const metric = opening ?? calculateBreadth(market.quotes);
      const snapshotSource = delayedOpeningCapture
        ? `${market.source}（官方开盘价回补）`
        : market.source;
      await db.prepare(`INSERT INTO breadth_snapshots (trade_date, snapshot_time, rising, falling, flat, source, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(trade_date, snapshot_time) DO UPDATE SET rising=excluded.rising, falling=excluded.falling, flat=excluded.flat, source=excluded.source, status=excluded.status, updated_at=excluded.updated_at`).bind(date, job.time, metric.rising, metric.falling, metric.flat, snapshotSource, market.status, updatedAt).run();
      if (delayedOpeningCapture) {
        await persistSourceAudits(db, date, "09:25", [{
          source: snapshotSource,
          marketTime: `${date}T09:25:00+08:00`,
          receivedAt: updatedAt,
          rawCount: opening!.expectedCount,
          validCount: opening!.validCount,
          invalidCount: Math.max(0, opening!.expectedCount - opening!.validCount),
          coveragePct: opening!.coveragePct,
          directionAgreementPct: null,
          priceAgreementPct: null,
          breadthDifference: null,
          status: market.status,
          message: "按当日官方开盘价相对昨收价重建集合竞价涨跌家数",
        }]);
      } else if (job.time !== "09:25" && currentBeijingTime >= "09:30") {
        const openingBackfill = await persistOpeningBreadthBackfill({
          db,
          date,
          quotes: market.quotes,
          source: market.source,
          sourceStatus: market.status,
          receivedAt: updatedAt,
        });
        if (openingBackfill.persisted) {
          finalMessage = openingBackfill.message;
        }
      }
      // A non-empty snapshot is a completed scheduled capture even when the
      // underlying quote cross-check is only partial. Data quality remains on
      // the persisted snapshot and source audit instead of keeping the job in
      // an endless retry loop.
      finalStatus = "complete";
      finalMessage = [
        `${market.quotes.length}只`,
        delayedOpeningCapture ? "09:25 官方开盘价回补" : "",
        finalMessage,
        `数据质量 ${market.status}`,
        market.message,
      ].filter(Boolean).join("；");
    } else if (job.type === "close-review") {
      const [existingReviewRow, existingStageRows] = await Promise.all([
        db.prepare("SELECT payload FROM daily_reviews WHERE trade_date = ?")
          .bind(date)
          .first<{ payload: string }>(),
        db.prepare(
          "SELECT stage, status FROM job_checkpoints WHERE trade_date = ? AND job_key = 'close-review' AND stage <> 'main'",
        ).bind(date).all<{ stage: string; status: string }>(),
      ]);
      let existingReview: DailyReview | null = null;
      try {
        existingReview = existingReviewRow?.payload
          ? JSON.parse(existingReviewRow.payload) as DailyReview
          : null;
      } catch {
        existingReview = null;
      }
      const completedStages = new Set(
        (existingStageRows.results ?? [])
          .filter((item) => item.status === "complete")
          .map((item) => item.stage),
      );
      const canReuseStage = (stage: CloseReviewStage) =>
        !options.force && Boolean(existingReview) && completedStages.has(stage);
      const reuseSignals = canReuseStage("signals") && Boolean(existingReview?.structuredSignals);
      const reuseRecognition = canReuseStage("recognition") && Boolean(existingReview?.recognitionRanking);
      const reuseIndices = canReuseStage("indices") && Boolean(existingReview?.comparison?.indices.length);
      const reuseNewHighs = canReuseStage("new-highs")
        && existingReview?.metrics.high20 !== null
        && existingReview?.metrics.high20 !== undefined
        && existingReview.metrics.high120 !== null
        && existingReview.metrics.allTimeHigh !== null;
      const expectedSymbols = await loadExpectedSymbols(db);
      const market = await runDomesticPipeline({
        at: "16:10",
        expectedSymbols,
        primary: quotePrimary,
        secondary: quoteCrossSource,
        now,
        minimumExpectedCount: MINIMUM_ALL_A_UNIVERSE,
        secondarySampleSize: fuyao ? Number.POSITIVE_INFINITY : 240,
        mergeSecondaryMetadata: Boolean(fuyao),
      });
      await persistSourceAudits(db, date, "16:10", market.audits);
      if (market.status === "failed" || market.quotes.length === 0) throw new Error("行情源返回空数据，可能为休市日");
      await persistStockUniverse(db, market.quotes, new Date().toISOString());
      await finishCloseStage(
        "quotes",
        market.status,
        market.message,
        { quoteCount: market.quotes.length, source: market.source },
      );
      const [
        limitPool,
        marginBalance,
        boardPools,
        eastmoneyAggregate,
        existingIndices,
        fuyaoPool,
        thsPopularity,
        fallbackSectors,
      ] = await Promise.all([
        withRetry(() => provider.getLimitPool(date), { retries: 2, delayMs: 250 }).catch(() => []),
        provider.getMarginBalance(date).catch(() => null),
        withRetry(() => provider.getBoardPools(date), { retries: 2, delayMs: 250 }).catch(() => null),
        withRetry(() => provider.getMarketAggregate("15:00"), { retries: 2, delayMs: 250 }).catch(() => null),
        reuseIndices
          ? Promise.resolve(existingReview?.comparison?.indices ?? [])
          : withRetry(() => provider.getIndexSnapshots(date), { retries: 2, delayMs: 250 }).catch(() => []),
        fuyao
          ? withRetry(
              () => fuyao.fetchLimitUpPoolSnapshot(date, now),
              { retries: 2, delayMs: 250 },
            ).catch(() => null)
          : Promise.resolve(null),
        reuseSignals && reuseRecognition
          ? Promise.resolve({
              source: "已完成阶段复用",
              status: "complete" as const,
              marketTime: `${date}T15:00:00+08:00`,
              receivedAt: existingReview?.updatedAt ?? now.toISOString(),
              rawCount: 0,
              items: [],
              message: "结构化信号与辨识度榜已完成，跳过重复热榜请求",
            })
          : fetchThsPopularitySnapshot(date, now, fetcher),
        reuseSignals ? Promise.resolve([]) : provider.getSectors(date).catch(() => []),
      ]);
      const [anomalyCircuit, sectorCircuit] = fuyao
        ? await Promise.all([
            readProviderCircuit(db, "fuyao:anomalies", now),
            readProviderCircuit(db, "fuyao:sectors", now),
          ])
        : [null, null] as const;
      const disabledFuyaoDatasets = new Set<"anomalies" | "sectors">();
      if (anomalyCircuit) disabledFuyaoDatasets.add("anomalies");
      if (sectorCircuit) disabledFuyaoDatasets.add("sectors");
      const [freshStructuredSignals, fuyaoAggregate] = fuyao
        ? await Promise.all([
            reuseSignals
              ? Promise.resolve(existingReview?.structuredSignals)
              : fuyao.fetchStructuredMarketSignals(
                  date,
                  now,
                  fuyaoPool ?? undefined,
                  { disabledDatasets: disabledFuyaoDatasets },
                ).catch(() => undefined),
            withRetry(
              () => fuyao.fetchMarketAggregate([], "15:00", now),
              { retries: 2, delayMs: 250 },
            ).catch(() => null),
        ])
        : [reuseSignals ? existingReview?.structuredSignals : undefined, null] as const;
      if (freshStructuredSignals && !reuseSignals) {
        const updateCircuit = async (
          dataset: "anomalies" | "sectors",
          key: "fuyao:anomalies" | "fuyao:sectors",
          wasDisabled: boolean,
        ) => {
          if (wasDisabled) return;
          const evidence = freshStructuredSignals.evidence[dataset];
          if (isProviderPermissionFailure(evidence?.message)) {
            await openProviderCircuit(db, key, evidence?.message ?? "Fuyao 403", now);
          } else if (evidence?.status === "complete") {
            await closeProviderCircuit(db, key);
          }
        };
        await Promise.all([
          updateCircuit("anomalies", "fuyao:anomalies", Boolean(anomalyCircuit)),
          updateCircuit("sectors", "fuyao:sectors", Boolean(sectorCircuit)),
        ]);
      }
      const structuredSignals = reuseSignals
        ? existingReview?.structuredSignals
        : applyStructuredSignalFallbacks({
            signals: freshStructuredSignals,
            popularity: thsPopularity,
            sectors: fallbackSectors,
            referenceDate: date,
            receivedAt: new Date().toISOString(),
          });
      const effectiveBoardPools: BoardPools | null = boardPools
        ? {
            ...boardPools,
            limitUp: fuyaoPool?.items.length ? fuyaoPool.items : boardPools.limitUp,
          }
        : null;
      const quoteByCode = new Map(market.quotes.map((item) => [item.symbol.split(".")[0], item]));
      const popularitySymbols = new Set(
        (thsPopularity.items.length > 0
          ? thsPopularity.items
          : structuredSignals?.hotStocks ?? [])
          .filter((item) => item.rank >= 1 && item.rank <= 30)
          .map((item) => item.symbol),
      );
      const recognitionSymbols = effectiveBoardPools
        ? [...new Set(effectiveBoardPools.limitUp.flatMap((item) => {
            const quote = quoteByCode.get(item.code);
            if (
              !quote
              || quote.isST
              || quote.isNoLimitDay
              || quote.amount < 300_000_000
              || quote.turnoverRate <= 8
              || !popularitySymbols.has(quote.symbol)
            ) return [];
            return [quote.symbol];
          }))]
        : [];
      const recognitionBars = reuseRecognition
        ? []
        : await mapWithConcurrency(
          recognitionSymbols,
          4,
          async (symbol): Promise<RecognitionBars> => {
          if (fuyao) {
            const primary = await fuyao
              .fetchAShareAdjustedBars(symbol, now, { lookbackDays: 75 })
              .catch(() => []);
            if (primary.filter((item) => (item.volume ?? 0) > 0).length >= 30) {
              return { symbol, bars: primary, source: "扶摇 Fuyao 前复权日K" };
            }
          }
          const fallback = await provider.getAdjustedBars(symbol).catch(() => []);
          return {
            symbol,
            bars: fallback,
            source: fallback.length > 0 ? "东方财富 / 腾讯前复权日K（降级）" : "暂缺",
          };
          },
        );
      const recognitionRanking = reuseRecognition
        ? existingReview?.recognitionRanking
        : effectiveBoardPools
        ? buildRecognitionRanking({
            date,
            quotes: market.quotes,
            limitUpPool: effectiveBoardPools.limitUp,
            popularity: thsPopularity,
            bars: recognitionBars,
            structuredSignals,
            quoteSource: market.source,
            ladderSource: fuyaoPool?.items.length
              ? "扶摇 Fuyao 涨停池 / 东方财富交叉"
              : "东方财富涨停池",
            receivedAt: new Date().toISOString(),
          })
        : undefined;
      if (!reuseSignals && structuredSignals && fuyaoPool?.items.length && boardPools?.limitUp.length) {
        const primaryCodes = new Set(fuyaoPool.items.map((item) => item.code));
        const crossCodes = new Set(boardPools.limitUp.map((item) => item.code));
        const difference = [
          ...[...primaryCodes].filter((code) => !crossCodes.has(code)),
          ...[...crossCodes].filter((code) => !primaryCodes.has(code)),
        ];
        const union = new Set([...primaryCodes, ...crossCodes]).size;
        if (difference.length >= 2 && difference.length / Math.max(1, union) >= .1) {
          const evidence = structuredSignals.evidence.limitUpPool;
          structuredSignals.evidence.limitUpPool = {
            ...evidence,
            status: "partial",
            message: `${evidence?.message ?? "扶摇涨停池"}；与东方财富差异 ${difference.length}/${union}`,
          };
          structuredSignals.status = "partial";
          structuredSignals.errors.push(`涨停池交叉差异：${difference.slice(0, 20).join("、")}`);
        }
      }
      if (structuredSignals && !reuseSignals) {
        await persistStructuredMarketSignals(db, structuredSignals);
      }
      let marketAggregate = fuyaoAggregate?.status === "complete"
        ? fuyaoAggregate
        : eastmoneyAggregate;
      if (
        fuyaoAggregate?.status === "complete"
        && eastmoneyAggregate?.status === "complete"
        && fuyaoAggregate.amount !== null
        && eastmoneyAggregate.amount !== null
      ) {
        const differencePct = Math.abs(fuyaoAggregate.amount - eastmoneyAggregate.amount)
          / Math.max(1, eastmoneyAggregate.amount) * 100;
        marketAggregate = differencePct > 2
          ? {
              ...fuyaoAggregate,
              status: "partial",
              source: "扶摇 Fuyao / 东方财富",
              message: `扶摇主值；与东方财富成交额差异 ${differencePct.toFixed(2)}%`,
            }
          : {
              ...fuyaoAggregate,
              source: "扶摇 Fuyao / 东方财富",
              message: `扶摇主值；东方财富交叉差异 ${differencePct.toFixed(2)}%`,
            };
      }
      const indices = reuseIndices
        ? existingReview?.comparison?.indices ?? []
        : fuyao
        ? mergeVerifiedIndexSnapshots(
          await withRetry(() => fuyao.fetchIndexSnapshots(date, now), { retries: 1, delayMs: 250 }).catch(() => []),
          existingIndices,
        )
        : existingIndices;
      await Promise.all([
        finishCloseStage(
          "board-pools",
          effectiveBoardPools ? structuredSignals?.evidence.limitUpPool?.status === "partial" ? "partial" : "complete" : limitPool.length > 0 ? "partial" : "failed",
          effectiveBoardPools
            ? fuyaoPool?.items.length
              ? "扶摇涨停池主源；东方财富补充炸板、跌停和昨日涨停池"
              : "东方财富四池降级可用"
            : limitPool.length > 0 ? "仅涨停池可用" : "涨跌停池不可用",
          {
            limitUp: effectiveBoardPools?.limitUp.length ?? limitPool.length,
            broken: effectiveBoardPools?.broken.length ?? null,
            limitDown: effectiveBoardPools?.limitDown.length ?? null,
            yesterdayLimitUp: effectiveBoardPools?.yesterdayLimitUp.length ?? null,
          },
        ),
        finishCloseStage(
          "signals",
          structuredSignals?.status ?? (fuyao ? "failed" : "partial"),
          structuredSignals
            ? `扶摇结构化信号 ${structuredSignals.datasetSuccess}/${structuredSignals.datasetTotal}`
            : fuyao ? "扶摇结构化信号采集失败" : "扶摇未配置",
          {
            datasetSuccess: structuredSignals?.datasetSuccess ?? 0,
            datasetTotal: structuredSignals?.datasetTotal ?? 7,
            requestIds: structuredSignals?.requestIds ?? [],
          },
        ),
        finishCloseStage(
          "recognition",
          recognitionRanking?.status ?? "failed",
          recognitionRanking
            ? `${recognitionRanking.evidence.message}；第一梯队 ${recognitionRanking.firstTierCount}，第二梯队 ${recognitionRanking.secondTierCount}`
            : "客观辨识度榜缺少涨停池，暂不可计算",
          {
            qualified: recognitionRanking?.items.length ?? 0,
            firstTier: recognitionRanking?.firstTierCount ?? 0,
            secondTier: recognitionRanking?.secondTierCount ?? 0,
            filters: recognitionRanking?.filters ?? null,
          },
        ),
        finishCloseStage(
          "aggregate",
          marketAggregate?.status ?? "failed",
          marketAggregate?.message ?? "全市场汇总暂缺",
          { coveragePct: marketAggregate?.coveragePct ?? null, amount: marketAggregate?.amount ?? null },
        ),
        finishCloseStage(
          "indices",
          indices.length >= 5 && indices.every((item) => item.status === "complete") ? "complete" : indices.length > 0 ? "partial" : "failed",
          indices.length > 0 ? `指数 ${indices.length}/5` : "指数数据暂缺",
          { count: indices.length },
        ),
      ]);
      const highSnapshot = reuseNewHighs
        ? {
            high20: existingReview!.metrics.high20 ?? null,
            high120: existingReview!.metrics.high120,
            allTimeHigh: existingReview!.metrics.allTimeHigh,
            coveragePct: 100,
            status: "complete" as const,
          }
        : await updateDailyNewHighSnapshot({
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
      await finishCloseStage(
        "new-highs",
        highSnapshot.status,
        highSnapshot.status === "complete" ? "新高数据完整" : `新高覆盖率 ${highSnapshot.coveragePct}%`,
        highSnapshot,
      );
      const breadth = await loadBreadth(db, date);
      const nextReview = buildDailyReview({
        date,
        quotes: market.quotes,
        limitPool,
        breadth,
        marginBalance,
        high20: highSnapshot.high20,
        high120: highSnapshot.high120,
        allTimeHigh: highSnapshot.allTimeHigh,
        source: market.source,
        boardPools: effectiveBoardPools,
        marketAggregate,
        indices,
        structuredSignals,
        recognitionRanking,
        receivedAt: new Date().toISOString(),
      });
      const review = mergeCloseReviewWithExisting(existingReview, nextReview);
      await db.prepare(`INSERT INTO daily_reviews (trade_date, payload, source, status, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(trade_date) DO UPDATE SET payload=excluded.payload, source=excluded.source, status=excluded.status, updated_at=excluded.updated_at`).bind(date, JSON.stringify(review), review.source, review.status, new Date().toISOString()).run();
      await finishCloseStage(
        "assemble",
        review.status === "complete" ? "complete" : "partial",
        `收盘复盘 ${review.status}`,
        { status: review.status, breadthCaptured: review.breadthMeta?.captured ?? review.breadth.length },
      );
      finalStatus = review.status === "complete" ? "complete" : "partial";
      finalMessage = `收盘复盘 ${review.status}；盘中快照 ${review.breadthMeta?.captured ?? review.breadth.length}/6`;
    } else {
      const deadlineAt = Date.now() + MORNING_BRIEF_BATCH_DEADLINE_MS;
      const existing = await db.prepare("SELECT status, payload FROM morning_briefs WHERE trade_date = ?").bind(date).first<{ status: string; payload: string | null }>();
      let existingSchemaVersion: MorningBrief["schemaVersion"] | undefined;
      let existingSectionCount: number | undefined;
      if (existing?.payload) {
        try {
          const persisted = JSON.parse(existing.payload) as Partial<MorningBrief>;
          if (persisted.schemaVersion === 2 || persisted.schemaVersion === 3) {
            existingSchemaVersion = persisted.schemaVersion;
            existingSectionCount = Array.isArray(persisted.sections) ? persisted.sections.length : 0;
          }
        } catch {
          // A malformed payload must be regenerated instead of being treated
          // as a completed brief.
        }
      }
      if (!options.mode && shouldSkipMorningBrief(existing?.status, Boolean(options.force), existingSchemaVersion, existingSectionCount)) {
        if (run?.id) await db.prepare("UPDATE job_runs SET status='complete', message='already complete; skipped', finished_at=? WHERE id=?").bind(new Date().toISOString(), run.id).run();
        await finishCheckpoint("complete", "already complete; skipped");
        return { ok: true, status: "complete", message: `${label} already complete; skipped` };
      }
      const selectedKeys = options.sectionKeys
        ?? (options.mode === "failed" || existingSchemaVersion !== undefined
          ? await failedOrMissingBriefSectionKeys(db, date)
          : BRIEF_SECTION_DEFINITIONS_V3.map((section) => section.key));
      if (selectedKeys.length === 0) {
        if (run?.id) await db.prepare("UPDATE job_runs SET status='complete', message='no failed or missing modules; skipped', finished_at=? WHERE id=?").bind(new Date().toISOString(), run.id).run();
        await finishCheckpoint("complete", "no failed or missing modules; skipped");
        return { ok: true, status: "complete", message: `${label} no failed or missing modules; skipped` };
      }
      const snapshotFetcher = createDeadlineAwareBufferedFetcher(fetcher, deadlineAt);
      const [global, marketContext, newsBundle] = await Promise.all([
        loadGlobalOvernightSnapshot(env, snapshotFetcher),
        loadMorningBriefMarketContext(db, date),
        readCurrentNewsBundle(db, date).catch(() => ({ fetchDate: date, collectedAt: null, status: "unavailable" as const, items: [], sourceTotal: 0, sourceSuccess: 0, failedSources: 0 })),
      ]);
      // Prefer the latest persisted trading-day review so Monday/holiday
      // windows do not incorrectly start from a calendar weekend.
      const previousCloseDate = new Date(`${date}T12:00:00+08:00`);
      previousCloseDate.setUTCDate(previousCloseDate.getUTCDate() - 1);
      const previousClose = marketContext?.review?.date ?? previousCloseDate.toISOString().slice(0, 10);
      const briefMetadata = {
        sourceWindow: {
          from: `${previousClose}T15:00:00+08:00`,
          to: `${date}T07:15:00+08:00`,
          timezone: "Asia/Shanghai" as const,
        },
        coverage: {
          status: newsBundle.status,
          sourceTotal: newsBundle.sourceTotal ?? new Set(newsBundle.items.flatMap((item) => item.sourceIds)).size,
          sourceSuccess: newsBundle.sourceSuccess ?? new Set(newsBundle.items.flatMap((item) => item.sourceIds)).size,
          failedSources: newsBundle.failedSources ?? 0,
          verifiedFacts: newsBundle.items.filter((item) => item.verification === "verified").length,
          crossCheckedFacts: newsBundle.items.filter((item) => item.corroboratingUrls.length > 1 || item.sourceIds.length > 1).length,
          collectedAt: newsBundle.collectedAt,
          structuredEvidence: marketContext.structuredEvidence
            ? {
                provider: marketContext.structuredEvidence.provider,
                status: marketContext.structuredEvidence.status,
                datasetTotal: marketContext.structuredEvidence.datasetTotal,
                datasetSuccess: marketContext.structuredEvidence.datasetSuccess,
                referenceDate: marketContext.structuredEvidence.referenceDate,
                collectedAt: marketContext.structuredEvidence.receivedAt,
              }
            : {
                provider: "扶摇 Fuyao",
                status: "unavailable" as const,
                datasetTotal: 5,
                datasetSuccess: 0,
                referenceDate: null,
                collectedAt: null,
              },
        },
      };
      await assertMorningBriefLease(morningBriefLease);
      await persistGlobalPoints(db, date, global.raw, morningBriefLease);
      const ai = resolveMorningBriefProvider(env);
      const serialQwenRun = ai.provider === "qwen"
        && executionTrigger !== "manual"
        && options.sectionKeys === undefined;
      // The external scheduler runs every five minutes from 07:15 to 07:55.
      // Automatic Qwen runs therefore advance exactly one persisted module per
      // tick instead of issuing seven concurrent provider requests.
      const generationKeys = serialQwenRun ? selectedKeys.slice(0, 1) : selectedKeys;
      const deepRecovery = serialQwenRun
        ? selectedKeys.length === 1
        : selectedKeys.length < BRIEF_SECTION_DEFINITIONS_V3.length;
      const generator: BriefSectionGenerator = ai.provider === "qwen"
        ? createQwenBriefGenerator({
          apiKey: ai.apiKey,
          openAIApiKey: env.OPENAI_API_KEY,
          firecrawlApiKey: env.FIRECRAWL_API_KEY,
          firecrawlEndpoint: env.FIRECRAWL_API_URL,
          fetcher,
          newsBundle,
          deepRecovery,
        })
        : async ({ date: sectionDate, key, attempt, previousError, globalSnapshot, marketContext: sectionContext, deadlineAt: sectionDeadline }) => {
          try {
            return await generateOpenAIBriefSection({ date: sectionDate, key, attempt, previousError, apiKey: ai.apiKey, fetcher, globalSnapshot, marketContext: sectionContext, deadlineAt: sectionDeadline });
          } catch (error) {
            return verifiedEvidenceFallbackSection({
              key,
              sources: selectBriefSourceBundle(newsBundle, key, sectionDate),
              diagnostic: error,
            });
          }
        };
      const brief = await generateFullMorningBrief({
        date,
        model: ai.model,
        sectionKeys: generationKeys,
        schemaVersion: 3,
        generator,
        db,
        globalSnapshot: global.reconciled,
        marketContext,
        metadata: briefMetadata,
        lease: morningBriefLease,
        concurrency: ai.provider === "qwen" ? 1 : 2,
        retries: ai.provider === "qwen" ? 0 : undefined,
        deadlineAt,
      });
      finalStatus = brief.status;
      const failedKeys = brief.sections
        .filter((section) => section.status !== "complete")
        .map((section) => section.key);
      finalMessage = failedKeys.length > 0 ? `incomplete modules: ${failedKeys.join(", ")}` : "";
    }
    if (run?.id) await db.prepare("UPDATE job_runs SET status=?, message=?, finished_at=? WHERE id=?").bind(finalStatus, finalMessage, new Date().toISOString(), run.id).run();
    await finishCheckpoint(finalStatus, finalMessage);
    return { ok: finalStatus !== "failed", status: finalStatus, message: `${label} ${finalStatus}${finalMessage ? `; ${finalMessage}` : ""}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (run?.id) await db.prepare("UPDATE job_runs SET status='failed', message=?, finished_at=? WHERE id=?").bind(message, new Date().toISOString(), run.id).run();
    await finishCheckpoint("failed", message).catch(() => undefined);
    throw error;
  } finally {
    await releaseJobLease(db, leaseJob, date, leaseToken);
  }
}

export function scheduledJobFromDate(now: Date): ScheduledJob | null {
  return jobForBeijingTime(beijingDateParts(now).time);
}
