import { isValidPersistedMorningBrief } from "../ai/morning-brief-assembly";
import type { MorningBrief } from "../ai/morning-brief-contract";
import type { Breadth, DailyReview } from "../domain/types";
import { reviewToHistoryRow, type HistoryRow } from "../history/query";
import type { HighDetail } from "../history/high-details";
import {
  buildNewHighProgress,
  type NewHighProgress,
} from "../history/new-high-progress";
import { readNewHighProgressSnapshot } from "../history/new-high-d1-store";
import {
  readHistoryContributionProgress,
  type HistoryContributionProgress,
} from "../history/contributions";
import { reconcileGlobalPoints } from "./global/reconcile";
import type { GlobalPoint } from "./global/types";
import {
  BREADTH_CHECKPOINT_TIMES,
  expectedDailyJobs,
  readDailyJobCheckpoints,
  readJobExecutionMetadata,
  type JobExecutionTrigger,
  type JobCheckpoint,
} from "../jobs/checkpoints";
import { beijingDateParts, isChinaTradingWeekday } from "../jobs/schedule";
import { breadthRecoveryWindowMs } from "../jobs/breadth-recovery";

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

export interface IntradayBreadthPoint extends Breadth {
  time: string;
  source: string;
  status: "complete" | "partial";
  updatedAt: string;
}

export interface IntradayBreadthTimeline {
  date: string;
  snapshots: IntradayBreadthPoint[];
  meta: {
    expected: number;
    captured: number;
    pending: string[];
    recovering: string[];
    missing: string[];
    status: "pending" | "partial" | "complete";
    source: string;
    updatedAt: string | null;
  };
}

interface IntradayBreadthRow {
  trade_date: string;
  snapshot_time: string;
  rising: number;
  falling: number;
  flat: number;
  source: string;
  status: string;
  updated_at: string;
}

function mapIntradayBreadthPoint(row: IntradayBreadthRow): IntradayBreadthPoint | null {
  const rising = Number(row.rising);
  const falling = Number(row.falling);
  const flat = Number(row.flat);
  if (![rising, falling, flat].every(Number.isFinite)) return null;
  return {
    time: String(row.snapshot_time),
    rising,
    falling,
    flat,
    source: String(row.source ?? ""),
    status: row.status === "complete" ? "complete" : "partial",
    updatedAt: String(row.updated_at ?? ""),
  };
}

