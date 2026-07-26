import type { DailyJobHealth } from "../data/repository";
import type { DailyReview } from "../domain/types";
import type { NewHighProgress } from "../history/new-high-progress";

export type SidebarProgressStatus =
  | "pending"
  | "running"
  | "partial"
  | "complete"
  | "failed"
  | "closed";

export interface SidebarProgressTask {
  key: "tier1-rss" | "tier2-firecrawl" | "breadth" | "close-review" | "new-high" | "morning-brief" | "etf";
  label: string;
  status: SidebarProgressStatus;
  value: string;
  detail: string;
  updatedAt: string | null;
}

export interface SidebarProgressModel {
  completedDue: number;
  dueTotal: number;
  percentage: number;
  overallStatus: SidebarProgressStatus;
  breadthCompleted: number;
  breadthExpected: 6;
  newHighCompleted: number;
  newHighTarget: number;
  newHighCoveragePct: number;
  marketSession: boolean;
  tasks: SidebarProgressTask[];
}

const CONTINUOUS_KEYS = new Set(["new-high-bootstrap", "history-backfill"]);
const STATUS_VALUE: Record<SidebarProgressStatus, string> = {
  pending: "等待",
  running: "更新中",
  partial: "部分",
  complete: "完成",
  failed: "失败",
  closed: "休市",
};

function normalizeStatus(status: string | undefined): SidebarProgressStatus {
  return status === "running"
    || status === "partial"
    || status === "complete"
    || status === "failed"
    ? status
    : "pending";
}

