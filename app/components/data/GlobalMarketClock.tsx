"use client";

import { useEffect, useState } from "react";
import { delayMinutes, formatBeijingClock, nextRefreshSeconds } from "../../../lib/live/market-clock";
import { isBeijingMarketSession } from "../../../lib/live/refresh-policy";
import type { LiveDataState } from "./LiveDataStatus";

function countdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function marketClock(value: string | null): string {
  if (!value) return "暂缺";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? formatBeijingClock(parsed) : value;
}

export function GlobalMarketClock({
  source,
  status,
  marketTime,
  receivedAt,
  error = "",
}: {
  source: string;
  status: LiveDataState;
  marketTime: string | null;
  receivedAt: string | null;
  error?: string;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const failed = status === "failed" || Boolean(error);
  const delayedBy = delayMinutes(receivedAt, now);
  const delayed = failed || (delayedBy !== null && delayedBy > 5);
  const inSession = isBeijingMarketSession(now);
  const seconds = nextRefreshSeconds(receivedAt, now);
  const statusLabel = failed
    ? "更新失败 · 旧数据"
    : delayed
      ? `数据已延迟 ${delayedBy} 分钟`
      : status === "complete"
        ? "完整"
        : status === "demo"
          ? "演示"
          : "部分";
  const refreshLabel = inSession
    ? seconds > 0 ? `下次刷新 ${countdown(seconds)}` : "正在刷新"
    : "已收盘";

  return (
    <div className={`global-market-clock ${delayed ? "is-delayed" : ""}`}>
      <span className="global-clock-now" aria-hidden="true"><em>北京时间</em>{formatBeijingClock(now)}</span>
      <span><em>市场数据</em>{marketClock(marketTime)}</span>
      <span><em>数据源</em>{source}</span>
      <span className="global-clock-status" aria-live="polite">{statusLabel}</span>
      <span>{refreshLabel}</span>
    </div>
  );
}
