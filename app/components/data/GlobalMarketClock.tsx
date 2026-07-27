"use client";

import { useEffect, useState } from "react";
import { delayMinutes, formatBeijingClock, nextRefreshSeconds } from "../../../lib/live/market-clock";
import { beijingMarketPhase } from "../../../lib/live/refresh-policy";
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
  marketSession = true,
  error = "",
}: {
  source: string;
  status: LiveDataState;
  marketTime: string | null;
  receivedAt: string | null;
  marketSession?: boolean;
  error?: string;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => setNow(new Date()), 0);
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  const failed = status === "failed" || Boolean(error);
  const delayedBy = now ? delayMinutes(receivedAt, now) : null;
  const phase = now ? beijingMarketPhase(now, marketSession) : "preopen";
  const inSession = phase === "morning" || phase === "afternoon";
  const delayed = failed || (marketSession && inSession && delayedBy !== null && delayedBy > 5);
  const seconds = now ? nextRefreshSeconds(receivedAt, now) : 0;
  const statusLabel = failed
    ? "更新失败 · 旧数据"
    : phase === "non-trading"
      ? "最近交易日数据"
    : phase === "closed"
      ? `最新收盘数据 · ${marketClock(marketTime)}`
    : phase === "lunch"
      ? "午间休市 · 等待下午开盘"
    : phase === "preopen"
      ? "盘前 · 等待开盘"
    : delayed
      ? `数据已延迟 ${delayedBy} 分钟`
      : status === "complete"
        ? "完整"
        : status === "demo"
          ? "演示"
          : "部分";
  const refreshLabel = now === null
    ? "同步中"
    : phase === "non-trading"
      ? "非交易日"
    : inSession
    ? seconds > 0 ? `下次刷新 ${countdown(seconds)}` : "正在刷新"
    : phase === "lunch"
      ? "午间休市"
      : phase === "preopen" ? "盘前" : "已收盘";

  return (
    <div className={`global-market-clock ${delayed ? "is-delayed" : ""}`}>
      <span className="global-clock-now" aria-hidden="true"><em>北京时间</em>{now ? formatBeijingClock(now) : "--:--:--"}</span>
      <span><em>市场数据</em>{marketClock(marketTime)}</span>
      <span><em>数据源</em>{source}</span>
      <span className="global-clock-status" aria-live="polite">{statusLabel}</span>
      <span>{refreshLabel}</span>
    </div>
  );
}
