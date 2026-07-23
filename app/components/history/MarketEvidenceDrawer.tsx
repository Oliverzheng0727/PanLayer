"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import type { ComparisonStock, MetricEvidence } from "../../../lib/domain/types";
import type { HistoryRow } from "../../../lib/history/query";

export type MarketEvidenceKind =
  | "brokenCount"
  | "sealRate"
  | "yesterdaySuccessRate"
  | "continuation"
  | "marketAmount"
  | "mainSectors"
  | "maxBoard"
  | "brokenBoard"
  | "cycleLeader"
  | "recognition"
  | "indices";

const labels: Record<MarketEvidenceKind, string> = {
  brokenCount: "炸板家数",
  sealRate: "封板率",
  yesterdaySuccessRate: "昨日打板成功率",
  continuation: "连板反馈",
  marketAmount: "全市场成交额",
  mainSectors: "主线板块",
  maxBoard: "最高板股票",
  brokenBoard: "断板股票",
  cycleLeader: "龙头周期",
  recognition: "辨识度个股",
  indices: "指数情况",
};

const evidenceKeys: Record<MarketEvidenceKind, string> = {
  brokenCount: "brokenCount",
  sealRate: "sealRate",
  yesterdaySuccessRate: "yesterdaySuccessRate",
  continuation: "continuation",
  marketAmount: "marketAmount",
  mainSectors: "mainSectors",
  maxBoard: "maxBoard",
  brokenBoard: "brokenBoard",
  cycleLeader: "cycleLeader",
  recognition: "recognition",
  indices: "indices",
};

const pct = (value: number | null) => value === null ? "暂缺" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const amount = (value: number | null) => value === null ? "暂缺" : `${(value / 100_000_000).toFixed(2)}亿`;

function stockRows(row: HistoryRow, kind: MarketEvidenceKind): ComparisonStock[] {
  const comparison = row.comparison;
  if (!comparison) return [];
  if (kind === "maxBoard") return comparison.maxBoard?.stocks ?? [];
  if (kind === "brokenBoard") return comparison.brokenBoard.stocks;
  if (kind === "cycleLeader") return comparison.cycleLeader ? [comparison.cycleLeader] : [];
  if (kind === "recognition") return comparison.recognition;
  return [];
}

function EvidenceMeta({ evidence }: { evidence: MetricEvidence | undefined }) {
  if (!evidence) return <div className="market-evidence-empty"><strong>证据数据暂缺</strong><p>该日期尚未保存完整的来源与计算口径。</p></div>;
  return (
    <dl className="market-evidence-meta">
      <div><dt>数据来源</dt><dd>{evidence.source || "暂缺"}</dd></div>
      <div><dt>计算口径</dt><dd>{evidence.formula || "暂缺"}</dd></div>
      <div><dt>有效样本</dt><dd>{evidence.sampleSize.toLocaleString("zh-CN")}</dd></div>
      <div><dt>覆盖率</dt><dd>{evidence.coveragePct === null ? "不适用" : `${evidence.coveragePct.toFixed(2)}%`}</dd></div>
      <div><dt>市场时间</dt><dd>{evidence.marketTime ?? "暂缺"}</dd></div>
      <div><dt>接收时间</dt><dd>{evidence.receivedAt || "暂缺"}</dd></div>
      {evidence.message && <div className="wide"><dt>校验说明</dt><dd>{evidence.message}</dd></div>}
    </dl>
  );
}

