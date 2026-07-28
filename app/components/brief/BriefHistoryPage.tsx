"use client";

import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Database,
  HardDrive,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MorningBrief } from "../../../lib/ai/morning-brief-contract";
import {
  pruneBriefArchive,
  summarizeMorningBrief,
  type MorningBriefArchiveSummary,
} from "../../../lib/ai/morning-brief-archive";
import {
  readLocalBriefArchive,
  syncBriefArchiveToLocal,
} from "../../../lib/client/brief-local-cache";
import { BriefDetailDrawer } from "./BriefDetailDrawer";

const statusLabel = { complete: "完整", partial: "部分", failed: "失败" } as const;
const weekDays = ["一", "二", "三", "四", "五", "六", "日"];

function daysInMonth(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  return {
    year,
    month,
    cells: [
      ...Array.from({ length: offset }, () => null),
      ...Array.from({ length: count }, (_, index) => index + 1),
    ],
  };
}

function shiftMonth(monthKey: string, step: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1 + step, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function archiveEndDate(cutoffDate: string) {
  const value = new Date(`${cutoffDate}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 92);
  return value.toISOString().slice(0, 10);
}

function moduleSeries(summary: MorningBriefArchiveSummary) {
  return summary.modules.map((module, index) => ({
    module: String(index + 1).padStart(2, "0"),
    items: module.itemCount,
    sources: module.sourceCount,
  }));
}

function BriefProfileChart({ summary }: { summary: MorningBriefArchiveSummary }) {
  const data = moduleSeries(summary);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 12, bottom: 4, left: -25 }}>
        <CartesianGrid vertical={false} stroke="rgba(255,255,255,.045)" />
        <XAxis dataKey="module" axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,.25)", fontSize: 8 }} />
        <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,.18)", fontSize: 8 }} />
        <Tooltip
          contentStyle={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, background: "#111315", fontSize: 9 }}
          labelFormatter={(label) => `模块 ${label}`}
          formatter={(value, name) => [String(value), name === "items" ? "有效内容" : "引用来源"]}
        />
        <Line type="monotone" dataKey="items" name="有效内容" stroke="#e8702a" strokeWidth={2} dot={{ r: 2, fill: "#e8702a" }} isAnimationActive={false} />
        <Line type="monotone" dataKey="sources" name="引用来源" stroke="#6f94ba" strokeWidth={1.4} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function BriefArchiveCalendar({
  summaries,
  selectedDate,
  onSelect,
}: {
  summaries: MorningBriefArchiveSummary[];
  selectedDate: string;
  onSelect: (date: string) => void;
}) {
  const availableDates = useMemo(() => new Set(summaries.map((item) => item.date)), [summaries]);
  const [monthKey, setMonthKey] = useState(() => selectedDate.slice(0, 7));
  const month = daysInMonth(monthKey);
  return (
    <aside className="brief-history-calendar" aria-label="盘前早参日历">
      <div className="brief-history-calendar-title">
        <CalendarDays size={17} />
        <div><strong>早参日历</strong><span>橙点表示本机或云端已有记录</span></div>
      </div>
      <div className="brief-history-month">
        <button type="button" onClick={() => setMonthKey((value) => shiftMonth(value, -1))} aria-label="上一个月"><ChevronLeft size={17} /></button>
        <strong>{month.year}年 {month.month}月</strong>
        <button type="button" onClick={() => setMonthKey((value) => shiftMonth(value, 1))} aria-label="下一个月"><ChevronRight size={17} /></button>
      </div>
      <div className="brief-history-weekdays">{weekDays.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="brief-history-days">
        {month.cells.map((day, index) => {
          if (day === null) return <span key={`empty-${index}`} />;
          const date = `${monthKey}-${String(day).padStart(2, "0")}`;
          const available = availableDates.has(date);
          return (
            <button
              type="button"
              key={date}
              className={`${date === selectedDate ? "active" : ""} ${available ? "has-data" : ""}`}
              disabled={!available}
              onClick={() => onSelect(date)}
              aria-label={`${date}${available ? "，已有早参" : "，暂无早参"}`}
            >
              {day}
            </button>
          );
        })}
      </div>
      <div className="brief-history-calendar-foot"><i />仅列出最近三个月已保存的真实早参</div>
    </aside>
  );
}

export function BriefHistoryPage({
  initialBriefs,
  cutoffDate,
}: {
  initialBriefs: MorningBrief[];
  cutoffDate: string;
}) {
  const [briefs, setBriefs] = useState(() => pruneBriefArchive(initialBriefs, cutoffDate));
  const [selectedDate, setSelectedDate] = useState(() => briefs[0]?.date ?? archiveEndDate(cutoffDate));
  const [expandedDate, setExpandedDate] = useState<string | null>(() => briefs[0]?.date ?? null);
  const [detail, setDetail] = useState<{ brief: MorningBrief; sectionIndex: number } | null>(null);
  const [localStatus, setLocalStatus] = useState<"syncing" | "complete" | "failed">("syncing");
  const [localCount, setLocalCount] = useState(0);

  useEffect(() => {
    let active = true;
    async function sync() {
      try {
        const cached = await readLocalBriefArchive(cutoffDate);
        const merged = pruneBriefArchive(
          Array.from(new Map([...initialBriefs, ...cached].map((brief) => [brief.date, brief])).values()),
          cutoffDate,
        );
        if (active) setBriefs(merged);
        const count = await syncBriefArchiveToLocal(merged, cutoffDate);
        if (active) {
          setLocalCount(count);
          setLocalStatus("complete");
        }
      } catch {
        if (active) setLocalStatus("failed");
      }
    }
    void sync();
    return () => { active = false; };
  }, [cutoffDate, initialBriefs]);

  const summaries = useMemo(() => briefs.map(summarizeMorningBrief), [briefs]);
  const scrollToDate = (date: string) => {
    setSelectedDate(date);
    setExpandedDate(date);
    requestAnimationFrame(() => document.getElementById(`brief-history-${date}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <main className="brief-history-page">
      <header className="brief-history-topbar">
        <Link href="/dashboard#brief" aria-label="返回盘前早参"><ArrowLeft size={18} /></Link>
        <div><p>PANLAYER · MORNING BRIEF ARCHIVE</p><h1>盘前早参历史</h1></div>
        <div className={`brief-local-status is-${localStatus}`}>
          <HardDrive size={15} />
          <span>{localStatus === "syncing" ? "正在保存到本机" : localStatus === "complete" ? `本机已保存 ${localCount} 天` : "本机保存暂不可用"}</span>
        </div>
      </header>

      <section className="brief-history-intro">
        <div><strong>近三个月</strong><span>{cutoffDate} 起 · 按日期从新到旧排列</span></div>
        <div><Cloud size={14} /><span>云端 D1 为正式记录</span><Database size={14} /><span>浏览器 IndexedDB 保存本机副本</span></div>
      </section>

      <div className="brief-history-layout">
        <BriefArchiveCalendar summaries={summaries} selectedDate={selectedDate} onSelect={scrollToDate} />
        <section className="brief-history-stream" aria-label="盘前早参历史列表">
          <div className="brief-history-stream-head">
            <div><p>DAILY ARCHIVE</p><h2>每日早参切片</h2></div>
            <span>{summaries.length} 个有数据日期 · 非交易日自动跳过</span>
          </div>
          {summaries.length === 0
            ? <div className="brief-history-empty"><CalendarDays size={24} /><strong>最近三个月暂无已验证早参</strong><span>生成并落库后会自动出现在这里。</span></div>
            : <div className="brief-history-list">{summaries.map((summary) => {
              const brief = briefs.find((item) => item.date === summary.date)!;
              const expanded = expandedDate === summary.date;
              return (
                <article id={`brief-history-${summary.date}`} className={`brief-history-row ${summary.date === selectedDate ? "is-selected" : ""}`} key={summary.date}>
                  <button type="button" className="brief-history-row-main" onClick={() => { setSelectedDate(summary.date); setExpandedDate(expanded ? null : summary.date); }} aria-expanded={expanded}>
                    <div className="brief-history-date">
                      <time>{summary.date}</time>
                      <span className={`brief-history-status is-${summary.status}`}>{statusLabel[summary.status]}</span>
                      <small>{summary.schemaVersion === 3 ? "V3 七模块" : "V2 兼容记录"}</small>
                    </div>
                    <div className="brief-history-profile">
                      <BriefProfileChart summary={summary} />
                    </div>
                    <div className="brief-history-row-stats">
                      <div><span>模块</span><strong>{summary.completeModules}/{summary.modules.length}</strong></div>
                      <div><span>来源</span><strong>{summary.sourceCount}</strong></div>
                      <div><span>核验</span><strong>{summary.verifiedFacts ?? "—"}</strong></div>
                      <ChevronDown size={17} className={expanded ? "rotate" : ""} />
                    </div>
                  </button>
                  {expanded && <div className="brief-history-expanded">
                    <div className="brief-history-module-grid">
                      {brief.sections.map((section, index) => (
                        <button type="button" key={section.key} onClick={() => setDetail({ brief, sectionIndex: index })}>
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <strong>{section.title}</strong>
                          <small>{section.summary}</small>
                        </button>
                      ))}
                    </div>
                    <p>生成时间 {brief.generatedAt.slice(0, 16).replace("T", " ")} · {brief.disclaimer}</p>
                  </div>}
                </article>
              );
            })}</div>}
        </section>
      </div>

      {detail && <BriefDetailDrawer
        brief={detail.brief}
        section={detail.brief.sections[detail.sectionIndex] ?? null}
        sectionIndex={detail.sectionIndex}
        onClose={() => setDetail(null)}
      />}
    </main>
  );
}
