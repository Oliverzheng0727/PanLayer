"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { EtfSnapshot } from "../../../lib/data/provider";
import { ETF_CATEGORIES, queryEtfs, type EtfCategory, type EtfSortField } from "../../../lib/etf/catalog";
import { EtfChart } from "./EtfChart";
import { EtfTable } from "./EtfTable";

export function EtfWorkspace({ initialEtfs }: { initialEtfs: EtfSnapshot[] }) {
  const [category, setCategory] = useState<EtfCategory>("全部");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<EtfSortField>("averageAmount20");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [selectedSymbol, setSelectedSymbol] = useState(initialEtfs[0]?.symbol ?? "");
  const page = useMemo(() => queryEtfs(initialEtfs, { category, query, sort, order, cursor: 0, limit: 500 }), [category, initialEtfs, order, query, sort]);
  const selected = page.items.find((item) => item.symbol === selectedSymbol) ?? page.items[0];

  const counts = useMemo(() => Object.fromEntries(ETF_CATEGORIES.map((item) => [item, item === "全部" ? initialEtfs.length : initialEtfs.filter((etf) => etf.category === item).length])), [initialEtfs]);
  const chooseCategory = (next: EtfCategory) => {
    setCategory(next);
    const first = queryEtfs(initialEtfs, { category: next, query, sort, order, cursor: 0, limit: 1 }).items[0];
    if (first) setSelectedSymbol(first.symbol);
  };
  const cycleSort = (field: EtfSortField) => {
    if (sort !== field) { setSort(field); setOrder("desc"); return; }
    if (order === "desc") { setOrder("asc"); return; }
    setSort("averageAmount20"); setOrder("desc");
  };

  return (
    <div className="etf-workspace panel">
      <aside className="etf-category-rail"><div className="etf-category-title"><strong>ETF 全品类</strong><span>{initialEtfs.length} 只产品</span></div><nav>{ETF_CATEGORIES.map((item) => <button key={item} type="button" className={category === item ? "active" : ""} onClick={() => chooseCategory(item)}><span>{item}</span><em>{counts[item]}</em></button>)}</nav></aside>
      <section className="etf-list-panel"><div className="etf-list-head"><div><strong>{category}</strong><span>当前 {page.total} 只 · 点击表头排序</span></div><label><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 ETF、代码或标签" /></label></div><EtfTable items={page.items} selected={selected?.symbol ?? ""} sort={sort} order={order} onSelect={(item) => setSelectedSymbol(item.symbol)} onSort={cycleSort} /></section>
      {selected ? <EtfChart key={selected.symbol} etf={selected} /> : <div className="etf-empty">暂无可显示的 ETF</div>}
    </div>
  );
}
