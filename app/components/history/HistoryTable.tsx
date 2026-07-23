"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import type { RefObject } from "react";
import type { HistoryRow, HistorySortField, SortOrder } from "../../../lib/history/query";
import type { HighDetailType } from "../../../lib/history/high-details";
import type { MarketEvidenceKind } from "./MarketEvidenceDrawer";

const pct = (value: number | null) => value === null ? "暂缺" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const count = (value: number | null) => value === null ? "暂缺" : value.toLocaleString("zh-CN");
const money = (value: number | null) => value === null ? "暂缺" : `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}亿`;
const tone = (value: number | null) => value === null ? "" : value >= 0 ? "rise" : "fall";
const updatedTime = (value: string) => {
  const normalized = value.replace("T", " ");
  return normalized.length >= 16 ? `${normalized.slice(5, 10)} ${normalized.slice(11, 16)}` : value;
};

const columns: Array<{ field?: HistorySortField; label: string; className?: string }> = [
  { field: "date", label: "日期", className: "history-date" },
  { label: "主线板块", className: "history-sector-cell" },
  { field: "limitUp", label: "涨停" },
  { field: "limitDown", label: "跌停" },
  { field: "brokenCount", label: "炸板" },
  { field: "largeDownCount", label: "大跌" },
  { field: "sealRate", label: "封板率", className: "history-group-end" },
  { field: "yesterdaySuccessRate", label: "昨日打板成功率" },
  { field: "continuationAveragePct", label: "连板反馈", className: "history-group-end" },
  { field: "rising", label: "上涨" },
  { field: "falling", label: "下跌" },
  { field: "flat", label: "平盘" },
  { field: "marketAmount", label: "全市场成交额", className: "history-group-end" },
  { field: "consecutive", label: "连板家数" },
  { field: "maxStreak", label: "最高板（名称）" },
  { field: "brokenBoardCount", label: "断板数量" },
  { field: "brokenBoardRate", label: "断板率", className: "history-group-end" },
  { label: "龙头周期" },
  { label: "辨识度个股" },
  { label: "指数情况", className: "history-group-end" },
  { field: "high120", label: "120日新高" },
  { field: "allTimeHigh", label: "历史新高" },
  { field: "marginBalance", label: "两融余额", className: "history-group-end" },
  { label: "状态" },
  { label: "数据来源" },
  { label: "更新时间" },
];

