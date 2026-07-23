"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DatabaseZap, Filter, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { HISTORY_SORT_FIELDS, queryHistoryRows, type HistoryRow, type HistorySortField, type SortOrder } from "../../../lib/history/query";
import { HistoryCalendar } from "./HistoryCalendar";
import { HistoryTable } from "./HistoryTable";
import { HighDetailDrawer } from "./HighDetailDrawer";
import type { HighDetail, HighDetailType } from "../../../lib/history/high-details";

const HISTORY_VIEW_KEY = "panlayer-history-view";

interface StoredHistoryView {
  sort?: HistorySortField;
  order?: SortOrder;
  sector?: string;
  selected?: string;
  visibleCount?: number;
  scrollTop?: number;
  scrollLeft?: number;
}

export function HistoryWorkspace({ initialRows = [], highDetailsByDate = {}, canManageHistory = false }: { initialRows?: HistoryRow[]; highDetailsByDate?: Record<string, HighDetail[]>; canManageHistory?: boolean }) {
  const router = useRouter();
  const [sort, setSort] = useState<HistorySortField>("date");
  const [order, setOrder] = useState<SortOrder>("desc");
  const [sector, setSector] = useState("");
  const [selected, setSelected] = useState(initialRows[0]?.date ?? "");
  const [visibleCount, setVisibleCount] = useState(12);
  const [drawer, setDrawer] = useState<{ date: string; type: HighDetailType } | null>(null);
  const [backfillState, setBackfillState] = useState<"idle" | "running" | "complete" | "failed">("idle");
  const [backfillLabel, setBackfillLabel] = useState("回补近20日");
  const [restored, setRestored] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef({ top: 0, left: 0 });

  const sorted = useMemo(() => queryHistoryRows(initialRows, { sort, order, sector, cursor: 0, limit: 100 }).items, [initialRows, order, sector, sort]);
  const visible = sorted.slice(0, visibleCount);

  useEffect(() => {
    let stored: StoredHistoryView = {};
    try {
      stored = JSON.parse(sessionStorage.getItem(HISTORY_VIEW_KEY) ?? "{}") as StoredHistoryView;
    } catch {
      sessionStorage.removeItem(HISTORY_VIEW_KEY);
    }
    const frame = requestAnimationFrame(() => {
      if (stored.sort && HISTORY_SORT_FIELDS.includes(stored.sort)) setSort(stored.sort);
      if (stored.order === "asc" || stored.order === "desc") setOrder(stored.order);
      if (typeof stored.sector === "string") setSector(stored.sector);
      if (stored.selected && initialRows.some((row) => row.date === stored.selected)) setSelected(stored.selected);
      if (Number.isInteger(stored.visibleCount)) setVisibleCount(Math.min(100, Math.max(12, stored.visibleCount!)));
      scrollPosition.current = {
        top: typeof stored.scrollTop === "number" ? stored.scrollTop : 0,
        left: typeof stored.scrollLeft === "number" ? stored.scrollLeft : 0,
      };
      requestAnimationFrame(() => {
        tableScrollRef.current?.scrollTo(scrollPosition.current);
      });
      setRestored(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [initialRows]);

  useEffect(() => {
    if (!restored) return;
    sessionStorage.setItem(HISTORY_VIEW_KEY, JSON.stringify({
      sort,
      order,
      sector,
      selected,
      visibleCount,
      scrollTop: scrollPosition.current.top,
      scrollLeft: scrollPosition.current.left,
    } satisfies StoredHistoryView));
  }, [order, restored, sector, selected, sort, visibleCount]);

  const cycleSort = (field: HistorySortField) => {
    setVisibleCount(12);
    if (sort !== field) { setSort(field); setOrder("desc"); return; }
    if (order === "desc") { setOrder("asc"); return; }
    setSort("date"); setOrder("desc");
  };

  const selectDate = (date: string) => {
    setSelected(date);
    const index = sorted.findIndex((row) => row.date === date);
    if (index >= visibleCount) setVisibleCount(index + 1);
    requestAnimationFrame(() => document.querySelector(`[data-history-date="${date}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };

  const backfillHistory = async () => {
    if (backfillState === "running") return;
    setBackfillState("running");
    setBackfillLabel("准备回补…");
    let previousRemaining = Number.POSITIVE_INFINITY;
    let stalledRuns = 0;
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const response = await fetch("/api/v1/admin/jobs/history-backfill/run?days=20", { method: "POST" });
        const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
        if (!response.ok) throw new Error(payload.error ?? "历史回补失败");
        const message = payload.message ?? "";
        const progress = message.match(/history-backfill\s+(\d+)\/(\d+);\s+remaining\s+(\d+)/);
        if (!progress) throw new Error("历史回补未返回有效进度");
        const completed = Number(progress[1]);
        const target = Number(progress[2]);
        const remaining = Number(progress[3]);
        setBackfillLabel(`回补 ${completed}/${target}`);
        if (remaining === 0) {
          setBackfillState("complete");
          setBackfillLabel("回补完成");
          router.refresh();
          return;
        }
        stalledRuns = remaining >= previousRemaining ? stalledRuns + 1 : 0;
        if (stalledRuns >= 2) throw new Error("部分交易日数据源暂不可用，可稍后继续回补");
        previousRemaining = remaining;
      }
      throw new Error("回补尚未完成，可再次继续");
    } catch (error) {
      setBackfillState("failed");
      setBackfillLabel(error instanceof Error ? error.message : "历史回补失败");
    }
  };

  return (
    <div className="history-workspace panel">
      <div className="history-toolbar">
        <div><strong>历史数据表</strong><span>固定表头与日期列 · 默认显示 12 个交易日</span></div>
        <label><Filter size={13} /><input value={sector} onChange={(event) => { setSector(event.target.value); setVisibleCount(12); }} placeholder="筛选热点板块" /></label>
        {canManageHistory && <button type="button" className={`history-backfill ${backfillState}`} onClick={backfillHistory} disabled={backfillState === "running"} title={backfillState === "failed" ? backfillLabel : undefined}>{backfillState === "running" ? <LoaderCircle size={13} className="animate-spin" /> : <DatabaseZap size={13} />}{backfillLabel}</button>}
        <span className="history-count">已显示 {Math.min(visible.length, sorted.length)} / {sorted.length}</span>
      </div>
      <div className="history-layout">
        <HistoryCalendar key={selected.slice(0, 7)} dates={initialRows.map((row) => row.date)} selected={selected} onSelect={selectDate} />
        <HistoryTable
          rows={visible}
          selected={selected}
          sort={sort}
          order={order}
          scrollRef={tableScrollRef}
          onSelect={selectDate}
          onSort={cycleSort}
          onNearEnd={() => setVisibleCount((count) => Math.min(sorted.length, count + 10))}
          onScrollPosition={(top, left) => {
            scrollPosition.current = { top, left };
            if (!restored) return;
            sessionStorage.setItem(HISTORY_VIEW_KEY, JSON.stringify({
              sort, order, sector, selected, visibleCount, scrollTop: top, scrollLeft: left,
            } satisfies StoredHistoryView));
          }}
          onOpenHighs={(date, type) => setDrawer({ date, type })}
        />
      </div>
      {drawer && <HighDetailDrawer date={drawer.date} type={drawer.type} items={highDetailsByDate[drawer.date] ?? []} onTypeChange={(type) => setDrawer({ ...drawer, type })} onClose={() => setDrawer(null)} />}
    </div>
  );
}
