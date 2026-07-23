"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import type { RefObject } from "react";
import type { HistoryRow, HistorySortField, SortOrder } from "../../../lib/history/query";
import type { HighDetailType } from "../../../lib/history/high-details";

const pct = (value: number | null) => value === null ? "暂缺" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const count = (value: number | null) => value === null ? "暂缺" : value.toLocaleString("zh-CN");
const ratio = (value: number | null) => value === null ? "暂缺" : value.toFixed(2);
const money = (value: number | null) => value === null ? "暂缺" : `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}亿`;
const tone = (value: number | null) => value === null ? "" : value >= 0 ? "rise" : "fall";
const updatedTime = (value: string) => {
  const normalized = value.replace("T", " ");
  return normalized.length >= 16 ? `${normalized.slice(5, 10)} ${normalized.slice(11, 16)}` : value;
};

const columns: Array<{ field?: HistorySortField; label: string; className?: string }> = [
  { field: "date", label: "日期", className: "history-date" },
  { label: "热点板块", className: "history-sector-cell" },
  { field: "rising", label: "上涨" }, { field: "falling", label: "下跌" }, { label: "平盘" },
  { field: "riseFallRatio", label: "涨跌比", className: "history-group-end" },
  { field: "limitUp", label: "涨停" }, { field: "limitDown", label: "跌停" }, { label: "大涨股" },
  { field: "consecutive", label: "连板" }, { field: "maxStreak", label: "最高板", className: "history-group-end" },
  { field: "openPremium", label: "连板开盘溢价" }, { field: "closePremium", label: "连板收盘溢价" },
  { field: "high120", label: "120日新高" }, { field: "allTimeHigh", label: "历史新高" },
  { field: "marginBalance", label: "两融余额", className: "history-group-end" },
  { label: "状态" }, { label: "数据来源" }, { label: "更新时间" },
];

export function HistoryTable({ rows, selected, sort, order, scrollRef, onSelect, onSort, onNearEnd, onScrollPosition, onOpenHighs }: {
  rows: HistoryRow[];
  selected: string;
  sort: HistorySortField;
  order: SortOrder;
  scrollRef: RefObject<HTMLDivElement | null>;
  onSelect: (date: string) => void;
  onSort: (field: HistorySortField) => void;
  onNearEnd: () => void;
  onScrollPosition: (top: number, left: number) => void;
  onOpenHighs: (date: string, type: HighDetailType) => void;
}) {
  return (
    <div className="history-table-scroll" ref={scrollRef} onScroll={(event) => {
      const element = event.currentTarget;
      onScrollPosition(element.scrollTop, element.scrollLeft);
      if (element.scrollHeight - element.scrollTop - element.clientHeight < 90) onNearEnd();
    }}>
      <table className="history-table">
        <thead><tr>{columns.map((column) => <th key={column.label} className={column.className}>{column.field ? <button type="button" onClick={() => onSort(column.field!)} className={sort === column.field ? "is-sorted" : ""}>{column.label}{sort !== column.field ? <ChevronsUpDown size={11} /> : order === "desc" ? <ArrowDown size={11} /> : <ArrowUp size={11} />}</button> : column.label}</th>)}</tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.date} data-history-date={row.date} className={selected === row.date ? "selected" : ""} onClick={() => onSelect(row.date)}>
            <td className="history-date"><Link href={`/dashboard?date=${row.date}`} title={`查看 ${row.date} 完整复盘`}>{row.date}</Link></td>
            <td className="history-sector-cell"><span className="history-sector" title={row.topSector}>{row.topSector}</span></td>
            <td className="rise">{count(row.rising)}</td><td className="fall">{count(row.falling)}</td><td>{count(row.flat)}</td>
            <td className="history-group-end">{ratio(row.riseFallRatio)}</td>
            <td className="rise">{row.limitUp}</td><td className="fall">{row.limitDown}</td><td>{count(row.largeRise)}</td>
            <td>{row.consecutive}</td><td className="history-group-end">{row.maxStreak}板</td>
            <td className={tone(row.openPremium)}>{pct(row.openPremium)}</td>
            <td className={tone(row.closePremium)}>{pct(row.closePremium)}</td>
            <td><button type="button" className="history-drilldown" disabled={row.high120 === null} onClick={(event) => { event.stopPropagation(); onOpenHighs(row.date, "120d"); }} aria-label={`查看120日新高股票 ${row.date}`}>{row.high120 ?? "暂缺"}</button></td>
            <td><button type="button" className="history-drilldown" disabled={row.allTimeHigh === null} onClick={(event) => { event.stopPropagation(); onOpenHighs(row.date, "all-time"); }} aria-label={`查看历史新高股票 ${row.date}`}>{row.allTimeHigh ?? "暂缺"}</button></td>
            <td className="history-group-end">{money(row.marginBalance)}</td>
            <td><span className={`history-status ${row.backfilled ? "backfilled" : row.status}`}>{row.backfilled ? "回补" : row.status === "complete" ? "完整" : row.status === "partial" ? "部分" : row.status === "demo" ? "演示" : "失败"}</span></td>
            <td className="history-source" title={row.source}>{row.source}</td>
            <td className="history-updated" title={row.updatedAt}>{updatedTime(row.updatedAt)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