function latestFinishedAt(
  jobs: Array<[string, DailyJobHealth["jobs"][string]]>,
): string | null {
  return jobs
    .map(([, item]) => item.finishedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

function aggregateBreadthStatus(
  jobs: Array<[string, DailyJobHealth["jobs"][string]]>,
  now: number,
  marketSession: boolean,
): SidebarProgressStatus {
  if (!marketSession) return "closed";
  const due = jobs.filter(([, item]) => new Date(item.expectedAt).getTime() <= now);
  if (due.length === 0) return "pending";
  if (due.some(([, item]) => item.status === "failed")) return "failed";
  if (due.some(([, item]) => item.status === "running")) return "running";
  if (due.every(([, item]) => item.status === "complete") && jobs.length === 6) return "complete";
  return "partial";
}

export function buildSidebarProgress(
  health: DailyJobHealth,
  newHighProgress: NewHighProgress,
  reviewStatus: DailyReview["status"],
): SidebarProgressModel {
  const now = new Date(health.generatedAt).getTime();
  const marketSession = health.marketSession ?? true;
  const dueJobs = Object.entries(health.jobs).filter(([key, item]) =>
    !CONTINUOUS_KEYS.has(key) && new Date(item.expectedAt).getTime() <= now
  );
  const completedDue = dueJobs.filter(([, item]) => item.status === "complete").length;
  const breadthJobs = Object.entries(health.jobs).filter(([key]) => key.startsWith("breadth-"));
  const breadthCompleted = breadthJobs.filter(([, item]) => item.status === "complete").length;
  const close = health.jobs["close-review"];
  const closeStages = Object.entries(health.stages ?? {}).filter(([key]) => key.startsWith("close-review:"));
  const closeStagesComplete = closeStages.filter(([, stage]) => stage.status === "complete").length;
  const brief = health.jobs["morning-brief"];
  const etf = health.jobs["etf-metrics-refresh"];
  const failed = dueJobs.some(([, item]) => item.status === "failed");
  const running = dueJobs.some(([, item]) => item.status === "running");
  const partial = dueJobs.some(([, item]) => item.status === "partial" || item.overdue);
  // A weekend page reads the latest completed market review (usually Friday).
  // Its status must not turn the current closed day red; only today's due
  // jobs participate in the aggregate status on a non-trading day.
  const reviewAffectsStatus = marketSession;
  const overallStatus: SidebarProgressStatus = failed || (reviewAffectsStatus && reviewStatus === "failed")
    ? "failed"
    : running
      ? "running"
      : partial || (reviewAffectsStatus && (reviewStatus === "partial" || reviewStatus === "demo"))
        ? "partial"
        : dueJobs.length > 0 && completedDue === dueJobs.length
          ? "complete"
          : "pending";
  const breadthStatus = aggregateBreadthStatus(breadthJobs, now, marketSession);
  const closeStatus = marketSession ? normalizeStatus(close?.status) : "closed";
  const briefStatus = normalizeStatus(brief?.status);
  const etfStatus = marketSession ? normalizeStatus(etf?.status) : "closed";
  const newHighStatus: SidebarProgressStatus = newHighProgress.complete
    ? "complete"
    : newHighProgress.completed > 0
      ? "running"
      : newHighProgress.failed > 0
        ? "partial"
        : "pending";

  return {
    completedDue,
    dueTotal: dueJobs.length,
    percentage: dueJobs.length === 0 ? 0 : Math.round(completedDue / dueJobs.length * 100),
    overallStatus,
    breadthCompleted,
    breadthExpected: 6,
    newHighCompleted: newHighProgress.completed,
    newHighTarget: newHighProgress.target,
    newHighCoveragePct: newHighProgress.coveragePct,
    marketSession,
    tasks: [
      {
        key: "tier1-rss",
        label: "一级资讯 RSS",
        status: normalizeStatus(health.jobs["tier1-rss-prefetch"]?.status),
        value: STATUS_VALUE[normalizeStatus(health.jobs["tier1-rss-prefetch"]?.status)],
        detail: health.jobs["tier1-rss-prefetch"]?.message || "等待 06:50",
        updatedAt: health.jobs["tier1-rss-prefetch"]?.finishedAt ?? null,
      },
      {
        key: "tier2-firecrawl",
        label: "二级资讯 Firecrawl",
        status: normalizeStatus(health.jobs["tier2-news-prefetch"]?.status),
        value: STATUS_VALUE[normalizeStatus(health.jobs["tier2-news-prefetch"]?.status)],
        detail: health.jobs["tier2-news-prefetch"]?.message || "等待 06:55",
        updatedAt: health.jobs["tier2-news-prefetch"]?.finishedAt ?? null,
      },
      {
        key: "breadth",
        label: "盘中快照",
        status: breadthStatus,
        value: marketSession ? `${breadthCompleted}/6` : "非交易日",
        detail: marketSession
          ? breadthCompleted === 6 ? "六个节点完整" : "缺失节点将按有效窗口补跑"
          : "中国市场休市，今日无盘中节点",
        updatedAt: latestFinishedAt(breadthJobs),
      },
      {
        key: "close-review",
        label: "收盘复盘",
        status: closeStatus,
        value: !marketSession
          ? "不适用"
          : closeStages.length > 0
          ? `${closeStagesComplete}/${closeStages.length}`
          : STATUS_VALUE[closeStatus],
        detail: !marketSession ? "中国市场休市，等待下一个交易日" : close?.message || "等待 16:10",
        updatedAt: close?.finishedAt ?? null,
      },
      {
        key: "new-high",
        label: "新高初始化",
        status: newHighStatus,
        value: `${newHighProgress.completed}/${newHighProgress.target}`,
        detail: `覆盖 ${newHighProgress.coveragePct.toFixed(2)}%${newHighProgress.failed ? ` · 失败 ${newHighProgress.failed}` : ""}`,
        updatedAt: newHighProgress.updatedAt,
      },
      {
        key: "morning-brief",
        label: "盘前早参",
        status: briefStatus,
        value: STATUS_VALUE[briefStatus],
        detail: brief?.message || "等待 07:15",
        updatedAt: brief?.finishedAt ?? null,
      },
      {
        key: "etf",
        label: "ETF 指标",
        status: etfStatus,
        value: marketSession ? STATUS_VALUE[etfStatus] : "不适用",
        detail: marketSession ? etf?.message || "等待 15:30" : "中国市场休市，等待下一个交易日",
        updatedAt: etf?.finishedAt ?? null,
      },
    ],
  };
}
