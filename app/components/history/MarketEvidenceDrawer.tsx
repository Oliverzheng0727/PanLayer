"use client";

import { Maximize2, Minimize2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ComparisonStock, MetricEvidence, RecognitionRankingItem } from "../../../lib/domain/types";
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
  recognition: "客观辨识度榜",
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
const volume = (value: number) => value >= 100_000_000
  ? `${(value / 100_000_000).toFixed(2)}亿股`
  : `${(value / 10_000).toFixed(0)}万股`;

type RecognitionSort = "score" | "streak" | "amount" | "hotRank";

function sortRecognition(
  items: RecognitionRankingItem[],
  field: RecognitionSort,
  order: "asc" | "desc",
) {
  const direction = order === "asc" ? 1 : -1;
  return items.toSorted((left, right) => {
    const compared = field === "score"
      ? left.scores.total - right.scores.total
      : field === "streak"
        ? left.limitStreak - right.limitStreak
        : field === "amount"
          ? left.amount - right.amount
          : left.hotRank - right.hotRank;
    return compared === 0 ? left.rank - right.rank : compared * direction;
  });
}

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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [recognitionSort, setRecognitionSort] = useState<RecognitionSort>("score");
  const [recognitionOrder, setRecognitionOrder] = useState<"asc" | "desc">("desc");
  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isFullscreen) setIsFullscreen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isFullscreen, onClose]);

  const comparison = row.comparison;
  const stocks = stockRows(row, kind);
  const evidence = comparison?.evidence[evidenceKeys[kind]];
  const recognitionRanking = kind === "recognition" ? row.recognitionRanking : undefined;
  const sortedRecognition = recognitionRanking
    ? sortRecognition(recognitionRanking.items, recognitionSort, recognitionOrder)
    : [];
  const changeRecognitionSort = (field: RecognitionSort) => {
    if (field === recognitionSort) {
      setRecognitionOrder((current) => current === "desc" ? "asc" : "desc");
      return;
    }
    setRecognitionSort(field);
    setRecognitionOrder(field === "hotRank" ? "asc" : "desc");
  };

  return (
    <div className="high-drawer-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className={`high-drawer market-evidence-drawer${isFullscreen ? " is-fullscreen" : ""}`} role="dialog" aria-modal="true" aria-label={`${row.date} ${labels[kind]}证据`}>
        <header className="high-drawer-header">
          <div><p>{row.date} · VERIFIED MARKET DATA</p><h3>{labels[kind]}</h3></div>
          <div className="high-drawer-header-actions">
            <button type="button" className="high-drawer-icon" onClick={() => setIsFullscreen((current) => !current)} aria-label={isFullscreen ? "退出全屏" : "全屏查看"}>
              {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
            <button type="button" className="high-drawer-icon" onClick={onClose} aria-label="关闭证据抽屉"><X size={18} /></button>
          </div>
        </header>
        <div className="market-evidence-body">
          <EvidenceMeta evidence={evidence} />

          {kind === "recognition" && recognitionRanking ? (
            <>
              <div className="recognition-summary">
                <div><span>严格入围</span><strong>{recognitionRanking.items.length}</strong></div>
                <div><span>第一梯队</span><strong>{recognitionRanking.firstTierCount}</strong></div>
                <div><span>第二梯队</span><strong>{recognitionRanking.secondTierCount}</strong></div>
                <div><span>数据状态</span><strong>{recognitionRanking.status === "complete" ? "完整" : recognitionRanking.status === "partial" ? "部分" : "失败"}</strong></div>
              </div>
              <div className="recognition-filter-grid">
                {[
                  ["梯队候选", recognitionRanking.filters.ladderCandidates],
                  ["基础过滤", recognitionRanking.filters.excludedBase],
                  ["成交额不足", recognitionRanking.filters.excludedAmount],
                  ["换手率不足", recognitionRanking.filters.excludedTurnover],
                  ["上市时间不足", recognitionRanking.filters.excludedListingAge],
                  ["未进热榜前30", recognitionRanking.filters.excludedHotRank],
                  ["量能历史不足", recognitionRanking.filters.excludedVolumeHistory],
                  ["放量条件不足", recognitionRanking.filters.excludedVolumeCondition],
                ].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}
              </div>
              <div className="recognition-sortbar">
                <span>榜内排序</span>
                {([
                  ["score", "综合分"],
                  ["streak", "连板"],
                  ["amount", "成交额"],
                  ["hotRank", "热榜"],
                ] as Array<[RecognitionSort, string]>).map(([field, label]) => (
                  <button type="button" key={field} className={recognitionSort === field ? "active" : ""} onClick={() => changeRecognitionSort(field)}>
                    {label}{recognitionSort === field ? recognitionOrder === "desc" ? " ↓" : " ↑" : ""}
                  </button>
                ))}
              </div>
              {recognitionRanking.items.length > 0 ? (
                (["first", "second"] as const).map((tier) => {
                  const tierItems = sortedRecognition.filter((item) => item.tier === tier);
                  if (tierItems.length === 0) return tier === "first"
                    ? <div className="recognition-tier-empty" key={tier}>第一梯队：当日无高辨识度共振入围</div>
                    : null;
                  return (
                    <section className="recognition-tier" key={tier}>
                      <h4>{tier === "first" ? "第一梯队 · 高辨识度共振" : "第二梯队 · 人气共振"}</h4>
                      <div className="market-evidence-table-wrap recognition-table-wrap">
                        <table className="market-evidence-table recognition-table">
                          <thead><tr><th>排名</th><th>股票</th><th>总分</th><th>连板</th><th>成交额 / 成交量</th><th>换手率</th><th>3日 / 30日均量</th><th>量比</th><th>热榜</th><th>核心题材</th><th>量价状态</th><th>分项得分</th><th>客观亮点</th></tr></thead>
                          <tbody>{tierItems.map((item) => <tr key={item.symbol}>
                            <td>#{item.rank}</td>
                            <td><strong>{item.name}</strong><span>{item.symbol}</span></td>
                            <td className="recognition-score">{item.scores.total.toFixed(1)}</td>
                            <td>{item.limitStreak}板</td>
                            <td><strong>{amount(item.amount)}</strong><span>{volume(item.volume)}</span></td>
                            <td>{item.turnoverRate.toFixed(2)}%<span>原始口径</span></td>
                            <td><strong>{volume(item.averageVolume3)}</strong><span>{volume(item.averageVolume30)}</span></td>
                            <td>{item.volumeRatio.toFixed(2)}倍</td>
                            <td>第{item.hotRank}<span>{item.hotRankChange === 0 ? "持平" : `${item.hotRankChange > 0 ? "+" : ""}${item.hotRankChange}`}</span></td>
                            <td className="recognition-topic"><strong>{item.topic}</strong><span>{item.topicSource}</span></td>
                            <td>{item.priceVolumeState}<span>{pct(item.pctChange)}</span></td>
                            <td>连板 {item.scores.streak.toFixed(1)}<span>量能 {item.scores.liquidity.toFixed(1)} · 人气 {item.scores.popularity.toFixed(1)}</span></td>
                            <td className="recognition-topic">{item.highlights.join(" · ")}</td>
                          </tr>)}</tbody>
                        </table>
                      </div>
                    </section>
                  );
                })
              ) : (
                <div className="market-evidence-empty"><strong>当日无共振入围股票</strong><p>所有硬门槛保持不变；不会放宽条件或使用 AI 补充名单。</p></div>
              )}
              <div className="recognition-provenance">
                <span>{recognitionRanking.evidence.hotListSource} · 前30 {recognitionRanking.evidence.hotListCount}只</span>
                <span>量能K线 {recognitionRanking.evidence.barSuccessCount}/{recognitionRanking.evidence.barCandidateCount}</span>
                <span>{recognitionRanking.evidence.message}</span>
              </div>
            </>
          ) : kind === "recognition" ? (
            <div className="market-evidence-empty"><strong>新口径历史数据暂缺</strong><p>该日期没有保存同花顺热榜、量能K线与连板数据，不使用当前热度反推历史。</p></div>
          ) : kind === "continuation" && comparison?.continuation && (
            <div className="market-evidence-kpis">
              <div><span>今日收红率</span><strong>{pct(comparison.continuation.positiveRate)}</strong></div>
              <div><span>平均收盘涨幅</span><strong>{pct(comparison.continuation.averagePct)}</strong></div>
              <div><span>晋级涨停率</span><strong>{pct(comparison.continuation.promotionRate)}</strong></div>
            </div>
          )}

          {kind === "recognition" ? null : kind === "mainSectors" && comparison?.mainSectors.length ? (
            <div className="market-evidence-table-wrap"><table className="market-evidence-table"><thead><tr><th>板块</th><th>涨停家数</th><th>平均涨幅</th><th>成交额增量</th><th>最高连板</th></tr></thead><tbody>{comparison.mainSectors.map((item) => <tr key={item.name}><td><strong>{item.name}</strong></td><td>{item.limitUpCount}</td><td className={item.averagePct >= 0 ? "rise" : "fall"}>{pct(item.averagePct)}</td><td className={item.amountGrowthPct === null ? "" : item.amountGrowthPct >= 0 ? "rise" : "fall"}>{pct(item.amountGrowthPct)}</td><td>{item.maxStreak}板</td></tr>)}</tbody></table></div>
          ) : kind === "indices" && comparison?.indices.length ? (
            <div className="market-evidence-table-wrap"><table className="market-evidence-table"><thead><tr><th>指数</th><th>收盘</th><th>涨跌幅</th><th>成交额</th><th>状态</th></tr></thead><tbody>{comparison.indices.map((item) => <tr key={item.symbol}><td><strong>{item.name}</strong><span>{item.symbol}</span></td><td>{item.price?.toLocaleString("zh-CN") ?? "暂缺"}</td><td className={(item.pctChange ?? 0) >= 0 ? "rise" : "fall"}>{pct(item.pctChange)}</td><td>{amount(item.amount)}</td><td>{item.status === "complete" ? "双源一致" : item.status === "partial" ? "部分" : "失败"}</td></tr>)}</tbody></table></div>
          ) : stocks.length ? (
            <div className="market-evidence-table-wrap"><table className="market-evidence-table"><thead><tr><th>股票</th><th>状态</th><th>连板</th><th>涨跌幅</th><th>成交额</th><th>板块</th><th>首次封板</th></tr></thead><tbody>{stocks.map((item) => <tr key={item.code}><td><strong>{item.name}</strong><span>{item.code}</span></td><td>{item.isLimitUp === true ? "封板" : item.isLimitUp === false ? "未封板" : "暂缺"}</td><td>{item.limitStreak > 0 ? `${item.limitStreak}板` : "—"}</td><td className={(item.pctChange ?? 0) >= 0 ? "rise" : "fall"}>{pct(item.pctChange)}</td><td>{amount(item.amount)}</td><td>{item.sector}</td><td>{item.firstLimitTime ?? "—"}</td></tr>)}</tbody></table></div>
          ) : kind !== "continuation" && kind !== "brokenCount" && kind !== "sealRate" && kind !== "yesterdaySuccessRate" && kind !== "marketAmount" ? (
            <div className="market-evidence-empty"><strong>明细数据暂缺</strong><p>该日期没有可验证的股票或指数明细。</p></div>
          ) : null}
        </div>
        <footer className="high-drawer-footer"><span>数据不可用时不沿用旧值</span><span>客观数据复盘，不构成投资建议；排名不代表未来涨跌</span></footer>
      </aside>
    </div>
  );
}
