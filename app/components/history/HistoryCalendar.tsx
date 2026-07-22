"use client";

import { useMemo, useState } from "react";

export function HistoryCalendar({ dates, selected, onSelect }: { dates: string[]; selected: string; onSelect: (date: string) => void }) {
  const [month, setMonth] = useState(selected.slice(0, 7));
  const available = useMemo(() => new Set(dates), [dates]);

  const [year, monthNumber] = month.split("-").map(Number);
  const firstWeekday = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cells = [...Array.from({ length: firstWeekday }, () => 0), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];

  const moveMonth = (offset: number) => {
    const next = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
    setMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`);
  };

  return (
    <aside className="history-calendar" aria-label="历史复盘日历">
      <div className="history-calendar-head">
        <button type="button" onClick={() => moveMonth(-1)} aria-label="上一个月">‹</button>
        <strong>{year}年 {monthNumber}月</strong>
        <button type="button" onClick={() => moveMonth(1)} aria-label="下一个月">›</button>
      </div>
      <div className="calendar-grid">
        {["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day} className="calendar-week">{day}</span>)}
        {cells.map((day, index) => {
          if (!day) return <span key={`empty-${index}`} />;
          const date = `${month}-${String(day).padStart(2, "0")}`;
          const hasData = available.has(date);
          const weekend = index % 7 > 4;
          return (
            <button
              key={date}
              type="button"
              disabled={!hasData}
              onClick={() => onSelect(date)}
              className={`calendar-day ${weekend ? "weekend" : ""} ${date === selected ? "selected" : ""} ${hasData ? "has-data" : ""}`}
              aria-label={`${date}${hasData ? " 有复盘数据" : " 无复盘数据"}`}
            >{day}</button>
          );
        })}
      </div>
      <div className="mt-5 flex items-center gap-2 text-[10px] text-white/28"><span className="size-1.5 rounded-full bg-[#e8702a]" />有数据的交易日可点击定位</div>
    </aside>
  );
}
