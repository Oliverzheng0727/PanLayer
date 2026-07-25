import { isValidPersistedMorningBrief } from "../ai/morning-brief-assembly";
import type { MorningBrief } from "../ai/morning-brief-contract";
import type { DailyReview } from "../domain/types";
import { reviewToHistoryRow, type HistoryRow } from "../history/query";
import type { HighDetail } from "../history/high-details";
import {
  buildNewHighProgress,
  parseNewHighBootstrapFailureCount,
  resolveNewHighProgressTargetDate,
  type NewHighProgress,
} from "../history/new-high-progress";
import { reconcileGlobalPoints } from "./global/reconcile";
import type { GlobalPoint } from "./global/types";
import {
  expectedDailyJobs,
  readDailyJobCheckpoints,
  type JobCheckpoint,
} from "../jobs/checkpoints";
import { beijingDateParts, isChinaTradingWeekday } from "../jobs/schedule";

interface HealthJob { job: string; trade_date: string; status: string; message: string; started_at: string; finished_at: string | null }
interface HealthSource { source?: string; provider?: string; status: string; received_at: string; message: string }
interface HealthNewsRun {
  run_id: string;
  fetch_date: string;
  source_tier: number;
  transport: string;
  status: string;
  source_total: number;
  source_success: number;
  kept_item_count: number;
  filtered_item_count: number;
  started_at: string;
  finished_at: string | null;
  error_summary_json: string;
}

const healthSection = (status: string, message: string, updatedAt: string | null) => ({ status, message, updatedAt });

export interface DailyJobHealth {
  tradeDate: string;
  generatedAt: string;
  heartbeat?: SchedulerHeartbeatHealth | null;
  jobs: Record<string, {
    status: "pending" | "running" | "partial" | "complete" | "failed";
    expectedAt: string;
    finishedAt: string | null;
    nextRetryAt: string | null;
    message: string;
    attempt: number;
    overdue: boolean;
  }>;
  stages?: Record<string, {
    status: string;
    finishedAt: string | null;
    nextRetryAt: string | null;
    message: string;
  }>;
  fields?: Record<string, DailyFieldHealth>;
}

export interface SchedulerHeartbeatHealth {
  receivedAt: string;
  status: "running" | "complete" | "failed";
  message: string;
  stale: boolean;
}

export function buildSchedulerHeartbeat(
  value: string | null | undefined,
  now = new Date(),
): SchedulerHeartbeatHealth | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SchedulerHeartbeatHealth>;
    const receivedAt = typeof parsed.receivedAt === "string" ? parsed.receivedAt : "";
    const timestamp = new Date(receivedAt).getTime();
    if (!receivedAt || !Number.isFinite(timestamp)) return null;
    const stale = now.getTime() - timestamp > 10 * 60_000;
    const status = stale
      ? "failed"
      : parsed.status === "running" || parsed.status === "failed"
        ? parsed.status
        : "complete";
    return {
      receivedAt,
      status,
      message: typeof parsed.message === "string" ? parsed.message : "",
      stale,
    };
  } catch {
    return null;
  }
}

export interface DailyFieldHealth {
  status: "complete" | "partial" | "missing" | "initializing";
  source: string;
  marketTime: string | null;
  receivedAt: string | null;
  message: string;
}

