"use client";

import { Maximize2, Minimize2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BriefSection, MorningBrief } from "../../../lib/ai/morning-brief";
import { briefBlockId, BriefBlockRenderer } from "./BriefBlockRenderer";

export function BriefDetailDrawer({ brief, section, sectionIndex, onClose }: { brief: MorningBrief; section: BriefSection | null; sectionIndex: number; onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const fullscreenRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isOpen = section !== null;
  const headings = useMemo(() => section?.blocks.flatMap((block, index) => block.type === "heading" ? [{ id: briefBlockId(section, index), text: block.text }] : []) ?? [], [section]);

  const setFullscreen = (value: boolean) => {
    fullscreenRef.current = value;
    setIsFullscreen(value);
  };
  const handleClose = useCallback(() => {
    setFullscreen(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (fullscreenRef.current) setFullscreen(false);
        else handleClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')).filter((element) => !element.hasAttribute("aria-hidden"));
      if (focusable.length === 0) return;
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && currentIndex <= 0) { event.preventDefault(); focusable.at(-1)?.focus(); }
      if (!event.shiftKey && currentIndex === focusable.length - 1) { event.preventDefault(); focusable[0].focus(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => { document.body.style.overflow = oldOverflow; window.removeEventListener("keydown", handleKeyDown); previouslyFocused?.focus(); };
  }, [isOpen, handleClose]);

  if (!section) return null;

  return (
    <div className="brief-drawer-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) handleClose(); }}>
      <aside ref={dialogRef} className={`brief-drawer ${isFullscreen ? "is-fullscreen" : ""}`} role="dialog" aria-modal="true" aria-labelledby="brief-drawer-title" aria-describedby="brief-drawer-summary">
        <header className="brief-drawer-header">
          <div><p>AI MORNING BRIEF · {String(sectionIndex + 1).padStart(2, "0")}</p><h3 id="brief-drawer-title">{section.title}</h3><span id="brief-drawer-summary">{brief.date} · {section.status === "complete" ? "内容已完成" : "部分内容暂缺"}</span></div>
          <div className="brief-drawer-actions">
            <button type="button" className="brief-drawer-expand" onClick={() => setFullscreen(!isFullscreen)} aria-label={isFullscreen ? "退出全屏早参详情" : "全屏查看早参详情"} aria-pressed={isFullscreen} title={isFullscreen ? "退出全屏" : "放大全屏"}>{isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
            <button ref={closeButtonRef} type="button" className="brief-drawer-close" onClick={handleClose} aria-label="关闭早参详情"><X size={18} /></button>
          </div>
        </header>
        <div className="brief-drawer-layout">
          {headings.length > 0 && <nav className="brief-drawer-outline" aria-label="本模块目录">{headings.map((heading) => <a key={heading.id} href={`#${heading.id}`}>{heading.text}</a>)}</nav>}
          <div className="brief-drawer-body"><BriefBlockRenderer brief={brief} section={section} /></div>
        </div>
        <footer className="brief-drawer-footer"><span>{brief.sources.length} 个联网来源{brief.coverage ? ` · 已核验事实 ${brief.coverage.verifiedFacts} · 交叉核验 ${brief.coverage.crossCheckedFacts}` : ""}</span><span>{brief.disclaimer}</span></footer>
      </aside>
    </div>
  );
}