function EvidenceButton({
  disabled,
  label,
  title,
  onClick,
}: {
  disabled: boolean;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return <button type="button" className="history-drilldown history-cell-detail" disabled={disabled} title={title} onClick={(event) => { event.stopPropagation(); onClick(); }}>{label}</button>;
}

export function HistoryTable({
  rows,
  selected,
  sort,
  order,
  scrollRef,
  onSelect,
  onSort,
  onNearEnd,
  onScrollPosition,
  onOpenHighs,
  onOpenEvidence,
}: {
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
  onOpenEvidence: (row: HistoryRow, kind: MarketEvidenceKind) => void;
}) {
  return (
    <div className="history-table-scroll" ref={scrollRef} onScroll={(event) => {
      const element = event.currentTarget;
      onScrollPosition(element.scrollTop, element.scrollLeft);
      if (element.scrollHeight - element.scrollTop - element.clientHeight < 90) onNearEnd();
    }}>
      <table className="history-table">
        <thead><tr>{columns.map((column) => <th key={column.label} className={column.className}>{column.field ? <button type="button" onClick={() => onSort(column.field!)} className={sort === column.field ? "is-sorted" : ""}>{column.label}{sort !== column.field ? <ChevronsUpDown size={11} /> : order === "desc" ? <ArrowDown size={11} /> : <ArrowUp size={11} />}</button> : column.label}</th>)}</tr></thead>
        <tbody>{rows.map((row) => {
          const continuation = row.continuationAveragePct === null
            ? "暂缺"
            : `收红 ${pct(row.continuationPositiveRate)}｜均 ${pct(row.continuationAveragePct)}｜晋级 ${pct(row.continuationPromotionRate)}`;
          const maximum = row.maxStreak > 0
            ? `${row.maxStreak}板${row.maxBoardNames !== "—" ? ` · ${row.maxBoardNames}` : ""}`
            : row.comparison?.evidence.maxBoard?.status === "complete" ? "无涨停" : "暂缺";
          return (
            <tr key={row.date} data-history-date={row.date} className={selected === row.date ? "selected" : ""} onClick={() => onSelect(row.date)}>
              <td className="history-date"><Link href={`/dashboard?date=${row.date}`} title={`查看 ${row.date} 完整复盘`}>{row.date}</Link></td>
              <td className="history-sector-cell"><EvidenceButton disabled={!row.comparison?.mainSectors.length} label={row.topSector} title="查看主线板块排序依据" onClick={() => onOpenEvidence(row, "mainSectors")} /></td>
              <td className="rise">{count(row.limitUp)}</td>
              <td className="fall">{count(row.limitDown)}</td>
              <td><EvidenceButton disabled={row.brokenCount === null} label={count(row.brokenCount)} title="查看炸板数据口径" onClick={() => onOpenEvidence(row, "brokenCount")} /></td>
              <td className="fall">{count(row.largeDownCount)}</td>
              <td className="history-group-end"><EvidenceButton disabled={row.sealRate === null} label={pct(row.sealRate)} title="查看封板率口径" onClick={() => onOpenEvidence(row, "sealRate")} /></td>
              <td><EvidenceButton disabled={row.yesterdaySuccessRate === null} label={pct(row.yesterdaySuccessRate)} title="查看昨日打板成功率口径" onClick={() => onOpenEvidence(row, "yesterdaySuccessRate")} /></td>
              <td className={`history-group-end ${tone(row.continuationAveragePct)}`}><EvidenceButton disabled={row.continuationAveragePct === null} label={continuation} title="查看连板反馈样本" onClick={() => onOpenEvidence(row, "continuation")} /></td>
              <td className="rise">{count(row.rising)}</td>
              <td className="fall">{count(row.falling)}</td>
              <td>{count(row.flat)}</td>
              <td className="history-group-end"><EvidenceButton disabled={row.marketAmount === null} label={money(row.marketAmount)} title="查看全市场成交额覆盖率" onClick={() => onOpenEvidence(row, "marketAmount")} /></td>
              <td>{count(row.consecutive)}</td>
              <td><EvidenceButton disabled={row.comparison?.maxBoard === null || !row.comparison} label={maximum} title="查看最高板股票" onClick={() => onOpenEvidence(row, "maxBoard")} /></td>
              <td>{<EvidenceButton disabled={row.brokenBoardCount === null} label={count(row.brokenBoardCount)} title="查看断板股票" onClick={() => onOpenEvidence(row, "brokenBoard")} />}</td>
              <td className="history-group-end">{pct(row.brokenBoardRate)}</td>
              <td><EvidenceButton disabled={!row.comparison?.cycleLeader} label={row.cycleLeader} title="查看周期龙头排序依据" onClick={() => onOpenEvidence(row, "cycleLeader")} /></td>
              <td><EvidenceButton disabled={!row.comparison?.recognition.length} label={row.recognition} title="查看辨识度个股排序依据" onClick={() => onOpenEvidence(row, "recognition")} /></td>
              <td className="history-group-end"><EvidenceButton disabled={!row.comparison?.indices.length} label={row.indexSummary} title="查看指数明细与来源" onClick={() => onOpenEvidence(row, "indices")} /></td>
              <td><button type="button" className="history-drilldown" disabled={row.high120 === null} onClick={(event) => { event.stopPropagation(); onOpenHighs(row.date, "120d"); }} aria-label={`查看120日新高股票 ${row.date}`}>{row.high120 ?? "暂缺"}</button></td>
              <td><button type="button" className="history-drilldown" disabled={row.allTimeHigh === null} onClick={(event) => { event.stopPropagation(); onOpenHighs(row.date, "all-time"); }} aria-label={`查看历史新高股票 ${row.date}`}>{row.allTimeHigh ?? "暂缺"}</button></td>
              <td className="history-group-end">{money(row.marginBalance)}</td>
              <td><span className={`history-status ${row.backfilled ? "backfilled" : row.status}`}>{row.backfilled ? "回补" : row.status === "complete" ? "完整" : row.status === "partial" ? "部分" : row.status === "demo" ? "演示" : "失败"}</span></td>
              <td className="history-source" title={row.source}>{row.source}</td>
              <td className="history-updated" title={row.updatedAt}>{updatedTime(row.updatedAt)}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}
