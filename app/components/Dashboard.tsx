"use client";

import { Activity, ArrowUpRight, BarChart3, BookOpen, CalendarDays, ChevronRight, CircleGauge, Database, Flame, Layers3, LogOut, Menu, RefreshCw, Search, Sparkles, Table2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BriefSection, MorningBrief } from "../../lib/ai/morning-brief";
import { formatBreadthRatio } from "../../lib/domain/metrics";
import type { Breadth, DailyReview, Quote } from "../../lib/domain/types";
import type { EtfSnapshot } from "../../lib/data/provider";
import type { HistoryRow } from "../../lib/history/query";
import { shouldPoll } from "../../lib/live/polling";
import { formatBeijingDateTime } from "../../lib/live/market-clock";
import { BREADTH_REFRESH_MS } from "../../lib/live/refresh-policy";
import { HistoryWorkspace } from "./history/HistoryWorkspace";
import type { HighDetail } from "../../lib/history/high-details";
import { EtfWorkspace } from "./etf/EtfWorkspace";
import { BriefDetailDrawer } from "./brief/BriefDetailDrawer";
import { BriefRegenerateButton } from "./brief/BriefRegenerateButton";
import { GlobalMarketClock } from "./data/GlobalMarketClock";
import { LiveDataStatus, type LiveDataState } from "./data/LiveDataStatus";

const nav = [
  { id: "overview", label: "今日总览", icon: CircleGauge },
  { id: "brief", label: "盘前早参", icon: BookOpen },
  { id: "breadth", label: "市场温度", icon: Activity },
  { id: "ladder", label: "连板梯队", icon: Layers3 },
  { id: "themes", label: "龙头与热点", icon: Flame },
  { id: "etfs", label: "行业 ETF", icon: BarChart3 },
  { id: "history", label: "历史日历", icon: CalendarDays },
];

