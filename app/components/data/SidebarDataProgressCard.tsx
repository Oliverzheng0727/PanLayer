"use client";

import { ChevronDown, Database } from "lucide-react";
import { useMemo, useState } from "react";
import type { DailyJobHealth } from "../../../lib/data/repository";
import type { DailyReview } from "../../../lib/domain/types";
import type { NewHighProgress } from "../../../lib/history/new-high-progress";
import {
  buildSidebarProgress,
  type SidebarProgressStatus,
} from "../../../lib/jobs/sidebar-progress";
import { formatBeijingDateTime } from "../../../lib/live/market-clock";

const statusView: Record<SidebarProgressStatus, {
  label: string;
  dot: string;
  text: string;
}> = {
  pending: {
    label: "等待",
    dot: "bg-white/35",
    text: "text-white/45",
  },
  running: {
    label: "更新中",
    dot: "bg-sky-400 shadow-[0_0_8px_#38bdf8] animate-pulse",
    text: "text-sky-300",
  },
  partial: {
    label: "部分",
    dot: "bg-amber-400 shadow-[0_0_8px_#f59e0b]",
    text: "text-amber-300",
  },
  delayed: {
    label: "延迟",
    dot: "bg-amber-300 shadow-[0_0_8px_#fcd34d]",
    text: "text-amber-200",
  },
  complete: {
    label: "完整",
    dot: "bg-emerald-400 shadow-[0_0_8px_#34d399]",
    text: "text-emerald-300",
  },
  failed: {
    label: "失败",
    dot: "bg-red-400 shadow-[0_0_8px_#f87171]",
    text: "text-red-300",
  },
  closed: {
    label: "休市",
    dot: "bg-white/25",
    text: "text-white/40",
  },
};

