import type { DailyJobHealth } from "../data/repository";
import type { DailyReview } from "../domain/types";
import type { NewHighProgress } from "../history/new-high-progress";
import { isCloseReviewCoreStage } from "./close-review-stages";

export type SidebarProgressStatus =
  | "pending"
  | "running"
  | "partial"
  | "delayed"
  | "complete"
  | "failed"
  | "closed";

export interface SidebarProgressTask {
  key: "tier1-rss" | "tier2-firecrawl" | "fuyao" | "breadth" | "close-review" | "new-high" | "history-contribution" | "morning-brief" | "etf" | "etf-history";
  label: string;
  status: SidebarProgressStatus;
  value: string;
  detail: string;
  updatedAt: string | null;
  nextRetryAt?: string | null;
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
  delayed: "延迟",
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

function normalizeJobStatus(
  job: DailyJobHealth["jobs"][string] | undefined,
): SidebarProgressStatus {
  const status = normalizeStatus(job?.status);
  return status === "complete" && job?.timeliness === "delayed" ? "delayed" : status;
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
  if (due.every(([, item]) => item.status === "complete") && jobs.length === 6) {
    return due.some(([, item]) => item.timeliness === "delayed") ? "delayed" : "complete";
  }
  return "partial";
}

export function breadthProgressDetail(
  health: Pick<DailyJobHealth, "generatedAt" | "jobs" | "marketSession">,
): string {
  if (health.marketSession === false) return "中国市场休市，今日无盘中节点";
  const now = new Date(health.generatedAt).getTime();
  const jobs = Object.entries(health.jobs).filter(([key]) => key.startsWith("breadth-"));
  const captured = jobs.filter(([, item]) => item.status === "complete" || item.status === "partial");
  const outstanding = jobs.filter(([, item]) => item.status !== "complete" && item.status !== "partial");
  const pending = outstanding.filter(([, item]) => new Date(item.expectedAt).getTime() > now);
  const recovering = outstanding.filter(([, item]) => (
    new Date(item.expectedAt).getTime() <= now && !item.overdue && item.status !== "failed"
  ));
  const missing = outstanding.filter(([, item]) => item.overdue || item.status === "failed");
  const labels: string[] = [`已采集 ${captured.length}/6`];
  if (recovering.length > 0) labels.push(`补采中 ${recovering.map(([key]) => key.replace("breadth-", "")).join("、")}`);
  if (pending.length > 0) labels.push(`待采集 ${pending.length} 个节点`);
  if (missing.length > 0) labels.push(`缺失 ${missing.map(([key]) => key.replace("breadth-", "")).join("、")}`);
  return labels.join(" · ");
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
  const breadthCompleted = breadthJobs.filter(([, item]) => (
    item.status === "complete" || item.status === "partial"
  )).length;
  const close = health.jobs["close-review"];
  const closeStages = Object.entries(health.stages ?? {}).filter(([key]) => {
    const stage = key.replace("close-review:", "");
    return key.startsWith("close-review:") && isCloseReviewCoreStage(stage);
  });
  const closeStagesComplete = closeStages.filter(([, stage]) => stage.status === "complete").length;
  const newHighCloseStage = health.stages?.["close-review:new-highs"];
  const closePartialIsBackgroundOnly = closeStages.length > 0
    && closeStages.every(([, stage]) => stage.status === "complete")
    && Boolean(newHighCloseStage && newHighCloseStage.status !== "complete");
  const effectiveCompletedDue = completedDue + (
    closePartialIsBackgroundOnly
    && close?.status !== "complete"
    && dueJobs.some(([key]) => key === "close-review")
      ? 1
      : 0
  );
  const brief = health.jobs["morning-brief"];
  const etf = health.jobs["etf-metrics-refresh"];
  const etfHistory = health.stages?.["etf-metrics-refresh:history-metrics"];
  const failed = dueJobs.some(([, item]) => item.status === "failed");
  const running = dueJobs.some(([, item]) => item.status === "running");
  const partial = dueJobs.some(([key, item]) => (
    (item.status === "partial" && !(key === "close-review" && closePartialIsBackgroundOnly))
    || item.overdue
  ));
  const delayed = dueJobs.some(([, item]) => item.status === "complete" && item.timeliness === "delayed");
  // A weekend page reads the latest completed market review (usually Friday).
  // Its status must not turn the current closed day red; only today's due
  // jobs participate in the aggregate status on a non-trading day.
  const reviewAffectsStatus = marketSession && !closePartialIsBackgroundOnly;
  const overallStatus: SidebarProgressStatus = failed || (reviewAffectsStatus && reviewStatus === "failed")
    ? "failed"
    : running
      ? "running"
      : partial || (reviewAffectsStatus && (reviewStatus === "partial" || reviewStatus === "demo"))
        ? "partial"
        : delayed
          ? "delayed"
        : dueJobs.length > 0 && effectiveCompletedDue === dueJobs.length
          ? "complete"
          : "pending";
  const breadthStatus = aggregateBreadthStatus(breadthJobs, now, marketSession);
  const closeStatus = marketSession
    ? closePartialIsBackgroundOnly ? "complete" : normalizeJobStatus(close)
    : "closed";
  const briefStatus = normalizeJobStatus(brief);
  const etfStatus = marketSession ? normalizeJobStatus(etf) : "closed";
  const newHighStatus: SidebarProgressStatus = newHighProgress.complete
    ? "complete"
    : newHighProgress.completed > 0
      ? "running"
      : newHighProgress.failed > 0
        ? "partial"
      : "pending";
  const historyContribution = health.background?.historyContribution;
  const historyFieldDates = health.background?.historyFields?.dates ?? 0;
  const historyContributionStatus: SidebarProgressStatus = !historyContribution
    ? "pending"
    : historyContribution.coveragePct >= 95
      ? "complete"
      : historyContribution.completed > 0
        ? "running"
        : historyContribution.failed > 0
          ? "partial"
          : "pending";
  const fuyaoFields = Object.entries(health.fields ?? {})
    .filter(([key]) => key.startsWith("fuyao"));
  const fuyaoComplete = fuyaoFields.filter(([, item]) => item.status === "complete").length;
  const fuyaoFallback = fuyaoFields.filter(([, item]) => item.availability === "fallback").length;
  const fuyaoPermissionDenied = fuyaoFields.filter(([, item]) => item.availability === "permission-denied").length;
  const fuyaoStatus: SidebarProgressStatus = fuyaoFields.length === 0
    ? "pending"
    : fuyaoComplete === fuyaoFields.length
      ? "complete"
      : fuyaoComplete > 0 || fuyaoFields.some(([, item]) => item.status === "partial")
        ? "partial"
        : "failed";
  const fuyaoUpdatedAt = fuyaoFields
    .map(([, item]) => item.receivedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return {
    completedDue: effectiveCompletedDue,
    dueTotal: dueJobs.length,
    percentage: dueJobs.length === 0 ? 0 : Math.round(effectiveCompletedDue / dueJobs.length * 100),
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
        label: "一级资源 RSS + Fuyao",
        status: normalizeJobStatus(health.jobs["tier1-rss-prefetch"]),
        value: STATUS_VALUE[normalizeJobStatus(health.jobs["tier1-rss-prefetch"])],
        detail: health.jobs["tier1-rss-prefetch"]?.message || "等待 06:50",
        updatedAt: health.jobs["tier1-rss-prefetch"]?.finishedAt ?? null,
        nextRetryAt: health.jobs["tier1-rss-prefetch"]?.nextRetryAt ?? null,
      },
      {
        key: "tier2-firecrawl",
        label: "二级资讯 Firecrawl",
        status: normalizeJobStatus(health.jobs["tier2-news-prefetch"]),
        value: STATUS_VALUE[normalizeJobStatus(health.jobs["tier2-news-prefetch"])],
        detail: health.jobs["tier2-news-prefetch"]?.message || "等待 06:55",
        updatedAt: health.jobs["tier2-news-prefetch"]?.finishedAt ?? null,
        nextRetryAt: health.jobs["tier2-news-prefetch"]?.nextRetryAt ?? null,
      },
      {
        key: "fuyao",
        label: "扶摇结构化行情",
        status: fuyaoStatus,
        value: fuyaoFields.length > 0 ? `${fuyaoComplete}/${fuyaoFields.length}` : STATUS_VALUE[fuyaoStatus],
        detail: fuyaoFields.length > 0
          ? fuyaoFields.filter(([, item]) => item.status !== "complete").map(([, item]) => item.message).slice(0, 2).join("；")
            || (fuyaoFallback > 0
              ? `${fuyaoFallback} 项已由备用源完成`
              : fuyaoPermissionDenied > 0
                ? `${fuyaoPermissionDenied} 项接口无权限`
                : "行情、梯队、热点与龙虎榜已核验")
          : "等待收盘结构化采集",
        updatedAt: fuyaoUpdatedAt,
      },
      {
        key: "breadth",
        label: "盘中快照",
        status: breadthStatus,
        value: marketSession ? `${breadthCompleted}/6` : "非交易日",
        detail: breadthProgressDetail(health),
        updatedAt: latestFinishedAt(breadthJobs),
        nextRetryAt: breadthJobs
          .map(([, item]) => item.nextRetryAt)
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(0) ?? null,
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
        nextRetryAt: close?.nextRetryAt ?? null,
      },
      {
        key: "new-high",
        label: "新高初始化",
        status: newHighStatus,
        value: `${newHighProgress.completed}/${newHighProgress.target}`,
        detail: `覆盖 ${newHighProgress.coveragePct.toFixed(2)}%${newHighProgress.failed ? ` · 失败 ${newHighProgress.failed}` : ""}`,
        updatedAt: newHighProgress.updatedAt,
        nextRetryAt: health.jobs["new-high-bootstrap"]?.nextRetryAt ?? null,
      },
      {
        key: "history-contribution",
        label: "历史宽度与成交额",
        status: historyContributionStatus,
        value: historyContribution
          ? `${historyContribution.completed}/${historyContribution.target}`
          : "等待",
        detail: historyContribution
          ? `覆盖 ${historyContribution.coveragePct.toFixed(2)}% · 字段核验 ${historyFieldDates}/120 日${historyContribution.failed ? ` · 可重试失败 ${historyContribution.failed}` : ""}`
          : "达到95%后回写最近120个交易日",
        updatedAt: historyContribution?.updatedAt ?? null,
        nextRetryAt: health.jobs["new-high-bootstrap"]?.nextRetryAt ?? null,
      },
      {
        key: "morning-brief",
        label: "盘前早参",
        status: briefStatus,
        value: STATUS_VALUE[briefStatus],
        detail: brief?.message || "等待 07:15",
        updatedAt: brief?.finishedAt ?? null,
        nextRetryAt: brief?.nextRetryAt ?? null,
      },
      {
        key: "etf",
        label: "ETF 当日行情",
        status: etfStatus,
        value: marketSession ? STATUS_VALUE[etfStatus] : "不适用",
        detail: marketSession ? etf?.message || "等待 15:30" : "中国市场休市，等待下一个交易日",
        updatedAt: etf?.finishedAt ?? null,
        nextRetryAt: etf?.nextRetryAt ?? null,
      },
      {
        key: "etf-history",
        label: "ETF 历史指标",
        status: normalizeStatus(etfHistory?.status),
        value: STATUS_VALUE[normalizeStatus(etfHistory?.status)],
        detail: etfHistory?.message || "等待当日行情完成后后台初始化",
        updatedAt: etfHistory?.finishedAt ?? null,
        nextRetryAt: etfHistory?.nextRetryAt ?? null,
      },
    ],
  };
}