const pct = (value: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

interface LiveMarketPayload {
  breadth: Breadth;
  source: string;
  status: Exclude<LiveDataState, "demo" | "failed">;
  message: string;
  universeSize: number;
  coveragePct: number;
  marketTime: string | null;
  receivedAt: string;
  isStale: boolean;
}

const statusViews: Record<DailyReview["status"], { label: string; detail: string; dot: string; pill: string }> = {
  complete: { label: "完整", detail: "国内行情已完成双源交叉校验", dot: "bg-emerald-400 shadow-[0_0_10px_#34d399]", pill: "border-emerald-400/15 bg-emerald-400/[0.07] text-emerald-300" },
  partial: { label: "部分", detail: "部分数据待交叉校验，请查看来源与时间", dot: "bg-amber-400 shadow-[0_0_10px_#f59e0b]", pill: "border-amber-400/15 bg-amber-400/[0.07] text-amber-300" },
  failed: { label: "失败", detail: "本次采集失败，数据暂缺且未使用旧值", dot: "bg-red-400 shadow-[0_0_10px_#f87171]", pill: "border-red-400/15 bg-red-400/[0.07] text-red-300" },
  demo: { label: "演示", detail: "演示模式，定时任务采集后自动替换", dot: "bg-orange-400 shadow-[0_0_10px_#fb923c]", pill: "border-orange-400/15 bg-orange-400/[0.07] text-orange-300" },
};

const briefStatusLabel = { complete: "完整", partial: "部分", failed: "失败" } as const;

function briefItemCount(section: BriefSection) {
  return section.blocks.reduce((count, block) => count + (block.type === "heading" ? 0 : block.type === "bullets" ? block.items.length : 1), 0);
}

function briefSourceCount(section: BriefSection) {
  const blockSourceIds = section.blocks.flatMap((block) => block.type === "heading" ? [] : block.type === "bullets" ? block.items.flatMap((item) => item.sourceIds) : block.sourceIds);
  return new Set([...section.sourceIds, ...blockSourceIds]).size;
}

export function Dashboard({ review, brief, etfs, history, highDetailsByDate, userName, canManageBrief }: { review: DailyReview; brief: MorningBrief | null; etfs: EtfSnapshot[]; history: HistoryRow[]; highDetailsByDate: Record<string, HighDetail[]>; userName: string; canManageBrief: boolean }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [briefSectionIndex, setBriefSectionIndex] = useState<number | null>(null);
  const [liveMarket, setLiveMarket] = useState<LiveMarketPayload | null>(null);
  const liveRequestInFlight = useRef(false);
  const closeBriefDrawer = useCallback(() => setBriefSectionIndex(null), []);
  const effectiveStatus: DailyReview["status"] = refreshError
    ? "failed"
    : review.status === "demo"
      ? "demo"
      : review.status !== "complete"
        ? review.status
        : liveMarket?.status ?? "complete";
  const statusView = statusViews[effectiveStatus];
  const persistedTotal = useMemo(() => review.breadth.at(-1) ?? { time: "15:00", rising: 0, falling: 0, flat: 0 }, [review]);
  const isLiveBreadthUsable = liveMarket !== null
    && !liveMarket.isStale
    && liveMarket.universeSize >= 5_000
    && liveMarket.coveragePct >= 95;
  const total = liveMarket
    ? isLiveBreadthUsable ? liveMarket.breadth : null
    : persistedTotal;
  const maxBreadth = Math.max(1, total?.rising ?? 0, total?.falling ?? 0, ...review.breadth.flatMap((item) => [item.rising, item.falling]));
  const ladder = [
    ["五板+", review.ladder.fivePlus], ["四板", review.ladder.fourth], ["三板", review.ladder.third], ["二板", review.ladder.second], ["首板", review.ladder.first],
  ] as Array<[string, Quote[]]>;
  const ladderHeight = Math.max(0, ...Object.values(review.ladder).flat().map((item) => item.limitStreak));
  const ladderNote = ladderHeight >= 2 ? `最高 ${ladderHeight}板` : "暂无连板";
  const activeSource = liveMarket?.source ?? review.source;
  const activeReceivedAt = liveMarket?.receivedAt ?? review.updatedAt;
  const marginBalanceValue = review.metrics.marginBalance === null ? "暂缺" : `${review.metrics.marginBalance.toLocaleString("zh-CN")}亿`;

  const refreshLiveBreadth = useCallback(async () => {
    if (liveRequestInFlight.current) return;
    liveRequestInFlight.current = true;
    try {
      const response = await fetch("/api/v1/market/live", { cache: "no-store" });
      const payload = await response.json() as Partial<LiveMarketPayload> & { error?: string };
      if (!response.ok || !payload.breadth || !payload.receivedAt) throw new Error(payload.error ?? payload.message ?? "实时市场数据更新失败");
      setLiveMarket(payload as LiveMarketPayload);
      setRefreshError("");
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "实时市场数据更新失败");
    } finally {
      liveRequestInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (shouldPoll({ visible: document.visibilityState === "visible", kind: "breadth", now: new Date() })) void refreshLiveBreadth();
    };
    refreshWhenVisible();
    const interval = window.setInterval(refreshWhenVisible, BREADTH_REFRESH_MS);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshLiveBreadth]);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError("");
    try {
      await refreshLiveBreadth();
      const response = await fetch("/api/v1/admin/jobs/close-review/run", { method: "POST" });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "收盘复盘刷新失败");
      router.refresh();
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "刷新失败，请稍后重试");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="dashboard-shell min-h-screen bg-[#090a0b] text-[#f3f0e9]">
      <aside className={`dashboard-sidebar ${menuOpen ? "is-open" : ""}`}>
        <div className="flex items-center justify-between px-5 pb-7 pt-6">
          <Link href="/" className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-full bg-[#e8702a] text-white"><Layers3 size={17} /></span><span className="font-display text-xl italic">PanLayer</span></Link>
          <button className="text-white/55 lg:hidden" onClick={() => setMenuOpen(false)} aria-label="关闭导航"><X size={20} /></button>
        </div>
        <p className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/30">Daily Review</p>
        <nav className="space-y-1 px-3">
          {nav.map(({ id, label, icon: Icon }, index) => <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)} className={`sidebar-link ${index === 0 ? "active" : ""}`}><Icon size={17} /><span>{label}</span><ChevronRight size={14} className="ml-auto opacity-0 transition group-hover:opacity-60" /></a>)}
        </nav>
        <div className="mt-auto px-4 pb-5">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-4">
            <div className="mb-2 flex items-center gap-2 text-xs text-white/45"><Database size={14} /> 数据状态</div>
            <div className="flex items-center gap-2 text-xs"><span className={`size-1.5 rounded-full ${statusView.dot}`} /><span>{statusView.label}</span></div>
            <p className="mt-2 text-[10px] leading-5 text-white/35">数据来源：{activeSource}</p>
            <p className="text-[10px] leading-5 text-white/25">更新时间：{formatBeijingDateTime(activeReceivedAt)}</p>
          </div>
          <div className="mt-4 flex items-center justify-between px-2 text-xs text-white/40"><span className="truncate">{userName}</span><Link href="/signout-with-chatgpt?return_to=/" aria-label="退出"><LogOut size={15} /></Link></div>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-topbar">
          <button className="grid size-9 place-items-center rounded-full border border-white/10 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="打开导航"><Menu size={18} /></button>
          <div className="hidden items-center gap-2 text-sm text-white/40 sm:flex"><CalendarDays size={16} /><span>{review.date}</span><span className="mx-2 text-white/10">/</span><span>收盘复盘</span></div>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden xl:block"><LiveDataStatus label="市场" source={liveMarket?.source ?? review.source} status={refreshError ? "failed" : liveMarket?.status ?? review.status} marketTime={liveMarket?.marketTime ?? null} receivedAt={liveMarket?.receivedAt ?? review.updatedAt} isStale={Boolean(refreshError) || (liveMarket?.isStale ?? review.status === "demo")} error={refreshError} /></div>
            <label className="hidden items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.035] px-4 py-2 text-xs text-white/35 md:flex"><Search size={14} /><input className="w-32 bg-transparent outline-none placeholder:text-white/25" placeholder="搜索指标或板块" /></label>
            <button onClick={refresh} disabled={refreshing} title={refreshError || undefined} className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs text-white/65 transition hover:bg-white/[0.06] disabled:cursor-wait disabled:opacity-60"><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />{refreshing ? "刷新中" : "刷新数据"}</button>
          </div>
        </header>
        <GlobalMarketClock
          source={liveMarket?.source ?? review.source}
          status={refreshError ? "failed" : liveMarket?.status ?? review.status}
          marketTime={liveMarket?.marketTime ?? `${review.date}T15:00:00+08:00`}
          receivedAt={liveMarket?.receivedAt ?? (review.updatedAt.includes("T") ? review.updatedAt : `${review.updatedAt.replace(" ", "T")}:00+08:00`)}
          error={refreshError}
        />

        <div className="dashboard-content">
          <section id="overview" className="scroll-mt-24">
            <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div><div className="mb-3 flex items-center gap-2 text-xs font-medium text-[#e8702a]"><span className="size-1.5 rounded-full bg-[#e8702a]" /> AFTER MARKET · 16:10</div><h1 className="text-3xl font-medium tracking-[-0.04em] sm:text-4xl">今日市场，层层拆开。</h1><p className="mt-3 text-sm text-white/42">复盘交易日 {review.date} · {liveMarket ? `实时接收 ${formatBeijingDateTime(liveMarket.receivedAt)}` : `复盘更新 ${formatBeijingDateTime(review.updatedAt)}`} · 数据来源 {activeSource}</p><p className="mt-2 text-[11px] text-white/25">统计范围：沪深京全 A，剔除 ST{liveMarket ? ` · 实时覆盖 ${liveMarket.universeSize.toLocaleString("zh-CN")} 只（${liveMarket.coveragePct.toFixed(2)}%）` : ""} · 状态口径：完整 / 部分 / 失败 / 演示{refreshError ? ` · 更新失败：${refreshError}` : ""}</p></div>
              <div className={`rounded-full border px-4 py-2 text-xs ${statusView.pill}`}>{statusView.label} · {statusView.detail}</div>
            </div>

            <div className="metric-grid">
              <Metric label="上涨家数" value={total === null ? "暂缺" : String(total.rising)} note={total === null ? "实时行情覆盖不足" : `下跌 ${total.falling}`} />
              <Metric label="涨停数量" value={String(review.metrics.limitUp)} note={`跌停 ${review.metrics.limitDown}`} />
              <Metric label="连板家数" value={String(review.metrics.consecutive)} note={ladderNote} />
              <Metric label="历史新高" value={review.metrics.allTimeHigh === null ? "暂缺" : String(review.metrics.allTimeHigh)} note={review.metrics.high120 === null ? "120日新高 数据暂缺" : `120日新高 ${review.metrics.high120}`} />
              <Metric label="连板收盘溢价" value={pct(review.premium.closePct)} note={`开盘 ${pct(review.premium.openPct)}`} accent />
              <Metric label="两融余额" value={marginBalanceValue} note="沪深京融资余额" />
            </div>
          </section>

          <section className="dashboard-section grid gap-5 xl:grid-cols-[1.5fr_1fr]">
            <Panel title="盘中涨跌家数" eyebrow="MARKET BREADTH" id="breadth">
              <div className="h-[270px] pt-3"><ResponsiveContainer width="100%" height="100%"><AreaChart data={review.breadth}><defs><linearGradient id="rise" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef5b58" stopOpacity={0.34}/><stop offset="95%" stopColor="#ef5b58" stopOpacity={0}/></linearGradient><linearGradient id="fall" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3bc987" stopOpacity={0.2}/><stop offset="95%" stopColor="#3bc987" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false}/><XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,.35)", fontSize: 11 }}/><YAxis axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,.28)", fontSize: 11 }} width={36}/><Tooltip contentStyle={{ background: "#151617", border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, fontSize: 12 }}/><Area type="monotone" dataKey="rising" name="上涨" stroke="#ef5b58" strokeWidth={2} fill="url(#rise)"/><Area type="monotone" dataKey="falling" name="下跌" stroke="#3bc987" strokeWidth={2} fill="url(#fall)"/></AreaChart></ResponsiveContainer></div>
            </Panel>
            <Panel title="市场温度" eyebrow="CLOSE SNAPSHOT">
              {total === null
                ? <div className="grid min-h-40 place-items-center text-sm text-white/30">实时行情覆盖不足，市场温度暂不计算</div>
                : <div className="space-y-5 pt-4"><BreadthBar label="上涨" value={total.rising} max={maxBreadth} color="#ef5b58"/><BreadthBar label="下跌" value={total.falling} max={maxBreadth} color="#3bc987"/><BreadthBar label="平盘" value={total.flat} max={maxBreadth} color="#8b8d90"/></div>}
              <div className="mt-8 grid grid-cols-2 gap-3"><MiniStat label="大涨股" value={review.metrics.largeRise}/><MiniStat label="涨跌比" value={total === null ? "暂缺" : formatBreadthRatio(total.rising, total.falling)}/></div>
            </Panel>
          </section>

          <section id="brief" className="dashboard-section scroll-mt-24" data-can-manage-brief={canManageBrief ? "true" : "false"}>
            <div className="brief-heading-row"><SectionHeading eyebrow="07:15 · AI MORNING BRIEF" title="隔夜早参" description="固定五模块，事实带来源，不荐股。" />{canManageBrief && <BriefRegenerateButton />}</div>
            {brief
              ? <><div className="brief-grid">{brief.sections.map((section, index) => <button type="button" key={section.key} className={`brief-card ${index === 0 ? "brief-card-featured" : ""}`} onClick={() => setBriefSectionIndex(index)} aria-label={`打开早参详情：${section.title}`}><div className="brief-card-top"><span>0{index + 1}</span><span className={`brief-card-status is-${section.status}`}>{briefStatusLabel[section.status]}</span><Sparkles size={15} aria-hidden="true"/></div><h3>{section.title}</h3><p className="brief-card-summary">{section.summary}</p><div className="brief-tags">{section.tags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}</div><div className="brief-card-meta"><span>{briefItemCount(section)} 条</span><span>{briefSourceCount(section)} 个来源</span><span>{section.generatedAt.slice(11, 16)} 生成</span></div><span className="brief-card-action">打开详情 <ArrowUpRight size={11}/></span></button>)}</div><BriefDetailDrawer brief={brief} section={briefSectionIndex === null ? null : brief.sections[briefSectionIndex] ?? null} sectionIndex={briefSectionIndex ?? 0} onClose={closeBriefDrawer} /></>
              : <div className="brief-unavailable panel grid min-h-40 place-items-center p-6 text-center"><div><p className="text-base text-white/70">当天早参尚未生成</p><p className="mt-2 text-xs text-white/35">暂不可用，生成后将显示五个模块。</p></div></div>}
          </section>

          <section id="ladder" className="dashboard-section scroll-mt-24">
            <SectionHeading eyebrow="LIMIT-UP LADDER" title="连板梯队" description="按连续封板高度、首次封板时间和成交额客观排序。" />
            <div className="ladder-stack">{ladder.map(([label, items]) => <div key={label} className="ladder-row"><div className="ladder-label"><span>{label}</span><strong>{items.length}</strong></div><div className="ladder-items">{items.length === 0 ? <span className="text-xs text-white/20">暂无</span> : items.map((item) => <div key={item.symbol} className="stock-chip"><div><strong>{item.name}</strong><span>{item.symbol.split(".")[0]} · {item.sector}</span></div><em>{pct(item.pctChange)}</em></div>)}</div></div>)}</div>
          </section>

          <section id="themes" className="dashboard-section grid scroll-mt-24 gap-5 xl:grid-cols-2">
            <Panel title="热点板块" eyebrow="SECTOR HEAT"><DataTable headers={["板块", "涨停", "均涨幅", "成交增量", "高度"]}>{review.sectors.map((item) => <tr key={item.name}><td className="font-medium text-white/85">{item.name}</td><td className="rise">{item.limitUpCount}</td><td className="rise">{pct(item.averagePct)}</td><td>{pct(item.amountGrowthPct)}</td><td>{item.maxStreak}板</td></tr>)}</DataTable></Panel>
            <Panel title="客观龙头" eyebrow="LEADER BOARD"><DataTable headers={["股票", "题材", "连板", "涨幅"]}>{review.leaders.map((item) => <tr key={item.symbol}><td><strong className="block text-white/85">{item.name}</strong><span className="text-[10px] text-white/25">{item.symbol}</span></td><td>{item.sector}</td><td>{item.limitStreak}板</td><td className="rise">{pct(item.pctChange)}</td></tr>)}</DataTable></Panel>
          </section>

          <section id="etfs" className="dashboard-section scroll-mt-24">
            <SectionHeading eyebrow="ETF TERMINAL" title="ETF 专业工作台" description="输入六位代码加入个人自选，支持分类、排序和四周期 K 线。" />
            <EtfWorkspace initialEtfs={etfs} />
          </section>

          <section id="history" className="dashboard-section scroll-mt-24 pb-10">
            <SectionHeading eyebrow="DAILY ARCHIVE" title="历史日历" description="像 Excel 一样排序、滚动并回看每个交易日。" />
            <HistoryWorkspace initialRows={history} highDetailsByDate={highDetailsByDate} />
          </section>

          <footer className="flex flex-col justify-between gap-3 border-t border-white/[0.06] py-6 text-[11px] text-white/25 sm:flex-row"><span>PanLayer · 盘层 © 2026</span><span>仅供市场复盘，不构成投资建议。</span></footer>
        </div>
      </main>
    </div>
  );
}