export function buildDailyFieldHealth(
  review: DailyReview | null,
  progress: NewHighProgress,
): Record<string, DailyFieldHealth> {
  const field = (
    status: DailyFieldHealth["status"],
    message: string,
    source = review?.source ?? "",
    marketTime: string | null = null,
    receivedAt: string | null = review?.updatedAt ?? null,
  ): DailyFieldHealth => ({ status, source, marketTime, receivedAt, message });
  if (!review) {
    return {
      closeReview: field("missing", "尚无收盘复盘"),
      high20: field(progress.ready ? "missing" : "initializing", `${progress.completed}/${progress.target}`),
      high120: field(progress.ready ? "missing" : "initializing", `${progress.completed}/${progress.target}`),
      allTimeHigh: field(progress.ready ? "missing" : "initializing", `${progress.completed}/${progress.target}`),
    };
  }
  const highStatus = (value: number | null | undefined): DailyFieldHealth["status"] =>
    value !== null && value !== undefined ? "complete" : progress.ready ? "missing" : "initializing";
  const evidence = review.comparison?.evidence ?? {};
  const evidenceField = (key: string, available: boolean, missingMessage: string) => {
    const item = evidence[key];
    return field(
      available ? item?.status === "partial" ? "partial" : "complete" : "missing",
      item?.message || missingMessage,
      item?.source || review.source,
      item?.marketTime ?? null,
      item?.receivedAt ?? review.updatedAt,
    );
  };
  return {
    breadth: field(
      review.breadthMeta?.status === "complete" ? "complete" : "partial",
      review.breadthMeta
        ? `已采集 ${review.breadthMeta.captured}/${review.breadthMeta.expected}`
        : `已采集 ${review.breadth.length}/6`,
    ),
    high20: field(highStatus(review.metrics.high20), review.metrics.high20 === null ? `${progress.completed}/${progress.target}` : "已核验"),
    high120: field(highStatus(review.metrics.high120), review.metrics.high120 === null ? `${progress.completed}/${progress.target}` : "已核验"),
    allTimeHigh: field(highStatus(review.metrics.allTimeHigh), review.metrics.allTimeHigh === null ? `${progress.completed}/${progress.target}` : "已核验"),
    marketAmount: evidenceField("marketAmount", review.comparison?.marketAmount !== null && review.comparison?.marketAmount !== undefined, "全市场成交额暂缺"),
    largeDownCount: evidenceField("largeDownCount", review.comparison?.largeDownCount !== null && review.comparison?.largeDownCount !== undefined, "大跌家数暂缺"),
    indices: evidenceField("indices", Boolean(review.comparison?.indices.length), "指数数据暂缺"),
    structure: field(
      review.structure?.status === "complete" ? "complete" : review.structure?.status === "partial" ? "partial" : "missing",
      review.structure?.message ?? "涨跌停结构暂缺",
      review.structure?.source ?? review.source,
      null,
      review.structure?.receivedAt ?? review.updatedAt,
    ),
    closePremium: field(review.premium.closePct === null ? "missing" : "complete", review.premium.closePct === null ? "连板溢价样本暂缺" : `样本 ${review.premium.sampleSize}`),
  };
}

export function buildDailyJobHealth({
  tradeDate,
  now,
  checkpoints,
  artifacts,
}: {
  tradeDate: string;
  now: Date;
  checkpoints: JobCheckpoint[];
  artifacts?: {
    morningBrief?: {
      valid: boolean;
      updatedAt: string | null;
    } | null;
  };
}): DailyJobHealth {
  const checkpointByKey = new Map(
    checkpoints
      .filter((checkpoint) => checkpoint.stage === "main")
      .map((checkpoint) => [checkpoint.key, checkpoint]),
  );
  const jobs = Object.fromEntries(expectedDailyJobs(tradeDate, {
    marketSession: isChinaTradingWeekday(now),
  }).map((expected) => {
    const checkpoint = checkpointByKey.get(expected.key);
    const overdue = now.getTime() > new Date(expected.expectedAt).getTime() + 5 * 60_000
      && checkpoint?.status !== "complete";
    return [expected.key, {
      status: checkpoint?.status ?? "pending",
      expectedAt: expected.expectedAt,
      finishedAt: checkpoint?.finishedAt ?? null,
      nextRetryAt: checkpoint?.nextRetryAt ?? null,
      message: checkpoint?.message ?? (overdue ? "计划时间已过，等待自动补跑" : "等待计划时间"),
      attempt: checkpoint?.attempt ?? 0,
      overdue,
    }];
  }));
  const stages = Object.fromEntries(checkpoints
    .filter((checkpoint) => checkpoint.stage !== "main")
    .map((checkpoint) => [`${checkpoint.key}:${checkpoint.stage}`, {
      status: checkpoint.status,
      finishedAt: checkpoint.finishedAt,
      nextRetryAt: checkpoint.nextRetryAt,
      message: checkpoint.message,
    }]));
  const persistedBrief = artifacts?.morningBrief;
  if (persistedBrief?.valid && jobs["morning-brief"]?.status !== "complete") {
    jobs["morning-brief"] = {
      ...jobs["morning-brief"],
      status: "complete",
      finishedAt: persistedBrief.updatedAt,
      nextRetryAt: null,
      message: "早参已生成并通过结构校验",
      overdue: false,
    };
  }
  return { tradeDate, generatedAt: now.toISOString(), jobs, stages };
}

