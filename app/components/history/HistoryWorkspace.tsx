"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Filter, Maximize2, Minimize2 } from "lucide-react";
import { HISTORY_SORT_FIELDS, queryHistoryRows, type HistoryRow, type HistorySortField, type SortOrder } from "../../../lib/history/query";
import { formatNewHighProgress, type NewHighProgress } from "../../../lib/history/new-high-progress";
import { HistoryCalendar } from "./HistoryCalendar";
import { HistoryTable } from "./HistoryTable";
import { MarketEvidenceDrawer, type MarketEvidenceKind } from "./MarketEvidenceDrawer";

const HISTORY_VIEW_KEY = "panlayer-history-view";

interface StoredHistoryView {
  sort?: HistorySortField;
  order?: SortOrder;
  sector?: string;
  selected?: string;
  visibleCount?: number;
  scrollTop?: number;
  scrollLeft?: number;
  calendarCollapsed?: boolean;
}

interface HistoryWorkspaceProps {
  initialRows?: HistoryRow[];
  initialNewHighProgress: NewHighProgress;
  onSelectedRowChange?: (row: HistoryRow) => void;
  onNewHighProgressChange?: (progress: NewHighProgress) => void;
}

export interface HistoryWorkspaceHandle {
  selectDate: (date: string) => void;
}

export const HistoryWorkspace = forwardRef<HistoryWorkspaceHandle, HistoryWorkspaceProps>(function HistoryWorkspace({ initialRows = [], initialNewHighProgress, onSelectedRowChange, onNewHighProgressChange }, ref) {
  const [sort, setSort] = useState<HistorySortField>("date");
  const [order, setOrder] = useState<SortOrder>("desc");
  const [sector, setSector] = useState("");
  const [selected, setSelected] = useState(initialRows[0]?.date ?? "");
  const [visibleCount, setVisibleCount] = useState(12);
  const [evidenceDrawer, setEvidenceDrawer] = useState<{ row: HistoryRow; kind: MarketEvidenceKind } | null>(null);
  const [newHighProgress, setNewHighProgress] = useState(initialNewHighProgress);
  const [restored, setRestored] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [calendarCollapsed, setCalendarCollapsed] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef({ top: 0, left: 0 });

  const sorted = useMemo(() => queryHistoryRows(initialRows, {
    sort,
    order,
    sector,
    cursor: 0,
    limit: Math.max(1, initialRows.length),
  }).items, [initialRows, order, sector, sort]);
  const visible = sorted.slice(0, visibleCount);
  const strictRecognitionStart = useMemo(() => initialRows
    .filter((row) => row.recognitionRanking?.schemaVersion === 2)
    .map((row) => row.date)
    .toSorted()
    .at(0) ?? null, [initialRows]);

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
      if (typeof stored.calendarCollapsed === "boolean") setCalendarCollapsed(stored.calendarCollapsed);
      if (stored.selected) {
        const restoredRow = initialRows.find((row) => row.date === stored.selected);
        if (restoredRow) {
          setSelected(restoredRow.date);
          onSelectedRowChange?.(restoredRow);
        }
      }
      if (Number.isInteger(stored.visibleCount)) setVisibleCount(Math.min(2_000, Math.max(12, stored.visibleCount!)));
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
  }, [initialRows, onSelectedRowChange]);

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
      calendarCollapsed,
    } satisfies StoredHistoryView));
  }, [calendarCollapsed, order, restored, sector, selected, sort, visibleCount]);

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isFullscreen]);

  const refreshNewHighProgress = useCallback(async () => {
    const response = await fetch("/api/v1/new-high/progress", { cache: "no-store" });
    if (!response.ok) return;
    const progress = await response.json() as NewHighProgress;
    setNewHighProgress(progress);
    onNewHighProgressChange?.(progress);
  }, [onNewHighProgressChange]);

  useEffect(() => {
    if (newHighProgress.complete) return;
    const initial = window.setTimeout(() => void refreshNewHighProgress(), 0);
    const interval = window.setInterval(() => void refreshNewHighProgress(), 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [newHighProgress.complete, refreshNewHighProgress]);

  const cycleSort = (field: HistorySortField) => {
    setVisibleCount(12);
    if (sort !== field) { setSort(field); setOrder("desc"); return; }
    if (order === "desc") { setOrder("asc"); return; }
    setSort("date"); setOrder("desc");
  };

  const selectDate = useCallback((date: string) => {
    setSelected(date);
    const row = initialRows.find((item) => item.date === date);
    if (row) onSelectedRowChange?.(row);
    let index = sorted.findIndex((row) => row.date === date);
    if (index < 0 && sector) {
      setSector("");
      index = queryHistoryRows(initialRows, {
        sort,
        order,
        sector: "",
        cursor: 0,
        limit: Math.max(1, initialRows.length),
      }).items.findIndex((item) => item.date === date);
    }
    if (index >= visibleCount) setVisibleCount(index + 1);
    requestAnimationFrame(() => document.querySelector(`[data-history-date="${date}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [initialRows, onSelectedRowChange, order, sector, sort, sorted, visibleCount]);

  useImperativeHandle(ref, () => ({ selectDate }), [selectDate]);

  return (
    <div className={`history-workspace panel ${isFullscreen ? "is-fullscreen" : ""}`}>
      <div className="history-toolbar">
        <button
          type="button"
          className="history-fullscreen-toggle"
          onClick={() => setIsFullscreen((current) => !current)}
          aria-label={isFullscreen ? "退出历史数据全屏" : "放大历史数据表"}
          aria-expanded={isFullscreen}
          title={isFullscreen ? "退出全屏（Esc）" : "全屏查看历史数据"}
        >
          {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <div><strong>历史数据表</strong><span>当前查看 {selected || "暂无记录"} · 固定表头与日期列{strictRecognitionStart ? ` · 辨识度新口径始于 ${strictRecognitionStart}` : ""}</span></div>
        <label><Filter size={13} /><input value={sector} onChange={(event) => { setSector(event.target.value); setVisibleCount(12); }} placeholder="筛选热点板块" /></label>
        <span className={`new-high-progress ${newHighProgress.ready ? "ready" : ""}`}>{formatNewHighProgress(newHighProgress)}</span>
        <span className="history-count">已显示 {Math.min(visible.length, sorted.length)} / {sorted.length}</span>
      </div>
      <div className={`history-layout ${calendarCollapsed ? "calendar-collapsed" : ""}`}>
        <HistoryCalendar
          key={selected.slice(0, 7)}
          dates={initialRows.map((row) => row.date)}
          selected={selected}
          collapsed={calendarCollapsed}
          onSelect={selectDate}
          onToggle={() => setCalendarCollapsed((current) => !current)}
        />
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
              sort, order, sector, selected, visibleCount, scrollTop: top, scrollLeft: left, calendarCollapsed,
            } satisfies StoredHistoryView));
          }}
          onOpenEvidence={(row, kind) => setEvidenceDrawer({ row, kind })}
        />
      </div>
      {evidenceDrawer && <MarketEvidenceDrawer row={evidenceDrawer.row} kind={evidenceDrawer.kind} onClose={() => setEvidenceDrawer(null)} />}
    </div>
  );
});