function Metric({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) { return <div className={`metric-card ${accent ? "metric-card-accent" : ""}`}><span className="text-xs text-white/35">{label}</span><div className="mt-5"><strong className="text-2xl font-medium tracking-[-0.04em]">{value}</strong></div><p className="mt-3 text-[11px] text-white/25">{note}</p></div> }
function Panel({ title, eyebrow, id, children }: { title: string; eyebrow: string; id?: string; children: React.ReactNode }) { return <div id={id} className="panel scroll-mt-24 p-5 sm:p-6"><div className="flex items-center justify-between"><div><p className="text-[9px] font-semibold tracking-[0.2em] text-[#e8702a]">{eyebrow}</p><h3 className="mt-2 text-lg font-medium">{title}</h3></div><Table2 size={17} className="text-white/15"/></div>{children}</div> }
function BreadthBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) { return <div><div className="mb-2 flex items-center justify-between text-xs"><span className="text-white/40">{label}</span><strong>{value.toLocaleString()}</strong></div><div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full" style={{ width: `${value / max * 100}%`, background: color }}/></div></div> }
function MiniStat({ label, value }: { label: string; value: string | number }) { return <div className="rounded-2xl bg-white/[0.035] p-4"><span className="text-[10px] text-white/30">{label}</span><strong className="mt-2 block text-lg">{value}</strong></div> }
function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div className="mb-6"><p className="text-[9px] font-semibold tracking-[0.22em] text-[#e8702a]">{eyebrow}</p><div className="mt-2 flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><h2 className="text-2xl font-medium tracking-[-0.04em]">{title}</h2><p className="text-xs text-white/35">{description}</p></div></div> }
function DataTable({ headers, children }: { headers: string[]; children: React.ReactNode }) { return <div className="data-table-wrap"><table className="data-table"><thead><tr>{headers.map((header)=><th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div> }