export function MarketEvidenceDrawer({ row, kind, onClose }: {
  row: HistoryRow;
  kind: MarketEvidenceKind;
  onClose: () => void;
}) {
  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const comparison = row.comparison;
  const stocks = stockRows(row, kind);
  const evidence = comparison?.evidence[evidenceKeys[kind]];

  return (
    <div className="high-drawer-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="high-drawer market-evidence-drawer" role="dialog" aria-modal="true" aria-label={`${row.date} ${labels[kind]}证据`}>
        <header className="high-drawer-header">
          <div><p>{row.date} · VERIFIED MARKET DATA</p><h3>{labels[kind]}</h3></div>
          <button type="button" className="high-drawer-icon" onClick={onClose} aria-label="关闭证据抽屉"><X size={18} /></button>
        </header>
        <div className="market-evidence-body">
          <EvidenceMeta evidence={evidence} />

          {kind === "continuation" && comparison?.continuation && (
            <div className="market-evidence-kpis">
              <div><span>今日收红率</span><strong>{pct(comparison.continuation.positiveRate)}</strong></div>
              <div><span>平均收盘涨幅</span><strong>{pct(comparison.continuation.averagePct)}</strong></div>
              <div><span>晋级涨停率</span><strong>{pct(comparison.continuation.promotionRate)}</strong></div>
            </div>
          )}

          {kind === "mainSectors" && comparison?.mainSectors.length ? (
            <div className="market-evidence-table-wrap"><table className="market-evidence-table"><thead><tr><th>板块</th><th>涨停家数</th><th>平均涨幅</th><th>成交额增量</th><th>最高连板</th></tr></thead><tbody>{comparison.mainSectors.map((item) => <tr key={item.name}><td><strong>{item.name}</strong></td><td>{item.limitUpCount}</td><td className={item.averagePct >= 0 ? "rise" : "fall"}>{pct(item.averagePct)}</td><td className={item.amountGrowthPct === null ? "" : item.amountGrowthPct >= 0 ? "rise" : "fall"}>{pct(item.amountGrowthPct)}</td><td>{item.maxStreak}板</td></tr>)}</tbody></table></div>
          ) : kind === "indices" && comparison?.indices.length ? (
            <div className="market-evidence-table-wrap"><table className="market-evidence-table"><thead><tr><th>指数</th><th>收盘</th><th>涨跌幅</th><th>成交额</th><th>状态</th></tr></thead><tbody>{comparison.indices.map((item) => <tr key={item.symbol}><td><strong>{item.name}</strong><span>{item.symbol}</span></td><td>{item.price?.toLocaleString("zh-CN") ?? "暂缺"}</td><td className={(item.pctChange ?? 0) >= 0 ? "rise" : "fall"}>{pct(item.pctChange)}</td><td>{amount(item.amount)}</td><td>{item.status === "complete" ? "双源一致" : item.status === "partial" ? "部分" : "失败"}</td></tr>)}</tbody></table></div>
          ) : stocks.length ? (
            <div className="market-evidence-table-wrap"><table className="market-evidence-table"><thead><tr><th>股票</th><th>状态</th><th>连板</th><th>涨跌幅</th><th>成交额</th><th>板块</th><th>首次封板</th></tr></thead><tbody>{stocks.map((item) => <tr key={item.code}><td><strong>{item.name}</strong><span>{item.code}</span></td><td>{item.isLimitUp === true ? "封板" : item.isLimitUp === false ? "未封板" : "暂缺"}</td><td>{item.limitStreak > 0 ? `${item.limitStreak}板` : "—"}</td><td className={(item.pctChange ?? 0) >= 0 ? "rise" : "fall"}>{pct(item.pctChange)}</td><td>{amount(item.amount)}</td><td>{item.sector}</td><td>{item.firstLimitTime ?? "—"}</td></tr>)}</tbody></table></div>
          ) : kind !== "continuation" && kind !== "brokenCount" && kind !== "sealRate" && kind !== "yesterdaySuccessRate" && kind !== "marketAmount" ? (
            <div className="market-evidence-empty"><strong>明细数据暂缺</strong><p>该日期没有可验证的股票或指数明细。</p></div>
          ) : null}
        </div>
        <footer className="high-drawer-footer"><span>数据不可用时不沿用旧值</span><span>仅供市场复盘，不构成投资建议</span></footer>
      </aside>
    </div>
  );
}