export function buildIntradayBreadthTimeline({
  date,
  now,
  snapshots,
}: {
  date: string;
  now: Date;
  snapshots: IntradayBreadthPoint[];
}): IntradayBreadthTimeline {
  const expected = new Set<string>(BREADTH_CHECKPOINT_TIMES);
  const validByTime = new Map(
    snapshots
      .filter((snapshot) => expected.has(snapshot.time))
      .map((snapshot) => [snapshot.time, snapshot]),
  );
  const ordered = BREADTH_CHECKPOINT_TIMES.flatMap((time) => {
    const snapshot = validByTime.get(time);
    return snapshot ? [snapshot] : [];
  });
  const pending: string[] = [];
  const recovering: string[] = [];
  const missing: string[] = [];

  for (const time of BREADTH_CHECKPOINT_TIMES) {
    if (validByTime.has(time)) continue;
    const expectedAt = new Date(`${date}T${time}:00+08:00`).getTime();
    if (now.getTime() < expectedAt) {
      pending.push(time);
    } else if (now.getTime() <= expectedAt + breadthRecoveryWindowMs(time)) {
      recovering.push(time);
    } else {
      missing.push(time);
    }
  }

  const captured = ordered.length;
  const sources = [...new Set(ordered.map((snapshot) => snapshot.source).filter(Boolean))];
  const updatedAt = ordered
    .map((snapshot) => snapshot.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  return {
    date,
    snapshots: ordered,
    meta: {
      expected: BREADTH_CHECKPOINT_TIMES.length,
      captured,
      pending,
      recovering,
      missing,
      status: captured === BREADTH_CHECKPOINT_TIMES.length
        ? "complete"
        : captured > 0 || recovering.length > 0 || missing.length > 0
          ? "partial"
          : "pending",
      source: sources.join(" / "),
      updatedAt,
    },
  };
}

export function buildIntradayBreadthHistory({
  rows,
  now,
  limit,
}: {
  rows: IntradayBreadthRow[];
  now: Date;
  limit: number;
}): IntradayBreadthTimeline[] {
  const safeLimit = Math.min(120, Math.max(1, Math.trunc(limit)));
  const grouped = new Map<string, IntradayBreadthPoint[]>();
  for (const row of rows) {
    const date = String(row.trade_date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const point = mapIntradayBreadthPoint(row);
    if (!point) continue;
    const points = grouped.get(date) ?? [];
    points.push(point);
    grouped.set(date, points);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, safeLimit)
    .map(([date, snapshots]) => buildIntradayBreadthTimeline({ date, now, snapshots }));
}

const healthSection = (status: string, message: string, updatedAt: string | null) => ({ status, message, updatedAt });

export interface DailyJobHealth {
  tradeDate: string;
  generatedAt: string;
  latestCompletedTradeDate?: string | null;
  /** Whether the current Beijing date is a regular A-share trading weekday. */
  marketSession?: boolean;
  heartbeat?: SchedulerHeartbeatHealth | null;
  jobs: Record<string, {
    status: "pending" | "running" | "partial" | "complete" | "failed";
    expectedAt: string;
    finishedAt: string | null;
    nextRetryAt: string | null;
    message: string;
    attempt: number;
    overdue: boolean;
    delayMinutes: number | null;
    timeliness: "not-due" | "on-time" | "delayed";
    trigger?: JobExecutionTrigger | null;
    firstAutomaticCompletedAt?: string | null;
    lastAutomaticCompletedAt?: string | null;
    lastManualCompletedAt?: string | null;
  }>;
  stages?: Record<string, {
    status: string;
    finishedAt: string | null;
    nextRetryAt: string | null;
    message: string;
  }>;
  fields?: Record<string, DailyFieldHealth>;
  background?: {
    historyContribution: HistoryContributionProgress | null;
    historyFields: {
      dates: number;
      fields: Record<string, {
        complete: number;
        partial: number;
        pending: number;
        unavailable: number;
      }>;
    } | null;
  };
}

export interface SchedulerHeartbeatHealth {
  receivedAt: string;
  provider: "cloudflare" | "github" | "worker" | "unknown";
  status: "running" | "partial" | "complete" | "failed";
  message: string;
  stale: boolean;
}

// A task can legitimately run for several minutes. Mark the scheduler stale
// only after the agreed 90-minute operational threshold.
export const SCHEDULER_HEARTBEAT_STALE_MS = 90 * 60_000;

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
    const stale = now.getTime() - timestamp > SCHEDULER_HEARTBEAT_STALE_MS;
    const status = stale
      ? "failed"
      : parsed.status === "running" || parsed.status === "partial" || parsed.status === "failed"
        ? parsed.status
        : "complete";
    return {
      receivedAt,
      provider: parsed.provider === "cloudflare" || parsed.provider === "github" || parsed.provider === "worker"
        ? parsed.provider
        : "worker",
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
  availability?: "primary" | "fallback" | "permission-denied" | "sample-insufficient" | "unavailable";
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
    availability: DailyFieldHealth["availability"] = status === "missing" ? "unavailable" : "primary",
  ): DailyFieldHealth => ({ status, availability, source, marketTime, receivedAt, message });
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
  const structuredEvidence = review.structuredSignals?.evidence ?? {};
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
  const structuredField = (key: string, label: string) => {
    const item = structuredEvidence[key];
    const permissionDenied = /(?:^|\s)403(?:\s|$)|无权限|forbidden|permission/i.test(item?.message ?? "");
    const fallback = Boolean(item?.source && !item.source.includes("扶摇"));
    return field(
      item?.status === "complete" ? "complete" : item?.status === "partial" ? "partial" : "missing",
      item?.message || `${label}暂缺`,
      item?.source || "扶摇 Fuyao",
      item?.marketTime ?? null,
      item?.receivedAt ?? review.updatedAt,
      permissionDenied ? "permission-denied" : fallback ? "fallback" : item ? "primary" : "unavailable",
    );
  };
  return {
    breadth: field(
      review.breadthMeta?.status === "complete" ? "complete" : "partial",
      review.breadthMeta
        ? `已采集 ${review.breadthMeta.captured}/${review.breadthMeta.expected}`
        : `已采集 ${review.breadth.length}/6`,
    ),
    fuyaoQuotes: field(
      review.source.includes("扶摇 Fuyao") ? "complete" : "partial",
      review.source.includes("扶摇 Fuyao") ? "扶摇全 A 行情为主源，原有行情源交叉验证" : "扶摇行情未成为本次主源，已使用降级行情",
      review.source,
      `${review.date}T15:00:00+08:00`,
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
    fuyaoLimitUp: structuredField("limitUpPool", "扶摇涨停池"),
    fuyaoLadder: structuredField("ladder", "扶摇连板梯队"),
    fuyaoHotStocks: structuredField("hotStocks", "扶摇热股榜"),
    fuyaoSkyrocket: structuredField("skyrocket", "扶摇飙升榜"),
    fuyaoDragonTiger: structuredField("dragonTiger", "扶摇龙虎榜"),
    fuyaoAnomalies: structuredField("anomalies", "扶摇异动原因"),
    fuyaoSectors: structuredField("sectors", "扶摇板块指数"),
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
  const visibleRetryAt = (
    status: JobCheckpoint["status"] | undefined,
    value: string | null | undefined,
  ) => {
    if (!value || status === "complete") return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) && timestamp > now.getTime() ? value : null;
  };
  const jobs = Object.fromEntries(expectedDailyJobs(tradeDate, {
    marketSession: isChinaTradingWeekday(now),
  }).map((expected) => {
    const checkpoint = checkpointByKey.get(expected.key);
    const execution = readJobExecutionMetadata(checkpoint?.resultJson);
    const noOpCompletion = /(?:already complete|no failed or missing modules).*skipped/i
      .test(checkpoint?.message ?? "");
    const checkpointFinishedAt = checkpoint?.finishedAt ?? null;
    const pollutedAutomaticCompletion = Boolean(
      noOpCompletion
      && execution
      && execution.trigger !== "manual"
      && checkpointFinishedAt
      && execution.lastAutomaticCompletedAt === checkpointFinishedAt,
    );
    const firstAutomaticCompletedAt = pollutedAutomaticCompletion
      && execution?.firstAutomaticCompletedAt === checkpointFinishedAt
      ? null
      : execution?.firstAutomaticCompletedAt ?? null;
    const lastAutomaticCompletedAt = pollutedAutomaticCompletion
      ? firstAutomaticCompletedAt
      : execution?.lastAutomaticCompletedAt ?? null;
    const effectiveTrigger = pollutedAutomaticCompletion
      && !firstAutomaticCompletedAt
      && execution?.lastManualCompletedAt
      ? "manual" as const
      : execution?.trigger ?? null;
    const expectedTime = new Date(expected.expectedAt).getTime();
    const graceMs = expected.key.startsWith("breadth-")
      ? breadthRecoveryWindowMs(expected.key.replace("breadth-", ""))
      : 5 * 60_000;
    const overdue = now.getTime() > expectedTime + graceMs
      && checkpoint?.status !== "complete";
    const automaticFinishedAt = firstAutomaticCompletedAt ?? (
      effectiveTrigger === "manual" || pollutedAutomaticCompletion ? null : checkpoint?.finishedAt ?? null
    );
    const effectiveFinishedAt = automaticFinishedAt ?? (
      effectiveTrigger === "manual" ? execution?.lastManualCompletedAt ?? checkpoint?.finishedAt ?? null : null
    );
    const finishedTime = effectiveFinishedAt ? new Date(effectiveFinishedAt).getTime() : null;
    const delayMinutes = finishedTime !== null && Number.isFinite(finishedTime)
      ? Math.max(0, Math.round((finishedTime - expectedTime) / 60_000))
      : overdue ? Math.max(0, Math.round((now.getTime() - expectedTime) / 60_000)) : null;
    const timeliness = effectiveTrigger === "manual" && !automaticFinishedAt
      ? "on-time" as const
      : now.getTime() < expectedTime && !checkpoint
      ? "not-due" as const
      : overdue || (delayMinutes !== null && delayMinutes > graceMs / 60_000)
        ? "delayed" as const
        : "on-time" as const;
    const pendingMessage = now.getTime() < expectedTime
      ? "等待计划时间"
      : overdue
        ? "补采窗口已过，等待兜底重试"
        : "计划时间已到，正在自动采集";
    const nextRetryAt = visibleRetryAt(checkpoint?.status, checkpoint?.nextRetryAt);
    const retryElapsed = Boolean(checkpoint?.nextRetryAt && !nextRetryAt && checkpoint?.status !== "complete");
    return [expected.key, {
      status: checkpoint?.status ?? "pending",
      expectedAt: expected.expectedAt,
      finishedAt: checkpoint?.finishedAt ?? null,
      nextRetryAt,
      message: checkpoint?.message
        ? `${checkpoint.message}${retryElapsed ? "；已进入自动补跑队列" : ""}`
        : pendingMessage,
      attempt: checkpoint?.attempt ?? 0,
      overdue,
      delayMinutes,
      timeliness,
      trigger: effectiveTrigger,
      firstAutomaticCompletedAt,
      lastAutomaticCompletedAt,
      lastManualCompletedAt: execution?.lastManualCompletedAt ?? null,
    }];
  }));
  const stages = Object.fromEntries(checkpoints
    .filter((checkpoint) => checkpoint.stage !== "main")
    .map((checkpoint) => [`${checkpoint.key}:${checkpoint.stage}`, {
      status: checkpoint.status,
      finishedAt: checkpoint.finishedAt,
      nextRetryAt: visibleRetryAt(checkpoint.status, checkpoint.nextRetryAt),
      message: `${checkpoint.message}${
        checkpoint.nextRetryAt
        && !visibleRetryAt(checkpoint.status, checkpoint.nextRetryAt)
        && checkpoint.status !== "complete"
          ? "；已进入自动补跑队列"
          : ""
      }`,
    }]));
  const persistedBrief = artifacts?.morningBrief;
  if (persistedBrief?.valid && jobs["morning-brief"]?.status !== "complete") {
    const automaticBriefAt = jobs["morning-brief"].firstAutomaticCompletedAt;
    jobs["morning-brief"] = {
      ...jobs["morning-brief"],
      status: "complete",
      finishedAt: persistedBrief.updatedAt,
      nextRetryAt: null,
      message: "早参已生成并通过结构校验",
      overdue: false,
      delayMinutes: automaticBriefAt
        ? Math.max(0, Math.round((new Date(automaticBriefAt).getTime() - new Date(jobs["morning-brief"].expectedAt).getTime()) / 60_000))
        : null,
      timeliness: automaticBriefAt
        && new Date(automaticBriefAt).getTime() > new Date(jobs["morning-brief"].expectedAt).getTime() + 15 * 60_000
          ? "delayed"
          : "on-time",
      trigger: jobs["morning-brief"].trigger ?? null,
      firstAutomaticCompletedAt: jobs["morning-brief"].firstAutomaticCompletedAt ?? null,
      lastAutomaticCompletedAt: jobs["morning-brief"].lastAutomaticCompletedAt ?? null,
      lastManualCompletedAt: jobs["morning-brief"].lastManualCompletedAt ?? null,
    };
  }
  return {
    tradeDate,
    generatedAt: now.toISOString(),
    marketSession: isChinaTradingWeekday(now),
    jobs,
    stages,
  };
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

export async function readIntradayBreadthTimeline(
  date: string,
  now = new Date(),
): Promise<IntradayBreadthTimeline> {
  const db = await getD1();
  if (!db) return buildIntradayBreadthTimeline({ date, now, snapshots: [] });
  try {
    const result = await db.prepare(
      `SELECT snapshot_time, rising, falling, flat, source, status, updated_at
       FROM breadth_snapshots
       WHERE trade_date = ?
       ORDER BY snapshot_time`,
    ).bind(date).all<Omit<IntradayBreadthRow, "trade_date">>();
    const snapshots = (result.results ?? []).flatMap((row) => {
      const point = mapIntradayBreadthPoint({ ...row, trade_date: date });
      return point ? [point] : [];
    });
    return buildIntradayBreadthTimeline({ date, now, snapshots });
  } catch {
    return buildIntradayBreadthTimeline({ date, now, snapshots: [] });
  }
}

export async function readIntradayBreadthHistory(
  limit = 30,
  now = new Date(),
): Promise<IntradayBreadthTimeline[]> {
  const db = await getD1();
  if (!db) return [];
  const safeLimit = Math.min(120, Math.max(1, Math.trunc(limit)));
  try {
    const result = await db.prepare(
      `SELECT trade_date, snapshot_time, rising, falling, flat, source, status, updated_at
       FROM breadth_snapshots
       WHERE trade_date IN (
         SELECT trade_date
         FROM breadth_snapshots
         GROUP BY trade_date
         ORDER BY trade_date DESC
         LIMIT ?
       )
       ORDER BY trade_date DESC, snapshot_time`,
    ).bind(safeLimit).all<IntradayBreadthRow>();
    return buildIntradayBreadthHistory({
      rows: result.results ?? [],
      now,
      limit: safeLimit,
    });
  } catch {
    return [];
  }
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

export async function readBriefArchive(from: string, to: string): Promise<MorningBrief[]> {
  const db = await getD1();
  if (!db) return [];
  const result = await db.prepare(
    `SELECT payload
     FROM morning_briefs
     WHERE trade_date BETWEEN ? AND ?
     ORDER BY trade_date DESC
     LIMIT 100`,
  ).bind(from, to).all<{ payload: string }>();
  return (result.results ?? []).flatMap((row) => {
    try {
      const brief = JSON.parse(row.payload) as unknown;
      return isValidPersistedMorningBrief(brief) ? [brief] : [];
    } catch {
      return [];
    }
  });
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
    const snapshot = await readNewHighProgressSnapshot(db, targetDate);
    return buildNewHighProgress({
      targetDate: snapshot.targetDate,
      completed: snapshot.completed,
      currentCursor: snapshot.currentCursor,
      target: snapshot.target,
      failed: snapshot.failed,
      updatedAt: snapshot.updatedAt,
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
  const [jobResult, auditResult, globalResult, newsResult, checkpoints, currentReviewRow, latestReviewRow, heartbeatRow, morningBriefRow, etfCatalogRow, historyMetaRows] = await Promise.all([
    db.prepare("SELECT job, trade_date, status, message, started_at, finished_at FROM job_runs ORDER BY id DESC LIMIT 20").all<HealthJob>().catch(() => ({ results: [] })),
    db.prepare("SELECT source, status, received_at, message FROM market_source_audits ORDER BY received_at DESC LIMIT 20").all<HealthSource>().catch(() => ({ results: [] })),
    db.prepare("SELECT provider, status, received_at, message FROM global_market_snapshots ORDER BY received_at DESC LIMIT 40").all<HealthSource>().catch(() => ({ results: [] })),
    db.prepare(`SELECT run_id, fetch_date, source_tier, transport, status, source_total, source_success,
      kept_item_count, filtered_item_count, started_at, finished_at, error_summary_json
      FROM brief_fetch_runs ORDER BY fetch_date DESC, source_tier ASC, finished_at DESC LIMIT 20`)
      .all<HealthNewsRun>().catch(() => ({ results: [] })),
    readDailyJobCheckpoints(db, tradeDate).catch(() => []),
    db.prepare("SELECT payload, status FROM daily_reviews WHERE trade_date = ? LIMIT 1")
      .bind(tradeDate).first<{ payload: string; status: string }>().catch(() => null),
    db.prepare("SELECT payload, status FROM daily_reviews WHERE trade_date <= ? AND status = 'complete' ORDER BY trade_date DESC LIMIT 1")
      .bind(tradeDate).first<{ payload: string; status: string }>().catch(() => null),
    db.prepare("SELECT value FROM bootstrap_state WHERE key = 'scheduler-heartbeat'")
      .first<{ value: string }>().catch(() => null),
    db.prepare("SELECT payload, updated_at FROM morning_briefs WHERE trade_date = ?")
      .bind(tradeDate).first<{ payload: string; updated_at: string }>().catch(() => null),
    db.prepare("SELECT source, status, received_at FROM etf_catalog_cache WHERE trade_date <= ? ORDER BY trade_date DESC LIMIT 1")
      .bind(tradeDate).first<{ source: string; status: string; received_at: string }>().catch(() => null),
    db.prepare("SELECT payload FROM daily_reviews WHERE trade_date <= ? ORDER BY trade_date DESC LIMIT 120")
      .bind(tradeDate).all<{ payload: string }>().catch(() => ({ results: [] })),
  ]);
  let currentReview: DailyReview | null = null;
  let latestReview: DailyReview | null = null;
  try {
    currentReview = currentReviewRow?.payload
      ? JSON.parse(currentReviewRow.payload) as DailyReview
      : null;
  } catch {
    currentReview = null;
  }
  try {
    const parsed = latestReviewRow?.payload
      ? JSON.parse(latestReviewRow.payload) as DailyReview
      : null;
    latestReview = latestReviewRow?.status === "complete" && parsed?.status === "complete"
      ? parsed
      : null;
  } catch {
    latestReview = null;
  }
  const activeReview = currentReview ?? latestReview;
  const progress = await readNewHighProgress(activeReview?.date ?? tradeDate);
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
  daily.latestCompletedTradeDate = latestReview?.date ?? null;
  daily.fields = buildDailyFieldHealth(activeReview, progress);
  daily.background = {
    historyContribution: await readHistoryContributionProgress(db, activeReview?.date ?? tradeDate)
      .catch(() => null),
    historyFields: (() => {
      const records = (historyMetaRows.results ?? []).flatMap((row) => {
        try {
          const fields = (JSON.parse(row.payload) as DailyReview).historyMeta?.fields;
          return fields ? [fields] : [];
        } catch {
          return [];
        }
      });
      if (records.length === 0) return null;
      const fields: Record<string, { complete: number; partial: number; pending: number; unavailable: number }> = {};
      for (const record of records) {
        for (const [key, item] of Object.entries(record)) {
          fields[key] ??= { complete: 0, partial: 0, pending: 0, unavailable: 0 };
          fields[key][item.status] += 1;
        }
      }
      return { dates: records.length, fields };
    })(),
  };
  daily.fields.fuyaoEtf = {
    status: etfCatalogRow?.source.includes("扶摇 Fuyao")
      ? etfCatalogRow.status === "complete" ? "complete" : "partial"
      : etfCatalogRow ? "partial" : "missing",
    source: etfCatalogRow?.source ?? "扶摇 Fuyao",
    marketTime: activeReview ? `${activeReview.date}T15:30:00+08:00` : null,
    receivedAt: etfCatalogRow?.received_at ?? null,
    message: etfCatalogRow
      ? etfCatalogRow.source.includes("扶摇 Fuyao")
        ? "扶摇 ETF 行情与日 K 为主源，原有来源补充衍生指标"
        : "ETF 已使用原有来源降级，等待扶摇重试"
      : "ETF 快照暂缺",
    availability: etfCatalogRow?.source.includes("扶摇 Fuyao")
      ? "primary"
      : etfCatalogRow ? "fallback" : "unavailable",
  };
  return {
    ...summarizeDataHealth({
    jobs: jobResult.results ?? [],
    audits: auditResult.results ?? [],
    globalPoints: globalResult.results ?? [],
    newsRuns: newsResult.results ?? [],
    }),
    newHighProgress: progress,
    daily,
  };
}
