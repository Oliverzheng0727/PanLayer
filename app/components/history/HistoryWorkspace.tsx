"use client";

import { useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { queryHistoryRows, type HistoryRow, type HistorySortField, type SortOrder } from "../../../lib/history/query";
import { HistoryCalendar } from "./HistoryCalendar";
import { HistoryTable } from "./HistoryTable";
import { HighDetailDrawer } from "./HighDetailDrawer";
import type { HighDetail, HighDetailType } from "../../../lib/history/high-details";

export function HistoryWorkspace({ initialRows = [], highDetailsByDate = {} }: { initialRows?: HistoryRow[]; highDetailsByDate?: Record<string, HighDetail[]> }) {
  const [sort, setSort] = useState<HistorySortField>("date");
  const [order, setOrder] = useState<SortOrder>("desc");
  const [sector, setSector] = useState("");
  const [selected, setSelected] = useState(initialRows[0]?.date ?? "");
  const [visibleCount, setVisibleCount] = useState(12);
  const [drawer, setDrawer] = useState<{ date: string; type: HighDetailType } | null>(null);

  const sorted = useMemo(() => queryHistoryRows(initialRows, { sort, order, sector, cursor: 0, limit: 100 }).items, [initialRows, order, sector, sort]);
  const visible = sorted.slice(0, visibleCount);

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

  return (
    <div className="history-workspace panel">
      <div className="history-toolbar">
        <div><strong>历史数据表</strong><span>固定表头与日期列 · 默认显示 12 个交易日</span></div>
        <label><Filter size={13} /><input value={sector} onChange={(event) => { setSector(event.target.value); setVisibleCount(12); }} placeholder="筛选热点板块" /></label>
        <span className="history-count">已显示 {Math.min(visible.length, sorted.length)} / {sorted.length}</span>
      </div>
      <div className="history-layout">
        <HistoryCalendar key={selected.slice(0, 7)} dates={initialRows.map((row) => row.date)} selected={selected} onSelect={selectDate} />
        <HistoryTable rows={visible} selected={selected} sort={sort} order={order} onSelect={selectDate} onSort={cycleSort} onNearEnd={() => setVisibleCount((count) => Math.min(sorted.length, count + 10))} onOpenHighs={(date, type) => setDrawer({ date, type })} />
      </div>
      {drawer && <HighDetailDrawer date={drawer.date} type={drawer.type} items={highDetailsByDate[drawer.date] ?? []} onTypeChange={(type) => setDrawer({ ...drawer, type })} onClose={() => setDrawer(null)} />}
    </div>
  );
}
