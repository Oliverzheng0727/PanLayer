"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import type { HistoryRow, HistorySortField, SortOrder } from "../../../lib/history/query";

const pct = (value: number | null) => value === null ? "暂缺" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

const columns: Array<{ field?: HistorySortField; label: string; className?: string }> = [
  { field: "date", label: "日期", className: "history-date" },
  { field: "rising", label: "上涨" }, { field: "falling", label: "下跌" }, { label: "平盘" },
  { field: "limitUp", label: "涨停" }, { field: "limitDown", label: "跌停" }, { label: "大涨股" },
  { field: "consecutive", label: "连板" }, { field: "maxStreak", label: "最高板" },
  { field: "openPremium", label: "连板开盘溢价" }, { field: "closePremium", label: "连板收盘溢价" },
  { field: "high120", label: "120日新高" }, { field: "allTimeHigh", label: "历史新高" },
  { label: "热点板块" }, { label: "状态" },
];

export function HistoryTable({ rows, selected, sort, order, onSelect, onSort, onNearEnd }: {
  rows: HistoryRow[];
  selected: string;
  sort: HistorySortField;
  order: SortOrder;
  onSelect: (date: string) => void;
  onSort: (field: HistorySortField) => void;
  onNearEnd: () => void;
}) {
  return (
    <div className="history-table-scroll" onScroll={(event) => {
      const element = event.currentTarget;
      if (element.scrollHeight - element.scrollTop - element.clientHeight < 90) onNearEnd();
    }}>
      <table className="history-table">
        <thead><tr>{columns.map((column) => <th key={column.label} className={column.className}>{column.field ? <button type="button" onClick={() => onSort(column.field!)} className={sort === column.field ? "is-sorted" : ""}>{column.label}{sort !== column.field ? <ChevronsUpDown size={11} /> : order === "desc" ? <ArrowDown size={11} /> : <ArrowUp size={11} />}</button> : column.label}</th>)}</tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.date} data-history-date={row.date} className={selected === row.date ? "selected" : ""} onClick={() => onSelect(row.date)}>
            <td className="history-date"><Link href={`/dashboard?date=${row.date}`} title={`查看 ${row.date} 完整复盘`}>{row.date}</Link></td>
            <td className="rise">{row.rising}</td><td className="fall">{row.falling}</td><td>{row.flat}</td>
            <td className="rise">{row.limitUp}</td><td className="fall">{row.limitDown}</td><td>{row.largeRise}</td>
            <td>{row.consecutive}</td><td>{row.maxStreak}板</td>
            <td className={(row.openPremium ?? 0) >= 0 ? "rise" : "fall"}>{pct(row.openPremium)}</td>
            <td className={(row.closePremium ?? 0) >= 0 ? "rise" : "fall"}>{pct(row.closePremium)}</td>
            <td>{row.high120 ?? "暂缺"}</td><td>{row.allTimeHigh ?? "暂缺"}</td>
            <td><span className="history-sector">{row.topSector}</span></td>
            <td><span className={`history-status ${row.status}`}>{row.status === "complete" ? "完整" : row.status === "partial" ? "部分" : row.status === "demo" ? "演示" : "失败"}</span></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
