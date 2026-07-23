"use client";

import { ArrowDown, ArrowLeft, ArrowUp, ChevronsUpDown, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { queryHighDetails, type HighDetail, type HighDetailOrder, type HighDetailSort, type HighDetailType } from "../../../lib/history/high-details";
import type { EtfSnapshot } from "../../../lib/data/provider";
import { EtfChart } from "../etf/EtfChart";

const formatAmount = (value: number) => value >= 1e8 ? `${(value / 1e8).toFixed(1)}亿` : `${(value / 1e4).toFixed(0)}万`;
const pct = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

const sortColumns: Array<{ field: HighDetailSort; label: string }> = [
  { field: "name", label: "股票" }, { field: "pctChange", label: "涨跌幅" },
  { field: "amount", label: "成交额" }, { field: "intervalPct", label: "区间涨幅" },
];

export function HighDetailDrawer({ date, type, items, onTypeChange, onClose }: {
  date: string;
  type: HighDetailType;
  items: HighDetail[];
  onTypeChange: (type: HighDetailType) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<HighDetailSort>("amount");
  const [order, setOrder] = useState<HighDetailOrder>("desc");
  const [selectedStock, setSelectedStock] = useState<HighDetail | null>(null);

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = oldOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [onClose]);

  const result = useMemo(() => queryHighDetails(items, { type, query, sort, order }), [items, order, query, sort, type]);
  const total20 = items.filter((item) => item.type === "20d").length;
  const total120 = items.filter((item) => item.type === "120d").length;
  const totalAllTime = items.filter((item) => item.type === "all-time").length;

  const cycleSort = (field: HighDetailSort) => {
    if (sort !== field) { setSort(field); setOrder("desc"); return; }
    setOrder((current) => current === "desc" ? "asc" : "desc");
  };

  return (
    <div className="high-drawer-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="high-drawer" role="dialog" aria-modal="true" aria-label={`${date} 新高股票明细`}>
        <header className="high-drawer-header">
          <div className="flex min-w-0 items-center gap-3">
            {selectedStock && <button type="button" className="high-drawer-icon" onClick={() => setSelectedStock(null)} aria-label="返回股票列表"><ArrowLeft size={17} /></button>}
            <div className="min-w-0"><p>{date} · NEW HIGH DETAIL</p><h3 className="truncate">{selectedStock ? `${selectedStock.name} · ${selectedStock.symbol}` : "新高股票明细"}</h3></div>
          </div>
          <button type="button" className="high-drawer-icon" onClick={onClose} aria-label="关闭新高股票明细"><X size={18} /></button>
        </header>

        {selectedStock ? (
          <div className="high-stock-view">
            <div className="high-stock-summary"><div><span>收盘价</span><strong>{selectedStock.close.toFixed(2)}</strong></div><div><span>当日涨跌</span><strong className="rise">{pct(selectedStock.pctChange)}</strong></div><div><span>区间涨幅</span><strong className="rise">{pct(selectedStock.intervalPct)}</strong></div></div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-white/[0.06]"><EtfChart etf={{ symbol: selectedStock.symbol, name: selectedStock.name, category: selectedStock.sector, tags: [selectedStock.sector], exchange: selectedStock.symbol.endsWith(".SH") ? "SH" : "SZ", price: selectedStock.close, pctChange: selectedStock.pctChange, amount: selectedStock.amount, averageAmount20: null, scale: null, turnoverRate: null, status: "active", updatedAt: selectedStock.date } satisfies EtfSnapshot} /></div>
          </div>
        ) : (
          <>
            <div className="high-drawer-tabs"><button type="button" className={type === "20d" ? "active" : ""} onClick={() => onTypeChange("20d")}>20日新高 <span>{total20}</span></button><button type="button" className={type === "120d" ? "active" : ""} onClick={() => onTypeChange("120d")}>120日新高 <span>{total120}</span></button><button type="button" className={type === "all-time" ? "active" : ""} onClick={() => onTypeChange("all-time")}>历史新高 <span>{totalAllTime}</span></button></div>
            <div className="high-drawer-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索股票、代码或行业" /><span>{result.length} 家</span></div>
            {result.length ? <div className="high-detail-table-wrap"><table className="high-detail-table"><thead><tr>{sortColumns.map((column) => <th key={column.field}><button type="button" className={sort === column.field ? "active" : ""} onClick={() => cycleSort(column.field)}>{column.label}{sort !== column.field ? <ChevronsUpDown size={11} /> : order === "desc" ? <ArrowDown size={11} /> : <ArrowUp size={11} />}</button></th>)}<th>收盘</th><th>行业</th></tr></thead><tbody>{result.map((item) => <tr key={`${item.type}-${item.symbol}`} onClick={() => setSelectedStock(item)}><td><strong>{item.name}</strong><span>{item.symbol}</span></td><td className={item.pctChange >= 0 ? "rise" : "fall"}>{pct(item.pctChange)}</td><td>{formatAmount(item.amount)}</td><td className="rise">{pct(item.intervalPct)}</td><td>{item.close.toFixed(2)}</td><td><span className="history-sector">{item.sector}</span></td></tr>)}</tbody></table></div> : <div className="high-detail-empty"><strong>明细数据暂缺</strong><p>没有符合当前类型和搜索条件的股票明细。</p></div>}
            <footer className="high-drawer-footer"><span>点击股票可查看分时、日K、周K、月K</span><span>前复权真实行情 · 不构成投资建议</span></footer>
          </>
        )}
      </aside>
    </div>
  );
}