export function summarizeDataHealth({
  jobs,
  audits,
  globalPoints,
  newsRuns = [],
}: {
  jobs: HealthJob[];
  audits: HealthSource[];
  globalPoints: HealthSource[];
  newsRuns?: HealthNewsRun[];
}) {
  const latestAudit = audits[0];
  const marketPoints = globalPoints.filter((point) => point.provider !== "FRED" && point.provider !== "EIA");
  const macroPoints = globalPoints.filter((point) => point.provider === "FRED" || point.provider === "EIA");
  const aiJob = jobs.find((job) => job.job === "morning-brief");
  const domesticStatus = latestAudit?.status === "complete" ? "complete" : latestAudit ? "partial" : "demo";
  const globalStatus = marketPoints.some((point) => point.status === "ok") ? "complete" : marketPoints.length ? "partial" : "demo";
  const macroStatus = macroPoints.length > 0 && macroPoints.every((point) => point.status === "ok") ? "complete" : macroPoints.length ? "partial" : "demo";
  const aiStatus = aiJob?.status === "complete" ? "complete" : aiJob ? "partial" : "demo";
  const sections = {
    domestic: healthSection(domesticStatus, latestAudit?.message ?? "尚无国内行情审计", latestAudit?.received_at ?? null),
    global: healthSection(globalStatus, marketPoints.find((point) => point.message)?.message ?? (marketPoints.length ? "海外行情已采集" : "尚无海外行情"), marketPoints[0]?.received_at ?? null),
    macro: healthSection(macroStatus, macroPoints.find((point) => point.message)?.message ?? (macroPoints.length ? "宏观数据已采集" : "尚无宏观数据"), macroPoints[0]?.received_at ?? null),
    ai: healthSection(aiStatus, aiJob?.message || (aiJob ? "早参已生成" : "尚无早参任务"), aiJob?.finished_at ?? aiJob?.started_at ?? null),
  };
  const newsRun = (tier: 1 | 2) => {
    const run = newsRuns.find((item) => Number(item.source_tier) === tier);
    if (!run) return null;
    let errors: string[] = [];
    try {
      const parsed = JSON.parse(run.error_summary_json);
      if (Array.isArray(parsed)) errors = parsed.filter((item): item is string => typeof item === "string");
    } catch { errors = ["采集错误摘要无法解析"]; }
    return {
      status: run.status,
      fetchDate: run.fetch_date,
      transport: run.transport,
      sourceTotal: Number(run.source_total),
      sourceSuccess: Number(run.source_success),
      keptItemCount: Number(run.kept_item_count),
      filteredItemCount: Number(run.filtered_item_count),
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      errors,
    };
  };
  const newsCollection = newsRuns.length > 0 ? { tier1: newsRun(1), tier2: newsRun(2) } : null;
  const statuses = [
    ...Object.values(sections).map((section) => section.status),
    ...(newsCollection ? [newsCollection.tier1?.status, newsCollection.tier2?.status].filter((status): status is string => Boolean(status)) : []),
  ];
  return {
    status: statuses.every((status) => status === "complete") ? "complete" : statuses.every((status) => status === "demo") ? "demo" : "partial",
    lastRun: jobs[0] ?? null,
    jobs,
    newsCollection,
    ...sections,
  };
}

async function getD1(): Promise<D1Database | null> {
  try {
    const { env } = await import("cloudflare:workers");
    return env.DB ?? null;
  } catch { return null; }
}

export async function readReview(date: string): Promise<DailyReview | null> {
  const db = await getD1();
  if (!db) return null;
  const row = await db.prepare("SELECT payload FROM daily_reviews WHERE trade_date = ?").bind(date).first<{ payload: string }>();
  return row?.payload ? JSON.parse(row.payload) : null;
}

export async function readLatestReview(onOrBefore: string): Promise<DailyReview | null> {
  const db = await getD1();
  if (!db) return null;
  const row = await db.prepare("SELECT payload FROM daily_reviews WHERE trade_date <= ? ORDER BY trade_date DESC LIMIT 1").bind(onOrBefore).first<{ payload: string }>();
  if (!row?.payload) return null;
  try { return JSON.parse(row.payload) as DailyReview; }
  catch { return null; }
}

export async function readBrief(date: string): Promise<MorningBrief | null> {
  const db = await getD1();
  if (!db) return null;
  const row = await db.prepare("SELECT payload FROM morning_briefs WHERE trade_date = ?").bind(date).first<{ payload: string }>();
  if (!row?.payload) return null;
  try {
    const brief = JSON.parse(row.payload) as unknown;
    return isValidPersistedMorningBrief(brief) ? brief : null;
  } catch {
    return null;
  }
}

