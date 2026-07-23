"use client";

import { LoaderCircle, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { EtfSnapshot } from "../../../lib/data/provider";
import { buildEtfCategoryCounts, ETF_CATEGORIES, queryEtfs, type EtfCategory, type EtfSortField } from "../../../lib/etf/catalog";
import { buildEtfSearchUrl } from "../../../lib/etf/search";
import { normalizeEtfSymbol } from "../../../lib/etf/watchlist";
import { EtfChart } from "./EtfChart";
import { EtfTable } from "./EtfTable";

type WorkspaceCategory = EtfCategory | "我的自选";
const workspaceCategories: WorkspaceCategory[] = ["我的自选", ...ETF_CATEGORIES];

export function EtfWorkspace({ initialEtfs }: { initialEtfs: EtfSnapshot[] }) {
  const [category, setCategory] = useState<WorkspaceCategory>("全部");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<EtfSortField>("averageAmount20");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [selectedSymbol, setSelectedSymbol] = useState(initialEtfs[0]?.symbol ?? "");
  const [catalogEtfs, setCatalogEtfs] = useState(initialEtfs);
  const [catalogTotal, setCatalogTotal] = useState(initialEtfs.length);
  const [marketCategoryCounts, setMarketCategoryCounts] = useState<Record<string, number>>(() => Object.fromEntries(buildEtfCategoryCounts(initialEtfs).map((item) => [item.category, item.count])));
  const [watchlist, setWatchlist] = useState<EtfSnapshot[]>([]);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      fetch("/api/v1/etfs/watchlist").then((response) => response.ok ? response.json() : Promise.reject(new Error("watchlist failed"))),
      fetch("/api/v1/etfs/categories").then((response) => response.ok ? response.json() : Promise.reject(new Error("categories failed"))),
    ]).then(([watchlistResult, categoryResult]) => {
      if (cancelled) return;
      if (watchlistResult.status === "fulfilled") {
        const payload = watchlistResult.value as { items?: EtfSnapshot[] };
        if (Array.isArray(payload.items)) setWatchlist(payload.items);
      } else {
        setMessage("自选列表暂时无法加载");
      }
      if (categoryResult.status === "fulfilled") {
        const payload = categoryResult.value as { categories?: Array<{ category: string; count: number }> };
        if (Array.isArray(payload.categories)) {
          const nextCounts = Object.fromEntries(payload.categories.map((item) => [item.category, item.count]));
          setMarketCategoryCounts(nextCounts);
          if (Number.isFinite(nextCounts["全部"])) setCatalogTotal(nextCounts["全部"]);
        }
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (category === "我的自选") return;
    const controller = new AbortController();
    const delay = query.trim() ? 260 : 0;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError("");
      fetch(buildEtfSearchUrl({ category, query, sort, order, limit: 100 }), { signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json() as { items?: EtfSnapshot[]; total?: number; error?: string };
          if (!response.ok || !Array.isArray(payload.items)) throw new Error(payload.error ?? "全市场 ETF 暂时无法查询");
          setCatalogEtfs(payload.items);
          setCatalogTotal(Number.isFinite(payload.total) ? Number(payload.total) : payload.items.length);
        })
        .catch((error) => {
          if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : "全市场 ETF 暂时无法查询");
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, delay);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [category, order, query, sort]);

  const watchedSymbols = useMemo(() => new Set(watchlist.map((item) => item.symbol)), [watchlist]);
  const allEtfs = useMemo(() => [
    ...watchlist,
    ...catalogEtfs.filter((item) => !watchedSymbols.has(item.symbol)),
  ], [catalogEtfs, watchedSymbols, watchlist]);
  const filteredSource = category === "我的自选" ? watchlist : allEtfs;
  const page = useMemo(() => queryEtfs(filteredSource, {
    category: category === "我的自选" ? "全部" : category,
    query,
    sort,
    order,
    cursor: 0,
    limit: 500,
  }), [category, filteredSource, order, query, sort]);
  const selected = allEtfs.find((item) => item.symbol === selectedSymbol) ?? page.items[0];
  const codeToAdd = normalizeEtfSymbol(query);

  const counts = useMemo(() => Object.fromEntries(workspaceCategories.map((item) => [
    item,
    item === "我的自选"
      ? watchlist.length
      : item === "全部"
        ? marketCategoryCounts["全部"] ?? allEtfs.length
        : marketCategoryCounts[item] ?? allEtfs.filter((etf) => etf.category === item).length,
  ])), [allEtfs, marketCategoryCounts, watchlist.length]);

  const chooseCategory = (next: WorkspaceCategory) => {
    setCategory(next);
    const source = next === "我的自选" ? watchlist : allEtfs;
    const first = queryEtfs(source, {
      category: next === "我的自选" ? "全部" : next,
      query,
      sort,
      order,
      cursor: 0,
      limit: 1,
    }).items[0];
    if (first) setSelectedSymbol(first.symbol);
  };

  const cycleSort = (field: EtfSortField) => {
    if (sort !== field) { setSort(field); setOrder("desc"); return; }
    if (order === "desc") { setOrder("asc"); return; }
    setSort("averageAmount20"); setOrder("desc");
  };

  const addToWatchlist = async (symbol: string) => {
    if (saving) return;
    setSaving(true);
    setMessage(`正在查询 ${symbol}…`);
    try {
      const response = await fetch("/api/v1/etfs/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const payload = await response.json() as { item?: EtfSnapshot; error?: string };
      if (!response.ok || !payload.item) throw new Error(payload.error ?? "添加失败");
      setWatchlist((items) => [payload.item!, ...items.filter((item) => item.symbol !== payload.item!.symbol)]);
      setSelectedSymbol(payload.item.symbol);
      setCategory("我的自选");
      setQuery("");
      setMessage(`${payload.item.name} 已加入我的自选`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ETF 添加失败");
    } finally {
      setSaving(false);
    }
  };

  const addByCode = async () => {
    if (!codeToAdd) return;
    await addToWatchlist(codeToAdd);
  };

  const removeFromWatchlist = async (symbol: string) => {
    const response = await fetch(`/api/v1/etfs/watchlist?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
    if (!response.ok) { setMessage("删除失败，请稍后重试"); return; }
    setWatchlist((items) => items.filter((item) => item.symbol !== symbol));
    setMessage(`${symbol} 已移出我的自选`);
  };

  const updateCategory = async (symbol: string, nextCategory: string) => {
    const previous = watchlist;
    setWatchlist((items) => items.map((item) => item.symbol === symbol ? { ...item, category: nextCategory } : item));
    const response = await fetch("/api/v1/etfs/watchlist", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol, category: nextCategory }),
    });
    if (!response.ok) { setWatchlist(previous); setMessage("分类保存失败，请重试"); return; }
    setMessage("自选分类已保存");
  };

  return (
    <div className="etf-workspace panel">
      <aside className="etf-category-rail">
        <div className="etf-category-title"><strong>ETF 全品类</strong><span>{marketCategoryCounts["全部"] ?? allEtfs.length} 只产品 · {watchlist.length} 只自选</span></div>
        <nav>{workspaceCategories.map((item) => <button key={item} type="button" className={category === item ? "active" : ""} onClick={() => chooseCategory(item)}><span>{item}</span><em>{counts[item]}</em></button>)}</nav>
      </aside>
      <section className="etf-list-panel">
        <div className="etf-list-head">
          <div><strong>{category}</strong><span>{category !== "我的自选" && searching ? "正在检索全市场…" : `当前 ${category === "我的自选" ? page.total : catalogTotal} 只 · 点击表头排序`}</span></div>
          <form className="etf-code-form" onSubmit={(event) => { event.preventDefault(); void addByCode(); }}>
            <label><Search size={13} /><input value={query} onChange={(event) => { setQuery(event.target.value); setMessage(""); }} inputMode="numeric" placeholder="搜索或输入六位代码" aria-label="搜索或输入 ETF 代码" /></label>
            {codeToAdd && <button type="submit" className="etf-add-button" disabled={saving}>{saving ? <LoaderCircle size={12} className="spin" /> : <Plus size={12} />}添加</button>}
          </form>
        </div>
        {(message || (category !== "我的自选" && searchError)) && <div className="etf-inline-message" role="status">{message || searchError}</div>}
        <EtfTable items={page.items} selected={selected?.symbol ?? ""} sort={sort} order={order} watchedSymbols={watchedSymbols} onSelect={(item) => setSelectedSymbol(item.symbol)} onSort={cycleSort} onRemove={(symbol) => void removeFromWatchlist(symbol)} />
      </section>
      {selected ? <EtfChart key={selected.symbol} etf={selected} isWatched={watchedSymbols.has(selected.symbol)} onCategoryChange={(next) => void updateCategory(selected.symbol, next)} onRemove={() => void removeFromWatchlist(selected.symbol)} onAdd={() => void addToWatchlist(selected.symbol)} addDisabled={saving} /> : <div className="etf-empty">暂无可显示的 ETF</div>}
    </div>
  );
}
