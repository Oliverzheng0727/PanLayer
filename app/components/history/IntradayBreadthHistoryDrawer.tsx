"use client";

import { CalendarDays, LoaderCircle, Minimize2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IntradayBreadthTimeline } from "../../../lib/data/repository";
import { formatBeijingDateTime } from "../../../lib/live/market-clock";
import { BreadthAreaChart } from "./BreadthAreaChart";

interface BreadthHistoryPayload {
  timelines?: IntradayBreadthTimeline[];
  receivedAt?: string;
  error?: string;
}

function mergeTimelines(
  current: IntradayBreadthTimeline,
  historical: IntradayBreadthTimeline[],
) {
  const byDate = new Map(historical.map((timeline) => [timeline.date, timeline]));
  byDate.set(current.date, current);
  return [...byDate.values()]
    .filter((timeline) => timeline.snapshots.length > 0)
    .sort((left, right) => right.date.localeCompare(left.date));
}

function timelineStatus(timeline: IntradayBreadthTimeline) {
  if (timeline.meta.status === "complete") return "完整 6/6";
  if (timeline.meta.captured > 0) return `部分 ${timeline.meta.captured}/${timeline.meta.expected}`;
  return "暂无节点";
}

export function IntradayBreadthHistoryDrawer({
  current,
  onClose,
}: {
  current: IntradayBreadthTimeline;
  onClose: () => void;
}) {
  const [historical, setHistorical] = useState<IntradayBreadthTimeline[]>([]);
  const [receivedAt, setReceivedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const timelines = useMemo(
    () => mergeTimelines(current, historical),
    [current, historical],
  );
  const currentTimeline = timelines.find((timeline) => timeline.date === current.date)
    ?? timelines[0]
    ?? current;
  const previousTimelines = timelines.filter((timeline) => timeline.date !== currentTimeline.date);

  const handleClose = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKeyDown);

    void fetch("/api/v1/market/breadth-history?limit=60", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as BreadthHistoryPayload;
        if (!response.ok) throw new Error(payload.error ?? "历史盘中节点读取失败");
        setHistorical(payload.timelines ?? []);
        setReceivedAt(payload.receivedAt ?? null);
        setError("");
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "历史盘中节点读取失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [handleClose]);

  return (
    <div
      className="high-drawer-overlay intraday-history-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <aside
        className="high-drawer intraday-history-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="intraday-history-title"
      >
        <header className="high-drawer-header intraday-history-header">
          <div>
            <p>MARKET BREADTH · HISTORICAL SESSIONS</p>
            <h3 id="intraday-history-title">盘中涨跌家数历史</h3>
            <span>当前交易日大图 + 历史交易日小图列表，仅展示已经落库的真实节点。</span>
          </div>
          <div className="high-drawer-header-actions">
            <button
              type="button"
              className="high-drawer-icon"
              onClick={handleClose}
              aria-label="退出盘中涨跌历史全屏"
              title="退出全屏"
            >
              <Minimize2 size={17} />
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              className="high-drawer-icon"
              onClick={handleClose}
              aria-label="关闭盘中涨跌历史"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="intraday-history-body">
          <section className="intraday-history-current">
            <div className="intraday-history-section-head">
              <div>
                <span>{currentTimeline.date === current.date ? "当前交易日" : "最近有数据交易日"}</span>
                <h4>{currentTimeline.date}</h4>
              </div>
              <div>
                <strong>{timelineStatus(currentTimeline)}</strong>
                <span>{currentTimeline.meta.source || "来源暂缺"}</span>
              </div>
            </div>
            {currentTimeline.snapshots.length > 0 ? (
              <BreadthAreaChart
                points={currentTimeline.snapshots}
                height="clamp(360px, 48vh, 620px)"
                label={`${currentTimeline.date}盘中上涨与下跌家数折线图`}
              />
            ) : (
              <div className="intraday-history-empty">当前交易日盘中节点暂缺</div>
            )}
          </section>

          <section className="intraday-history-archive">
            <div className="intraday-history-archive-head">
              <div>
                <CalendarDays size={16} aria-hidden="true" />
                <div>
                  <h4>历史交易日</h4>
                  <span>按有数据的交易日倒序，可上下滚动比较。</span>
                </div>
              </div>
              <span>{previousTimelines.length} 个交易日</span>
            </div>

            {loading && (
              <div className="intraday-history-loading">
                <LoaderCircle size={16} className="animate-spin" />
                正在读取历史盘中节点
              </div>
            )}
            {!loading && error && previousTimelines.length === 0 && (
              <div className="intraday-history-empty">{error}</div>
            )}
            <div className="intraday-history-list">
              {previousTimelines.map((timeline) => (
                <article key={timeline.date} className="intraday-history-item">
                  <div className="intraday-history-item-meta">
                    <time dateTime={timeline.date}>{timeline.date}</time>
                    <strong>{timelineStatus(timeline)}</strong>
                    <span>{timeline.meta.source || "来源暂缺"}</span>
                    <span>
                      更新 {timeline.meta.updatedAt
                        ? formatBeijingDateTime(timeline.meta.updatedAt)
                        : "暂缺"}
                    </span>
                  </div>
                  <div className="intraday-history-item-chart">
                    <BreadthAreaChart
                      points={timeline.snapshots}
                      height={170}
                      compact
                      label={`${timeline.date}盘中上涨与下跌家数折线图`}
                    />
                  </div>
                </article>
              ))}
            </div>
            {!loading && !error && previousTimelines.length === 0 && (
              <div className="intraday-history-empty">暂时没有可验证的历史盘中节点</div>
            )}
          </section>
        </div>

        <footer className="high-drawer-footer">
          <span>红线：上涨家数 · 绿线：下跌家数</span>
          <span>{receivedAt ? `历史数据接收 ${formatBeijingDateTime(receivedAt)}` : "只展示落库数据，不补零"}</span>
        </footer>
      </aside>
    </div>
  );
}
