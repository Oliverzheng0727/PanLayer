"use client";

import { ArrowUpRight, Clock3, X } from "lucide-react";
import { useEffect } from "react";
import { resolveBriefSources, type LegacyMorningBrief } from "../../../lib/ai/morning-brief";

type BriefSection = LegacyMorningBrief["sections"][number];

export function BriefDetailDrawer({
  brief,
  section,
  sectionIndex,
  onClose,
}: {
  brief: LegacyMorningBrief;
  section: BriefSection | null;
  sectionIndex: number;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!section) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, section]);

  if (!section) return null;

  return (
    <div className="brief-drawer-overlay" role="presentation" onClick={onClose}>
      <aside className="brief-drawer" role="dialog" aria-modal="true" aria-labelledby="brief-drawer-title" onClick={(event) => event.stopPropagation()}>
        <header className="brief-drawer-header">
          <div>
            <p>AI MORNING BRIEF · 0{sectionIndex + 1}</p>
            <h3 id="brief-drawer-title">{section.title}</h3>
            <span>{brief.date} · 事实来源可核验</span>
          </div>
          <button type="button" className="brief-drawer-close" onClick={onClose} aria-label="关闭早参详情"><X size={18} /></button>
        </header>

        <div className="brief-drawer-body">
          {section.items.map((item, itemIndex) => {
            const sources = resolveBriefSources(brief, item);
            return (
              <article key={`${itemIndex}-${item.text}`} className="brief-detail-item">
                <div className="brief-detail-index">{String(itemIndex + 1).padStart(2, "0")}</div>
                <p>{item.text}</p>
                <div className="brief-source-list">
                  {sources.length ? sources.map((source) => (
                    <a key={source.id} href={source.url} target="_blank" rel="noreferrer" aria-label={`打开来源：${source.title}`}>
                      <span><ArrowUpRight size={12} />{source.title}</span>
                      <small><Clock3 size={10} />{source.publishedAt || "发布时间未提供"}</small>
                    </a>
                  )) : <span className="brief-source-missing">该条目的来源暂缺，未提供占位链接。</span>}
                </div>
              </article>
            );
          })}
        </div>

        <footer className="brief-drawer-footer">
          <span>{brief.sources.length} 个联网来源</span>
          <span>{brief.disclaimer}</span>
        </footer>
      </aside>
    </div>
  );
}
