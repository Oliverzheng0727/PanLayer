"use client";

import { CandlestickSeries, ColorType, HistogramSeries, createChart, type Time, type UTCTimestamp } from "lightweight-charts";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Adjustment, type BarPeriod, type MarketBar } from "../../../lib/etf/bars";
import { ETF_CATEGORIES } from "../../../lib/etf/catalog";
import type { EtfSnapshot } from "../../../lib/data/provider";
import { LiveDataStatus, type LiveDataState } from "../data/LiveDataStatus";

const periods: Array<{ value: BarPeriod; label: string }> = [{ value: "minute", label: "分时" }, { value: "day", label: "日K" }, { value: "week", label: "周K" }, { value: "month", label: "月K" }];
const emptyBars: MarketBar[] = [];

const chartTime = (time: string): Time => time.includes(" ")
  ? Math.floor(new Date(`${time.replace(" ", "T")}:00+08:00`).getTime() / 1000) as UTCTimestamp
  : time.slice(0, 10) as Time;

interface EtfChartPayload {
  requestKey: string;
  bars: MarketBar[];
  source: string;
  fallbackSource: string | null;
  status: LiveDataState;
  marketTime: string | null;
  receivedAt: string | null;
  requestedPeriod: BarPeriod;
  appliedPeriod: BarPeriod | null;
  requestedAdjustment: Adjustment;
  appliedAdjustment: Adjustment | null;
  message: string;
  error: string;
}

const periodLabel = (period: BarPeriod | null) => periods.find((item) => item.value === period)?.label ?? "暂缺";
const adjustmentLabel = (adjustment: Adjustment | null) => adjustment === "forward" ? "前复权" : adjustment === "none" ? "不复权" : "暂缺";

export function EtfChart({ etf, isWatched = false, onCategoryChange, onRemove, onAdd, addDisabled = false }: {
  etf: EtfSnapshot;
  isWatched?: boolean;
  onCategoryChange?: (category: string) => void;
  onRemove?: () => void;
  onAdd?: () => void;
  addDisabled?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [period, setPeriod] = useState<BarPeriod>("day");
  const [adjustment, setAdjustment] = useState<Adjustment>("forward");
  const [payload, setPayload] = useState<EtfChartPayload | null>(null);
  const requestKey = `${etf.symbol}:${period}:${adjustment}`;
  const currentPayload = payload?.requestKey === requestKey ? payload : null;
  const bars = currentPayload?.bars ?? emptyBars;
  const source = currentPayload?.source ?? "正在加载K线";
  const status = currentPayload?.status ?? "partial";
  const marketTime = currentPayload?.marketTime ?? null;
  const receivedAt = currentPayload?.receivedAt ?? null;
  const chartError = currentPayload?.error ?? "";

  useEffect(() => {
    const controller = new AbortController();
    const activeRequestKey = `${etf.symbol}:${period}:${adjustment}`;
    fetch(`/api/v1/etfs/${etf.symbol}/bars?period=${period}&adjust=${adjustment}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json() as Partial<Omit<EtfChartPayload, "requestKey" | "error">> & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "K 线数据更新失败");
        return result;
      })
      .then((result) => {
        setPayload({
          requestKey: activeRequestKey,
          bars: result.bars ?? [],
          source: result.source ?? "行情源",
          fallbackSource: result.fallbackSource ?? null,
          status: result.status ?? "complete",
          marketTime: result.marketTime ?? null,
          receivedAt: result.receivedAt ?? new Date().toISOString(),
          requestedPeriod: result.requestedPeriod ?? period,
          appliedPeriod: result.appliedPeriod ?? null,
          requestedAdjustment: result.requestedAdjustment ?? adjustment,
          appliedAdjustment: result.appliedAdjustment ?? null,
          message: result.message ?? "",
          error: "",
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setPayload({
          requestKey: activeRequestKey,
          bars: [],
          source: period === "minute" ? "东方财富 / 新浪财经" : "扶摇 Fuyao / 东方财富 / 百度股市通 / 新浪财经",
          fallbackSource: null,
          status: "failed",
          marketTime: null,
          receivedAt: new Date().toISOString(),
          requestedPeriod: period,
          appliedPeriod: null,
          requestedAdjustment: adjustment,
          appliedAdjustment: null,
          message: "所有可用K线数据源均获取失败",
          error: error instanceof Error ? error.message : "K 线数据更新失败",
        });
      });
    return () => controller.abort();
  }, [adjustment, etf.symbol, period]);

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
          {isWatched && <><label>分类<select value={etf.category} onChange={(event) => onCategoryChange?.(event.target.value)}>{ETF_CATEGORIES.filter((item) => item !== "全部").map((item) => <option key={item} value={item}>{item}</option>)}</select></label><button type="button" className="etf-remove-button" onClick={onRemove} title="移出我的自选"><Trash2 size={11} />移除</button></>}
          {!isWatched && onAdd && <button type="button" className="etf-add-button" onClick={onAdd} disabled={addDisabled}><Plus size={11} />加入自选</button>}
          <button type="button" className={adjustment === "forward" ? "active" : ""} onClick={() => setAdjustment((value) => value === "forward" ? "none" : "forward")}>{adjustment === "forward" ? "前复权" : "不复权"}</button>
        </div>
      </div>
      <LiveDataStatus label="K线" source={source} status={status} marketTime={marketTime} receivedAt={receivedAt} isStale={Boolean(chartError) || status === "demo"} error={chartError} hasData={bars.length > 0} />
      {currentPayload && <div className="etf-chart-data-meta">
        <span>请求 {periodLabel(currentPayload.requestedPeriod)} · {adjustmentLabel(currentPayload.requestedAdjustment)}</span>
        <span>实际 {periodLabel(currentPayload.appliedPeriod)} · {adjustmentLabel(currentPayload.appliedAdjustment)}</span>
        {currentPayload.fallbackSource && <span>降级源 {currentPayload.fallbackSource}</span>}
      </div>}
      {currentPayload?.message && (currentPayload.status !== "complete" || currentPayload.fallbackSource) && <div className={`etf-chart-notice ${currentPayload.status}`}>{currentPayload.message}</div>}
      <div ref={container} className="etf-chart-canvas" />
      {!bars.length && <div className="etf-chart-empty">数据暂缺 · 更新失败</div>}
      <div className="etf-chart-foot"><span>十字光标 · 缩放浏览</span><span>{source} · 成交量同步显示</span></div>
    </div>
  );
}
