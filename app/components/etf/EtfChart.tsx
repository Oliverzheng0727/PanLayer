"use client";

import { CandlestickSeries, ColorType, HistogramSeries, createChart, type Time, type UTCTimestamp } from "lightweight-charts";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createDemoBars, type Adjustment, type BarPeriod, type MarketBar } from "../../../lib/etf/bars";
import { ETF_CATEGORIES } from "../../../lib/etf/catalog";
import type { EtfSnapshot } from "../../../lib/data/provider";

const periods: Array<{ value: BarPeriod; label: string }> = [{ value: "minute", label: "分时" }, { value: "day", label: "日K" }, { value: "week", label: "周K" }, { value: "month", label: "月K" }];

const chartTime = (time: string): Time => time.includes(" ")
  ? Math.floor(new Date(`${time.replace(" ", "T")}:00+08:00`).getTime() / 1000) as UTCTimestamp
  : time.slice(0, 10) as Time;

export function EtfChart({ etf, isWatched, onCategoryChange, onRemove }: {
  etf: EtfSnapshot;
  isWatched: boolean;
  onCategoryChange: (category: string) => void;
  onRemove: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [period, setPeriod] = useState<BarPeriod>("day");
  const [adjustment, setAdjustment] = useState<Adjustment>("forward");
  const [bars, setBars] = useState<MarketBar[]>(() => createDemoBars(etf.symbol, "day", etf.price));
  const [source, setSource] = useState("本机演示行情");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/etfs/${etf.symbol}/bars?period=${period}&adjust=${adjustment}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("bars failed")))
      .then((payload: { bars?: MarketBar[]; source?: string }) => {
        if (!cancelled && payload.bars?.length) { setBars(payload.bars); setSource(payload.source ?? "行情源"); }
      })
      .catch(() => { if (!cancelled) { setBars(createDemoBars(etf.symbol, period, etf.price)); setSource("本机演示行情"); } });
    return () => { cancelled = true; };
  }, [adjustment, etf.price, etf.symbol, period]);

  useEffect(() => {
    if (!container.current) return;
    const chartSize = () => ({ width: container.current?.clientWidth ?? 0, height: container.current?.clientHeight || 440 });
    const chart = createChart(container.current, {
      ...chartSize(),
      layout: { background: { type: ColorType.Solid, color: "#0e1012" }, textColor: "rgba(255,255,255,.34)", fontSize: 10 },
      grid: { vertLines: { color: "rgba(255,255,255,.04)" }, horzLines: { color: "rgba(255,255,255,.04)" } },
      rightPriceScale: { borderColor: "rgba(255,255,255,.06)" },
      timeScale: { borderColor: "rgba(255,255,255,.06)", timeVisible: period === "minute", secondsVisible: false },
      crosshair: { vertLine: { color: "rgba(232,112,42,.35)" }, horzLine: { color: "rgba(232,112,42,.35)" } },
    });
    const candles = chart.addSeries(CandlestickSeries, { upColor: "#ef5b58", downColor: "#3bc987", borderUpColor: "#ef5b58", borderDownColor: "#3bc987", wickUpColor: "#ef5b58", wickDownColor: "#3bc987" });
    candles.setData(bars.map((bar) => ({ time: chartTime(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close })));
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "", color: "rgba(232,112,42,.24)" });
    volume.priceScale().applyOptions({ scaleMargins: { top: .82, bottom: 0 } });
    volume.setData(bars.map((bar) => ({ time: chartTime(bar.time), value: bar.volume, color: bar.close >= bar.open ? "rgba(239,91,88,.28)" : "rgba(59,201,135,.24)" })));
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(() => { if (container.current) chart.applyOptions(chartSize()); });
    observer.observe(container.current);
    return () => { observer.disconnect(); chart.remove(); };
  }, [bars, period]);

  return (
    <div className="etf-chart-panel">
      <div className="etf-chart-head">
        <div><p>{etf.category} · {etf.exchange}</p><h3>{etf.name} <span>{etf.symbol}</span></h3></div>
        <div className="etf-chart-price"><strong>{etf.price.toFixed(3)}</strong><span className={etf.pctChange >= 0 ? "rise" : "fall"}>{etf.pctChange > 0 ? "+" : ""}{etf.pctChange.toFixed(2)}%</span></div>
      </div>
      <div className="etf-chart-controls">
        <div>{periods.map((item) => <button key={item.value} type="button" className={period === item.value ? "active" : ""} onClick={() => setPeriod(item.value)}>{item.label}</button>)}</div>
        <div className="etf-chart-actions">
          {isWatched && <><label>分类<select value={etf.category} onChange={(event) => onCategoryChange(event.target.value)}>{ETF_CATEGORIES.filter((item) => item !== "全部").map((item) => <option key={item} value={item}>{item}</option>)}</select></label><button type="button" className="etf-remove-button" onClick={onRemove} title="移出我的自选"><Trash2 size={11} />移除</button></>}
          <button type="button" className={adjustment === "forward" ? "active" : ""} onClick={() => setAdjustment((value) => value === "forward" ? "none" : "forward")}>{adjustment === "forward" ? "前复权" : "不复权"}</button>
        </div>
      </div>
      <div ref={container} className="etf-chart-canvas" />
      <div className="etf-chart-foot"><span>十字光标 · 缩放浏览</span><span>{source} · 成交量同步显示</span></div>
    </div>
  );
}
