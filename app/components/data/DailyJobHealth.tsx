import type { DailyJobHealth } from "../../../lib/data/repository";
import type { NewHighProgress } from "../../../lib/history/new-high-progress";
import { breadthProgressDetail } from "../../../lib/jobs/sidebar-progress";
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
  const closeStages = Object.entries(health.stages ?? {}).filter(([key]) =>
    key.startsWith("close-review:") && key !== "close-review:assemble"
  );
  const closeStagesComplete = closeStages.filter(([, stage]) => stage.status === "complete").length;
  const brief = health.jobs["morning-brief"];
  const briefLate = brief?.finishedAt
    ? new Date(brief.finishedAt).getTime() > new Date(brief.expectedAt).getTime() + 15 * 60_000
    : false;
  const briefRegenerated = briefLate && (brief?.attempt ?? 0) > 1;

  const items = [
    {
      label: "盘中快照",
      value: marketSession ? `${breadthComplete}/6` : "非交易日",
      detail: breadthProgressDetail(health),
    },
    {
      label: "收盘复盘",
      value: marketSession ? close ? statusLabel[close.status] : "等待" : "不适用",
      detail: !marketSession
        ? "中国市场休市，等待下一个交易日"
        : closeStages.length > 0
        ? `阶段 ${closeStagesComplete}/${closeStages.length} · ${close?.message || "自动补跑中"}`
        : close?.message || "等待 16:10",
    },
    {
      label: "新高初始化",
      value: `${newHighProgress.completed}/${newHighProgress.target}`,
      detail: `覆盖 ${newHighProgress.coveragePct.toFixed(2)}%${newHighProgress.failed ? ` · 失败 ${newHighProgress.failed}` : ""}`,
    },
    {
      label: "早参",
      value: brief ? statusLabel[brief.status] : "等待",
      detail: brief?.finishedAt
        ? `${clockTime(brief.finishedAt)}${briefRegenerated ? " · 重新生成" : briefLate ? " · 延迟" : " · 准时"}`
        : brief?.message || "等待 07:15",
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
