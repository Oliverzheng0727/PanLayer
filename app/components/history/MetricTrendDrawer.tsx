"use client";

import { BarChart3, CalendarDays, ListTree, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HistoryRow } from "../../../lib/history/query";
import {
  TREND_METRIC_CONFIGS,
  buildTrendPoints,
  formatTrendValue,
  hasTrendValues,
  type TrendMetricKey,
  type TrendPoint,
  type TrendRange,
  type TrendSeriesConfig,
} from "../../../lib/history/trends";

const ranges: Array<{ value: TrendRange; label: string }> = [
  { value: 20, label: "20日" },
  { value: 60, label: "60日" },
  { value: 120, label: "120日" },
  { value: "all", label: "全部" },
];

type ChartDatum = TrendPoint & Record<string, unknown>;

function toChartDatum(point: TrendPoint): ChartDatum {
  return { ...point, ...point.values };
}

function latestValue(points: TrendPoint[], field: string): number | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index].values[field as keyof TrendPoint["values"]];
    if (value !== null) return value;
  }
  return null;
}

function TrendTooltip({ active, payload, config }: {
  active?: boolean;
  payload?: Array<{ payload?: ChartDatum }>;
  config: (typeof TREND_METRIC_CONFIGS)[TrendMetricKey];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="trend-tooltip">
      <strong>{point.date}</strong>
      <div>
        {config.series.map((series) => (
          <span key={series.field}>
            <i style={{ background: series.color }} />
            {series.label}
            <b>{formatTrendValue(point.values[series.field], series.unit)}</b>
          </span>
        ))}
      </div>
      <p>{point.quality === "complete" ? "完整" : point.quality === "partial" ? "部分" : "暂缺"} · {point.source || "来源暂缺"}</p>
      <p>更新 {point.updatedAt || "暂缺"}{point.backfilled ? " · 历史回补" : ""}</p>
    </div>
  );
}

function TrendDot(props: {
  cx?: number;
  cy?: number;
  payload?: ChartDatum;
  stroke?: string;
}) {
  const { cx, cy, payload, stroke = "#e8702a" } = props;
  if (typeof cx !== "number" || typeof cy !== "number" || !payload) return null;
  if (payload.quality === "unavailable") return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={payload.quality === "partial" ? 3.2 : 2.2}
      fill={payload.quality === "partial" ? "#0e1012" : stroke}
      stroke={stroke}
      strokeWidth={payload.quality === "partial" ? 1.5 : 0}
    />
  );
}

function TrendActiveDot(props: {
  cx?: number;
  cy?: number;
  payload?: ChartDatum;
  stroke?: string;
  onSelect: (date: string) => void;
}) {
  const { cx, cy, payload, stroke = "#e8702a", onSelect } = props;
  if (typeof cx !== "number" || typeof cy !== "number" || !payload) return null;
  const select = () => onSelect(payload.date);
  return (
    <circle
      cx={cx}
      cy={cy}
      r={6}
      fill="#0e1012"
      stroke={stroke}
      strokeWidth={2}
      role="button"
      tabIndex={0}
      aria-label={`切换到 ${payload.date}`}
      onClick={select}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select();
        }
      }}
      style={{ cursor: "pointer" }}
    />
  );
}