export async function readLatestBriefFromDatabase(
  db: D1Database,
  onOrBefore: string,
): Promise<MorningBrief | null> {
  const result = await db.prepare(
    "SELECT payload FROM morning_briefs WHERE trade_date <= ? ORDER BY trade_date DESC LIMIT 30",
  ).bind(onOrBefore).all<{ payload: string }>();
  for (const row of result.results ?? []) {
    try {
      const brief = JSON.parse(row.payload) as unknown;
      if (isValidPersistedMorningBrief(brief)) return brief;
    } catch {
      // Skip malformed persisted rows and continue to the next verified brief.
    }
  }
  return null;
}

export async function readLatestBrief(onOrBefore: string): Promise<MorningBrief | null> {
  const db = await getD1();
  return db ? readLatestBriefFromDatabase(db, onOrBefore) : null;
}

export async function readHistory(from: string, to: string): Promise<HistoryRow[]> {
  const db = await getD1();
  if (!db) return [];
  const result = await db.prepare("SELECT payload FROM daily_reviews WHERE trade_date BETWEEN ? AND ? ORDER BY trade_date DESC LIMIT 2000").bind(from, to).all<{ payload: string }>();
  return (result.results ?? []).flatMap((row) => {
    try { return [reviewToHistoryRow(JSON.parse(row.payload) as DailyReview)]; }
    catch { return []; }
  });
}

export async function readHighDetails(date: string): Promise<HighDetail[]> {
  const db = await getD1();
  if (!db) return [];
  try {
    const result = await db.prepare("SELECT trade_date, type, symbol, name, sector, pct_change, close, high_price, amount, interval_pct, high_date, is_all_time FROM new_high_details WHERE trade_date = ?").bind(date).all<{
      trade_date: string; type: string; symbol: string; name: string; sector: string; pct_change: number; close: number;
      high_price: number; amount: number; interval_pct: number; high_date: string; is_all_time: number;
    }>();
    return (result.results ?? []).flatMap((row) => row.type === "20d" || row.type === "120d" || row.type === "all-time" ? [{
      date: row.trade_date,
      type: row.type,
      symbol: row.symbol,
      name: row.name,
      sector: row.sector,
      pctChange: row.pct_change,
      close: row.close,
      highPrice: row.high_price,
      amount: row.amount,
      intervalPct: row.interval_pct,
      highDate: row.high_date,
      isAllTime: Boolean(row.is_all_time),
    }] : []);
  } catch { return []; }
}

export async function readNewHighProgress(targetDate: string): Promise<NewHighProgress> {
  const db = await getD1();
  if (!db) {
    return buildNewHighProgress({
      targetDate,
      completed: 0,
      target: 0,
      failed: 0,
      updatedAt: null,
    });
  }
  try {
    const latestReview = await db.prepare(
      "SELECT MAX(trade_date) AS trade_date FROM daily_reviews WHERE trade_date <= ?",
    ).bind(targetDate).first<{ trade_date: string | null }>();
    const resolvedTargetDate = resolveNewHighProgressTargetDate(
      targetDate,
      latestReview?.trade_date,
    );
    const [targetRow, completedRow, jobRow] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS count FROM stocks WHERE UPPER(name) NOT LIKE '%ST%'").first<{ count: number }>(),
      db.prepare(
        "SELECT COUNT(*) AS count FROM new_high_states WHERE status = 'active' AND initialized_through >= ?",
      ).bind(resolvedTargetDate).first<{ count: number }>(),
      db.prepare(
        "SELECT message, finished_at, started_at FROM job_runs WHERE job = 'new-high-bootstrap' ORDER BY id DESC LIMIT 1",
      ).first<{ message: string; finished_at: string | null; started_at: string }>(),
    ]);
    return buildNewHighProgress({
      targetDate: resolvedTargetDate,
      completed: Number(completedRow?.count ?? 0),
      target: Number(targetRow?.count ?? 0),
      failed: parseNewHighBootstrapFailureCount(jobRow?.message),
      updatedAt: jobRow?.finished_at ?? jobRow?.started_at ?? null,
      minimumTarget: 5_000,
    });
  } catch {
    return buildNewHighProgress({
      targetDate,
      completed: 0,
      target: 0,
      failed: 0,
      updatedAt: null,
      minimumTarget: 5_000,
    });
  }
}

