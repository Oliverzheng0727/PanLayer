import type { DailyJobHealth } from "../data/repository";
import type { DailyReview } from "../domain/types";
import type { NewHighProgress } from "../history/new-high-progress";

export type SidebarProgressStatus =
  | "pending"
  | "running"
  | "partial"
  | "complete"
  | "failed";

export interface SidebarProgressTask {
  key: "breadth" | "close-review" | "new-high" | "morning-brief" | "etf";
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
  tasks: SidebarProgressTask[];
}

const CONTINUOUS_KEYS = new Set(["new-high-bootstrap", "history-backfill"]);
const STATUS_VALUE: Record<SidebarProgressStatus, string> = {
  pending: "等待",
  running: "更新中",
  partial: "部分",
  complete: "完成",
  failed: "失败",
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
): SidebarProgressStatus {
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
  const overallStatus: SidebarProgressStatus = failed || reviewStatus === "failed"
    ? "failed"
    : running
      ? "running"
      : partial || reviewStatus === "partial" || reviewStatus === "demo"
        ? "partial"
        : dueJobs.length > 0 && completedDue === dueJobs.length
          ? "complete"
          : "pending";
  const breadthStatus = aggregateBreadthStatus(breadthJobs, now);
  const closeStatus = normalizeStatus(close?.status);
  const briefStatus = normalizeStatus(brief?.status);
  const etfStatus = normalizeStatus(etf?.status);
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
    tasks: [
      {
        key: "breadth",
        label: "盘中快照",
        status: breadthStatus,
        value: `${breadthCompleted}/6`,
        detail: breadthCompleted === 6 ? "六个节点完整" : "缺失节点将按有效窗口补跑",
        updatedAt: latestFinishedAt(breadthJobs),
      },
      {
        key: "close-review",
        label: "收盘复盘",
        status: closeStatus,
        value: closeStages.length > 0
          ? `${closeStagesComplete}/${closeStages.length}`
          : STATUS_VALUE[closeStatus],
        detail: close?.message || "等待 16:10",
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
        value: STATUS_VALUE[etfStatus],
        detail: etf?.message || "等待 15:30",
        updatedAt: etf?.finishedAt ?? null,
      },
    ],
  };
}