export function MetricTrendDrawer({
  metric,
  rows,
  currentDate,
  onClose,
  onSelectDate,
  onOpenHighDetails,
}: {
  metric: TrendMetricKey;
  rows: HistoryRow[];
  currentDate: string;
  onClose: () => void;
  onSelectDate: (date: string) => void;
  onOpenHighDetails: () => void;
}) {
  const [range, setRange] = useState<TrendRange>(60);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const config = TREND_METRIC_CONFIGS[metric];
  const points = useMemo(() => buildTrendPoints(rows, metric, range), [metric, range, rows]);
  const chartData = useMemo(() => points.map(toChartDatum), [points]);
  const available = hasTrendValues(points, metric);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  const selectDate = (date: string) => {
    onSelectDate(date);
    onClose();
  };

  return (
    <div className="high-drawer-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="high-drawer metric-trend-drawer" role="dialog" aria-modal="true" aria-labelledby="metric-trend-title">
        <header className="high-drawer-header metric-trend-header">
          <div>
            <p>HISTORICAL TREND · VERIFIED DATA</p>
            <h3 id="metric-trend-title">{config.title}</h3>
            <span>{config.description}</span>
          </div>
          <button ref={closeButtonRef} type="button" className="high-drawer-icon" onClick={onClose} aria-label="关闭历史趋势"><X size={18} /></button>
        </header>

        <div className="metric-trend-body">
          <div className="metric-trend-controls">
            <div role="group" aria-label="趋势时间范围">
              {ranges.map((item) => (
                <button key={item.label} type="button" className={range === item.value ? "active" : ""} onClick={() => setRange(item.value)}>
                  {item.label}
                </button>
              ))}
            </div>
            <span><CalendarDays size={13} />{points.length} 个交易日</span>
          </div>

          <div className="metric-trend-kpis">
            {config.series.map((series) => (
              <div key={series.field}>
                <span><i style={{ background: series.color }} />{series.label}</span>
                <strong>{formatTrendValue(latestValue(points, series.field), series.unit)}</strong>
              </div>
            ))}
          </div>

          {available ? (
            <div className="metric-trend-chart" aria-label={`${config.title}历史折线图`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 14, right: config.series.some((series) => series.secondaryAxis) ? 18 : 8, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,.055)" vertical={false} />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={26} tick={{ fill: "rgba(255,255,255,.32)", fontSize: 10 }} tickFormatter={(date: string) => date.slice(5)} />
                  <YAxis yAxisId="primary" axisLine={false} tickLine={false} width={48} tick={{ fill: "rgba(255,255,255,.28)", fontSize: 10 }} />
                  {config.series.some((series) => series.secondaryAxis) && (
                    <YAxis yAxisId="secondary" orientation="right" axisLine={false} tickLine={false} width={28} allowDecimals={false} tick={{ fill: "rgba(255,255,255,.25)", fontSize: 9 }} />
                  )}
                  <Tooltip cursor={{ stroke: "rgba(232,112,42,.32)", strokeDasharray: "3 3" }} content={(props) => <TrendTooltip active={props.active} payload={props.payload as Array<{ payload?: ChartDatum }>} config={config} />} />
                  <Legend wrapperStyle={{ paddingTop: 12, fontSize: 10, color: "rgba(255,255,255,.45)" }} />
                  {config.series.map((series: TrendSeriesConfig) => (
                    <Line
                      key={series.field}
                      yAxisId={series.secondaryAxis ? "secondary" : "primary"}
                      type="monotone"
                      dataKey={series.field}
                      name={series.label}
                      stroke={series.color}
                      strokeWidth={series.secondaryAxis ? 1.5 : 2}
                      strokeDasharray={series.dashed ? "5 4" : undefined}
                      connectNulls={false}
                      dot={(props) => <TrendDot {...props} />}
                      activeDot={(props) => <TrendActiveDot {...props} onSelect={selectDate} />}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              <p className="metric-trend-hint">悬停查看来源与状态 · 点击高亮数据点可切换复盘日期</p>
            </div>
          ) : (
            <div className="metric-trend-empty">
              <BarChart3 size={24} />
              <strong>暂无可验证历史数据</strong>
              <p>该时间范围内没有完整或部分状态的真实指标，未使用0值或旧值补齐。</p>
            </div>
          )}

          {metric === "highs" && (
            <button type="button" className="metric-trend-detail-link" onClick={onOpenHighDetails}>
              <ListTree size={15} />
              查看 {currentDate} 新高股票
            </button>
          )}
        </div>

        <footer className="high-drawer-footer">
          <span>空值保持断线 · 部分数据为空心点</span>
          <span>仅供市场复盘，不构成投资建议</span>
        </footer>
      </aside>
    </div>
  );
}