export async function readGlobalSnapshot(date: string) {
  const db = await getD1();
  if (!db) return { raw: [], reconciled: [] };
  try {
    const result = await db.prepare("SELECT symbol, label, provider, market_time, received_at, value, previous_close, pct_change, period, status, message FROM global_market_snapshots WHERE trade_date = ? ORDER BY symbol, provider").bind(date).all<{
      symbol: string; label: string; provider: string; market_time: string | null; received_at: string;
      value: number | null; previous_close: number | null; pct_change: number | null; period: string; status: GlobalPoint["status"]; message: string;
    }>();
    const raw: GlobalPoint[] = (result.results ?? []).map((row) => ({
      key: row.symbol, label: row.label, provider: row.provider, marketTime: row.market_time, receivedAt: row.received_at,
      value: row.value, previousClose: row.previous_close, pctChange: row.pct_change, period: row.period, status: row.status, message: row.message,
    }));
    return { raw, reconciled: reconcileGlobalPoints(raw) };
  } catch { return { raw: [], reconciled: [] }; }
}

export async function readDataHealth() {
  const db = await getD1();
  const now = new Date();
  const tradeDate = beijingDateParts(now).date;
  if (!db) return {
    ...summarizeDataHealth({ jobs: [], audits: [], globalPoints: [] }),
    daily: buildDailyJobHealth({ tradeDate, now, checkpoints: [] }),
  };
  const [jobResult, auditResult, globalResult, newsResult, checkpoints, latestReviewRow, heartbeatRow, morningBriefRow] = await Promise.all([
    db.prepare("SELECT job, trade_date, status, message, started_at, finished_at FROM job_runs ORDER BY id DESC LIMIT 20").all<HealthJob>().catch(() => ({ results: [] })),
    db.prepare("SELECT source, status, received_at, message FROM market_source_audits ORDER BY received_at DESC LIMIT 20").all<HealthSource>().catch(() => ({ results: [] })),
    db.prepare("SELECT provider, status, received_at, message FROM global_market_snapshots ORDER BY received_at DESC LIMIT 40").all<HealthSource>().catch(() => ({ results: [] })),
    db.prepare(`SELECT run_id, fetch_date, source_tier, transport, status, source_total, source_success,
      kept_item_count, filtered_item_count, started_at, finished_at, error_summary_json
      FROM brief_fetch_runs ORDER BY fetch_date DESC, source_tier ASC, finished_at DESC LIMIT 20`)
      .all<HealthNewsRun>().catch(() => ({ results: [] })),
    readDailyJobCheckpoints(db, tradeDate).catch(() => []),
    db.prepare("SELECT payload FROM daily_reviews WHERE trade_date <= ? ORDER BY trade_date DESC LIMIT 1")
      .bind(tradeDate).first<{ payload: string }>().catch(() => null),
    db.prepare("SELECT value FROM bootstrap_state WHERE key = 'scheduler-heartbeat'")
      .first<{ value: string }>().catch(() => null),
    db.prepare("SELECT payload, updated_at FROM morning_briefs WHERE trade_date = ?")
      .bind(tradeDate).first<{ payload: string; updated_at: string }>().catch(() => null),
  ]);
  let latestReview: DailyReview | null = null;
  try {
    latestReview = latestReviewRow?.payload ? JSON.parse(latestReviewRow.payload) as DailyReview : null;
  } catch {
    latestReview = null;
  }
  const progress = await readNewHighProgress(latestReview?.date ?? tradeDate);
  let persistedMorningBriefValid = false;
  try {
    persistedMorningBriefValid = Boolean(
      morningBriefRow?.payload
      && isValidPersistedMorningBrief(JSON.parse(morningBriefRow.payload)),
    );
  } catch {
    persistedMorningBriefValid = false;
  }
  const daily = buildDailyJobHealth({
    tradeDate,
    now,
    checkpoints,
    artifacts: {
      morningBrief: {
        valid: persistedMorningBriefValid,
        updatedAt: morningBriefRow?.updated_at ?? null,
      },
    },
  });
  daily.heartbeat = buildSchedulerHeartbeat(heartbeatRow?.value, now);
  daily.fields = buildDailyFieldHealth(latestReview, progress);
  return {
    ...summarizeDataHealth({
    jobs: jobResult.results ?? [],
    audits: auditResult.results ?? [],
    globalPoints: globalResult.results ?? [],
    newsRuns: newsResult.results ?? [],
    }),
    daily,
  };
}
