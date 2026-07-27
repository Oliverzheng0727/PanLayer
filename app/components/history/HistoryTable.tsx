"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import type { RefObject } from "react";
import type { HistoryRow, HistorySortField, SortOrder } from "../../../lib/history/query";
import type { MarketEvidenceKind } from "./MarketEvidenceDrawer";

const pct = (value: number | null) => value === null ? "暂缺" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const count = (value: number | null) => value === null ? "暂缺" : value.toLocaleString("zh-CN");
const money = (value: number | null) => value === null ? "暂缺" : `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}亿`;
const tone = (value: number | null) => value === null ? "" : value >= 0 ? "rise" : "fall";

function historicalMissingReason(row: HistoryRow, value: unknown, availableTitle: string): string {
  if (value !== null && value !== undefined && value !== "暂缺") return availableTitle;
  if (row.backfilled) return "历史源不支持全市场回补，因此保持暂缺";
  return "当日任务失败或覆盖率不足，等待自动补跑；不会沿用旧值";
}

const columns: Array<{ field?: HistorySortField; label: string; className?: string; width: number }> = [
  { field: "date", label: "日期", className: "history-date", width: 112 },
  { field: "limitUp", label: "涨停家数", width: 94 },
  { field: "limitDown", label: "跌停家数", width: 94 },
  { field: "brokenCount", label: "炸板家数", width: 94 },
  { field: "largeDownCount", label: "大跌家数（7%）", width: 118 },
  { field: "sealRate", label: "封板率", width: 98 },
  { field: "yesterdaySuccessRate", label: "昨日打板成功率", width: 134 },
  { field: "continuationAveragePct", label: "连板反馈", width: 230 },
  { field: "rising", label: "上涨家数", width: 104 },
  { field: "marketAmount", label: "成交额", width: 120 },
  { field: "consecutive", label: "连板数", width: 92 },
  { field: "maxStreak", label: "最高板（名称）", width: 210 },
  { field: "brokenBoardCount", label: "断板数（二板+）", width: 116 },
  { field: "brokenBoardRate", label: "断板率", width: 98 },
  { label: "主线板块", className: "history-main-sector", width: 270 },
  { label: "龙头周期", width: 130 },
  { label: "客观辨识度榜", width: 330 },
  { label: "指数情况", width: 330 },
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
  onOpenEvidence: (row: HistoryRow, kind: MarketEvidenceKind) => void;
}) {
  return (
    <div className="history-table-scroll" ref={scrollRef} onScroll={(event) => {
      const element = event.currentTarget;
      onScrollPosition(element.scrollTop, element.scrollLeft);
      if (element.scrollHeight - element.scrollTop - element.clientHeight < 90) onNearEnd();
    }}>
      <table className="history-table">
        <colgroup>{columns.map((column) => <col key={column.label} style={{ width: column.width }} />)}</colgroup>
        <thead>
          <tr className="history-table-columns">{columns.map((column) => <th key={column.label} className={column.className}>{column.field ? <button type="button" onClick={() => onSort(column.field!)} className={sort === column.field ? "is-sorted" : ""}>{column.label}{sort !== column.field ? <ChevronsUpDown size={11} /> : order === "desc" ? <ArrowDown size={11} /> : <ArrowUp size={11} />}</button> : column.label}</th>)}</tr>
        </thead>
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
              <td className="rise">{count(row.limitUp)}</td>
              <td className="fall">{count(row.limitDown)}</td>
              <td><EvidenceButton disabled={false} label={count(row.brokenCount)} title={historicalMissingReason(row, row.brokenCount, "查看炸板数据口径")} onClick={() => onOpenEvidence(row, "brokenCount")} /></td>
              <td className="fall" title={historicalMissingReason(row, row.largeDownCount, "收盘跌幅不高于-7%且未封跌停")}>{count(row.largeDownCount)}</td>
              <td><EvidenceButton disabled={false} label={pct(row.sealRate)} title={historicalMissingReason(row, row.sealRate, "查看封板率口径")} onClick={() => onOpenEvidence(row, "sealRate")} /></td>
              <td><EvidenceButton disabled={false} label={pct(row.yesterdaySuccessRate)} title={historicalMissingReason(row, row.yesterdaySuccessRate, "查看昨日打板成功率口径")} onClick={() => onOpenEvidence(row, "yesterdaySuccessRate")} /></td>
              <td className={tone(row.continuationAveragePct)}><EvidenceButton disabled={false} label={continuation} title={historicalMissingReason(row, row.continuationAveragePct, "查看连板反馈样本")} onClick={() => onOpenEvidence(row, "continuation")} /></td>
              <td className="rise" title={historicalMissingReason(row, row.rising, "收盘上涨家数")}>{count(row.rising)}</td>
              <td><EvidenceButton disabled={false} label={money(row.marketAmount)} title={historicalMissingReason(row, row.marketAmount, "查看全市场成交额覆盖率")} onClick={() => onOpenEvidence(row, "marketAmount")} /></td>
              <td>{count(row.consecutive)}</td>
              <td><EvidenceButton disabled={row.comparison?.maxBoard === null || !row.comparison} label={maximum} title="查看最高板股票" onClick={() => onOpenEvidence(row, "maxBoard")} /></td>
              <td>{<EvidenceButton disabled={row.brokenBoardCount === null} label={count(row.brokenBoardCount)} title="查看断板股票" onClick={() => onOpenEvidence(row, "brokenBoard")} />}</td>
              <td>{pct(row.brokenBoardRate)}</td>
              <td className="history-main-sector"><EvidenceButton disabled={!row.comparison?.mainSectors.length} label={row.topSector} title="查看主线板块排序依据" onClick={() => onOpenEvidence(row, "mainSectors")} /></td>
              <td><EvidenceButton disabled={!row.comparison?.cycleLeader} label={row.cycleLeader} title="查看周期龙头排序依据" onClick={() => onOpenEvidence(row, "cycleLeader")} /></td>
              <td><EvidenceButton disabled={!row.comparison?.recognition.length && !row.recognitionCount && !row.comparison?.evidence.recognition} label={row.recognition} title="查看严格门槛、三维评分和全部入围股票" onClick={() => onOpenEvidence(row, "recognition")} /></td>
              <td><EvidenceButton disabled={!row.comparison?.indices.length} label={row.indexSummary} title="查看指数明细与来源" onClick={() => onOpenEvidence(row, "indices")} /></td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}
