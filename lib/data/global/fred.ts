import type { FredSeries, GlobalPoint } from "./types";
import { unavailableGlobalPoint } from "./types";

export async function fetchFredSeries(series: FredSeries, apiKey: string, fetcher: typeof fetch = fetch): Promise<GlobalPoint> {
  if (!apiKey) return unavailableGlobalPoint(series, "FRED", "unconfigured", "未配置 FRED");
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(series.seriesId)}&api_key=${encodeURIComponent(apiKey)}&file_type=json&sort_order=desc&limit=10`;
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`FRED ${response.status}`);
  const payload = await response.json() as { observations?: Array<{ date?: string; value?: string }> };
  const row = payload.observations?.find((item) => Number.isFinite(Number(item.value)));
  if (!row) return unavailableGlobalPoint(series, "FRED", "failed", "FRED 未返回有效数值");
  return {
    key: series.key,
    label: series.label,
    provider: "FRED",
    value: Number(row.value),
    previousClose: null,
    pctChange: null,
    marketTime: row.date ?? null,
    receivedAt: new Date().toISOString(),
    period: series.period,
    status: "ok",
    message: "",
  };
}