export function SidebarDataProgressCard({
  health,
  newHighProgress,
  reviewStatus,
  source,
  updatedAt,
}: {
  health: DailyJobHealth;
  newHighProgress: NewHighProgress;
  reviewStatus: DailyReview["status"];
  source: string;
  updatedAt: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const model = useMemo(
    () => buildSidebarProgress(health, newHighProgress, reviewStatus),
    [health, newHighProgress, reviewStatus],
  );
  const current = statusView[model.overallStatus];
  const automaticCompletedAt = Object.values(health.jobs)
    .flatMap((job) => job.lastAutomaticCompletedAt ? [job.lastAutomaticCompletedAt] : [])
    .sort()
    .at(-1) ?? null;
  const manualCompletedAt = Object.values(health.jobs)
    .flatMap((job) => job.lastManualCompletedAt ? [job.lastManualCompletedAt] : [])
    .sort()
    .at(-1) ?? null;
  const dueProgress = model.dueTotal === 0
    ? "尚未开始"
    : `${model.completedDue}/${model.dueTotal}`;

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-4">
      <button
        type="button"
        className="w-full text-left"
        aria-expanded={expanded}
        aria-controls="sidebar-data-progress-details"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-xs text-white/45">
            <Database size={14} />
            数据状态
          </span>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={`text-white/35 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </span>
        <span className="mt-2 flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-2">
            <span className={`size-1.5 rounded-full ${current.dot}`} />
            <strong className={current.text}>{current.label}</strong>
          </span>
          <span className="text-white/50">
            任务进度 {dueProgress}
          </span>
        </span>
        <span
          className="mt-2 block h-1 overflow-hidden rounded-full bg-white/[0.07]"
          role="progressbar"
          aria-label="当日到期任务完成进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={model.percentage}
        >
          <span
            className="block h-full rounded-full bg-[#e8702a] transition-[width]"
            style={{ width: `${model.percentage}%` }}
          />
        </span>
        <span className="mt-2 flex items-center justify-between gap-2 text-[10px] text-white/35">
          <span>{model.marketSession ? `盘中 ${model.breadthCompleted}/${model.breadthExpected}` : "盘中 非交易日"}</span>
          <span>
            新高历史 {model.newHighCompleted}/{model.newHighTarget}
            {model.newHighTarget > 0 ? ` · ${model.newHighCoveragePct.toFixed(1)}%` : ""}
          </span>
        </span>
        <span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-white/30">
          <span>今日新高刷新</span>
          <span>
            {model.newHighDailyCompleted}/{model.newHighTarget}
            {model.newHighTarget > 0 ? ` · ${model.newHighDailyCoveragePct.toFixed(1)}%` : ""}
          </span>
        </span>
        <span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-white/30">
          <span>调度心跳{health.heartbeat?.provider ? ` · ${health.heartbeat.provider}` : ""}</span>
          <span className={health.heartbeat?.status === "failed" ? "text-red-300" : health.heartbeat?.status === "running" ? "text-sky-300" : health.heartbeat?.status === "partial" ? "text-amber-300" : "text-emerald-300"}>
            {health.heartbeat
              ? `${health.heartbeat.stale ? "过期" : health.heartbeat.status === "running" ? "运行中" : health.heartbeat.status === "failed" ? "异常" : health.heartbeat.status === "partial" ? "部分任务待补跑" : "正常"} · ${formatBeijingDateTime(health.heartbeat.receivedAt)}`
              : "尚未收到"}
          </span>
        </span>
        <span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-white/30">
          <span>当前交易日</span>
          <span>{health.tradeDate} · {formatBeijingDateTime(health.generatedAt)}</span>
        </span>
        {health.latestCompletedTradeDate && <span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-white/30">
          <span>最新完整复盘</span>
          <span>{health.latestCompletedTradeDate}</span>
        </span>}
        <span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-white/30">
          <span>最近自动完成</span>
          <span>{automaticCompletedAt ? formatBeijingDateTime(automaticCompletedAt) : "尚无记录"}</span>
        </span>
        {manualCompletedAt && <span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-white/30">
          <span>最近手动重跑</span>
          <span>{formatBeijingDateTime(manualCompletedAt)}</span>
        </span>}
      </button>

      <div
        id="sidebar-data-progress-details"
        aria-hidden={!expanded}
        className={`grid transition-[grid-template-rows,margin] duration-200 ${
          expanded ? "mt-3 grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="max-h-52 space-y-2 overflow-y-auto border-t border-white/[0.06] pt-3">
            {model.tasks.map((task) => {
              const view = statusView[task.status];
              const checkpointKey = task.key === "tier1-rss"
                ? "tier1-rss-prefetch"
                : task.key === "tier2-firecrawl"
                  ? "tier2-news-prefetch"
                  : task.key === "morning-brief"
                    ? "morning-brief"
                    : task.key === "close-review"
                      ? "close-review"
                      : task.key === "etf"
                        ? "etf-metrics-refresh"
                        : null;
              const executionTrigger = checkpointKey ? health.jobs[checkpointKey]?.trigger : null;
              const taskTime = task.updatedAt
                ? formatBeijingDateTime(task.updatedAt)
                : null;
              return (
                <div key={task.key} className="rounded-xl bg-black/20 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="flex items-center gap-1.5 text-white/45">
                      <span className={`size-1 rounded-full ${view.dot}`} />
                      {task.label}
                    </span>
                    <span className="flex items-center gap-1.5">
                      {executionTrigger && (
                        <small className="rounded bg-white/[0.05] px-1 py-0.5 text-[8px] text-white/30">
                          {executionTrigger === "manual"
                            ? "手动"
                            : executionTrigger === "reconcile" ? "补跑" : "自动"}
                        </small>
                      )}
                      <strong className={view.text}>{task.value}</strong>
                    </span>
                  </div>
                  <p
                    className="mt-1 truncate text-[9px] text-white/25"
                    title={`${task.detail}${taskTime ? ` · ${taskTime}` : ""}`}
                  >
                    {task.detail}
                    {taskTime ? ` · ${taskTime}` : ""}
                  </p>
                  {task.nextRetryAt && (
                    <p className="mt-1 text-[9px] text-amber-200/45">
                      下次自动重试 {formatBeijingDateTime(task.nextRetryAt)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-2 text-[10px] leading-5 text-white/35">
        数据来源：{source}
      </p>
      <p className="text-[10px] leading-5 text-white/25">
        更新时间：{formatBeijingDateTime(updatedAt)}
      </p>
    </section>
  );
}
