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
  if (!db) return summarizeDataHealth({ jobs: [], audits: [], globalPoints: [] });
  const [jobResult, auditResult, globalResult, newsResult] = await Promise.all([
    db.prepare("SELECT job, trade_date, status, message, started_at, finished_at FROM job_runs ORDER BY id DESC LIMIT 20").all<HealthJob>().catch(() => ({ results: [] })),
    db.prepare("SELECT source, status, received_at, message FROM market_source_audits ORDER BY received_at DESC LIMIT 20").all<HealthSource>().catch(() => ({ results: [] })),
    db.prepare("SELECT provider, status, received_at, message FROM global_market_snapshots ORDER BY received_at DESC LIMIT 40").all<HealthSource>().catch(() => ({ results: [] })),
    db.prepare(`SELECT run_id, fetch_date, source_tier, transport, status, source_total, source_success,
      kept_item_count, filtered_item_count, started_at, finished_at, error_summary_json
      FROM brief_fetch_runs ORDER BY fetch_date DESC, source_tier ASC, finished_at DESC LIMIT 20`)
      .all<HealthNewsRun>().catch(() => ({ results: [] })),
  ]);
  return summarizeDataHealth({
    jobs: jobResult.results ?? [],
    audits: auditResult.results ?? [],
    globalPoints: globalResult.results ?? [],
    newsRuns: newsResult.results ?? [],
  });
}
