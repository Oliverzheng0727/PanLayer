import type { DailyJobHealth } from "../../../lib/data/repository";
import type { NewHighProgress } from "../../../lib/history/new-high-progress";
import { breadthProgressDetail } from "../../../lib/jobs/sidebar-progress";
import { isCloseReviewCoreStage } from "../../../lib/jobs/close-review-stages";
import { clockTime } from "./LiveDataStatus";

const statusLabel = {
  pending: "等待",
  running: "执行中",
  partial: "部分",
  complete: "完成",
  failed: "失败",
} as const;

export function DailyJobHealthPanel({
  health,
  newHighProgress,
}: {
  health: DailyJobHealth;
  newHighProgress: NewHighProgress;
}) {
  const marketSession = health.marketSession ?? true;
  const breadthJobs = Object.entries(health.jobs).filter(([key]) => key.startsWith("breadth-"));
  const breadthComplete = breadthJobs.filter(([, job]) => (
    job.status === "complete" || job.status === "partial"
  )).length;
  const close = health.jobs["close-review"];
  const closeStages = Object.entries(health.stages ?? {}).filter(([key]) => {
    const stage = key.replace("close-review:", "");
    return key.startsWith("close-review:") && isCloseReviewCoreStage(stage);
  });
  const closeStagesComplete = closeStages.filter(([, stage]) => stage.status === "complete").length;
  const newHighCloseStage = health.stages?.["close-review:new-highs"];
  const closeBackgroundOnly = closeStages.length > 0
    && closeStages.every(([, stage]) => stage.status === "complete")
    && Boolean(newHighCloseStage && newHighCloseStage.status !== "complete");
  const brief = health.jobs["morning-brief"];
  const automaticBriefTime = brief?.lastAutomaticCompletedAt ?? (
    brief?.trigger === "cron" || brief?.trigger === "reconcile" ? brief.finishedAt : null
  );
  const manualBriefTime = brief?.lastManualCompletedAt ?? (
    brief?.trigger === "manual" ? brief.finishedAt : null
  );
  const legacyBriefLate = !brief?.trigger && brief?.finishedAt
    ? new Date(brief.finishedAt).getTime() > new Date(brief.expectedAt).getTime() + 15 * 60_000
    : false;
  const briefLate = automaticBriefTime
    ? new Date(automaticBriefTime).getTime() > new Date(brief.expectedAt).getTime() + 15 * 60_000
    : legacyBriefLate;
  const legacyRegenerated = !brief?.trigger && briefLate && (brief?.attempt ?? 0) > 1;
  const briefDetail = automaticBriefTime
    ? `${clockTime(automaticBriefTime)} · 自动${briefLate ? "延迟" : "准时"}${manualBriefTime ? ` · 最近手动 ${clockTime(manualBriefTime)}` : ""}`
    : manualBriefTime
      ? `${clockTime(manualBriefTime)} · 手动重跑 · 尚无自动完成记录`
      : brief?.finishedAt
        ? `${clockTime(brief.finishedAt)}${legacyRegenerated ? " · 重新生成" : briefLate ? " · 延迟" : " · 准时"}`
        : brief?.message || "等待 07:15";

  const items = [
    {
      label: "盘中快照",
      value: marketSession ? `${breadthComplete}/6` : "非交易日",
      detail: breadthProgressDetail(health),
    },
    {
      label: "收盘复盘",
      value: marketSession
        ? closeBackgroundOnly ? "完成" : close ? statusLabel[close.status] : "等待"
        : "不适用",
      detail: !marketSession
        ? "中国市场休市，等待下一个交易日"
        : closeStages.length > 0
        ? `核心阶段 ${closeStagesComplete}/${closeStages.length} · ${
          closeBackgroundOnly ? "新高由后台独立初始化" : close?.message || "自动补跑中"
        }`
        : close?.message || "等待 16:10",
    },
    {
      label: "新高历史基线",
      value: `${newHighProgress.completed}/${newHighProgress.target}`,
      detail: `历史覆盖 ${newHighProgress.coveragePct.toFixed(2)}% · 今日刷新 ${newHighProgress.dailyCompleted ?? newHighProgress.completed}/${newHighProgress.target}` +
        `${newHighProgress.failed ? ` · 失败 ${newHighProgress.failed}` : ""}`,
    },
    {
      label: "早参",
      value: brief ? statusLabel[brief.status] : "等待",
      detail: briefDetail,
    },
  ];

  return (
    <div className="mb-7 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="每日数据任务状态">
      {items.map((item) => (
        <div key={item.label} className="rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-3">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-white/40">{item.label}</span>
            <strong className="text-white/75">{item.value}</strong>
          </div>
          <p className="mt-1 truncate text-[10px] text-white/25" title={item.detail}>{item.detail}</p>
        </div>
      ))}
    </div>
  );
}
