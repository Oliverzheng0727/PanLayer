import type { HistoryRow } from "./query";

export type TrendMetricKey =
  | "breadth"
  | "limits"
  | "consecutive"
  | "highs"
  | "premium"
  | "margin";

export type TrendRange = 20 | 60 | 120 | "all";

export type TrendValueField =
  | "rising"
  | "falling"
  | "limitUp"
  | "limitDown"
  | "consecutive"
  | "maxStreak"
  | "high20"
  | "high120"
  | "allTimeHigh"
  | "openPremium"
  | "closePremium"
  | "marginBalance";

export interface TrendSeriesConfig {
  field: TrendValueField;
  label: string;
  color: string;
  unit: "count" | "board" | "percent" | "billion";
  dashed?: boolean;
  secondaryAxis?: boolean;
}

export interface TrendMetricConfig {
  title: string;
  description: string;
  series: TrendSeriesConfig[];
}

export interface TrendPoint {
  date: string;
  values: Record<TrendValueField, number | null>;
  quality: "complete" | "partial" | "unavailable";
  source: string;
  updatedAt: string;
  backfilled: boolean;
}

export const TREND_METRIC_CONFIGS: Record<TrendMetricKey, TrendMetricConfig> = {
  breadth: {
    title: "上涨 / 下跌家数",
    description: "沪深京全 A 收盘涨跌家数",
    series: [
      { field: "rising", label: "上涨家数", color: "#ef5b58", unit: "count" },
      { field: "falling", label: "下跌家数", color: "#3bc987", unit: "count" },
    ],
  },
  limits: {
    title: "涨停 / 跌停数量",
    description: "剔除 ST 后的收盘封板数量",
    series: [
      { field: "limitUp", label: "涨停数量", color: "#ef5b58", unit: "count" },
      { field: "limitDown", label: "跌停数量", color: "#3bc987", unit: "count" },
    ],
  },
  consecutive: {
    title: "连板家数",
    description: "连板股票数量与当日最高连板高度",
    series: [
      { field: "consecutive", label: "连板家数", color: "#e8702a", unit: "count" },
      { field: "maxStreak", label: "最高板", color: "#f3c38e", unit: "board", dashed: true, secondaryAxis: true },
    ],
  },
  highs: {
    title: "新高家数",
    description: "前复权收盘价计算的20日、120日及历史新高",
    series: [
      { field: "high20", label: "20日新高", color: "#f59e0b", unit: "count" },
      { field: "high120", label: "120日新高", color: "#e8702a", unit: "count" },
      { field: "allTimeHigh", label: "历史新高", color: "#f3c38e", unit: "count" },
    ],
  },
  premium: {
    title: "连板溢价",
    description: "昨日二板及以上股票的今日等权平均涨幅",
    series: [
      { field: "openPremium", label: "开盘溢价", color: "#8b9cf6", unit: "percent" },
      { field: "closePremium", label: "收盘溢价", color: "#e8702a", unit: "percent" },
    ],
  },
  margin: {
    title: "两融余额",
    description: "沪深京融资融券余额，单位亿元",
    series: [
      { field: "marginBalance", label: "两融余额", color: "#e8702a", unit: "billion" },
    ],
  },
};

const allTrendFields: TrendValueField[] = [
  "rising",
  "falling",
  "limitUp",
  "limitDown",
  "consecutive",
  "maxStreak",
  "high20",
  "high120",
  "allTimeHigh",
  "openPremium",
  "closePremium",
  "marginBalance",
];

function emptyValues(): Record<TrendValueField, number | null> {
  return Object.fromEntries(allTrendFields.map((field) => [field, null])) as Record<TrendValueField, number | null>;
}

export function buildTrendPoints(
  rows: HistoryRow[],
  metric: TrendMetricKey,
  range: TrendRange,
): TrendPoint[] {
  const sorted = rows.toSorted((left, right) => left.date.localeCompare(right.date));
  const selected = range === "all" ? sorted : sorted.slice(-range);
  const visibleFields = new Set(TREND_METRIC_CONFIGS[metric].series.map((series) => series.field));

  return selected.map((row) => {
    const unavailable = row.status === "failed" || row.status === "demo";
    const values = emptyValues();
    for (const field of visibleFields) {
      const value = row[field];
      values[field] = unavailable || typeof value !== "number" || !Number.isFinite(value)
        ? null
        : value;
    }
    return {
      date: row.date,
      values,
      quality: unavailable ? "unavailable" : row.status === "partial" ? "partial" : "complete",
      source: row.source,
      updatedAt: row.updatedAt,
      backfilled: row.backfilled,
    };
  });
}

export function hasTrendValues(points: TrendPoint[], metric: TrendMetricKey): boolean {
  const fields = TREND_METRIC_CONFIGS[metric].series.map((series) => series.field);
  return points.some((point) => fields.some((field) => point.values[field] !== null));
}

export function formatTrendValue(value: number | null, unit: TrendSeriesConfig["unit"]): string {
  if (value === null) return "暂缺";
  if (unit === "percent") return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  if (unit === "billion") return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}亿`;
  if (unit === "board") return `${value}板`;
  return value.toLocaleString("zh-CN");
}
