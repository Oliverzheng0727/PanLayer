import type { EiaSeries, GlobalPoint } from "./types";
import { unavailableGlobalPoint } from "./types";

export async function fetchEiaSeries(series: EiaSeries, apiKey: string, fetcher: typeof fetch = fetch): Promise<GlobalPoint> {
  if (!apiKey) return unavailableGlobalPoint(series, "EIA", "unconfigured", "未配置 EIA");
  const url = `https://api.eia.gov/v2/${series.route}?api_key=${encodeURIComponent(apiKey)}&data[0]=${encodeURIComponent(series.valueField)}&sort[0][column]=period&sort[0][direction]=desc&length=10`;
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`EIA ${response.status}`);
  const payload = await response.json() as { response?: { data?: Array<Record<string, unknown> & { period?: string }> } };
  const row = payload.response?.data?.find((item) => Number.isFinite(Number(item[series.valueField])));
  if (!row) return unavailableGlobalPoint(series, "EIA", "failed", "EIA 未返回有效数值");
  return {
    key: series.key,
    label: series.label,
    provider: "EIA",
    value: Number(row[series.valueField]),
    previousClose: null,
    pctChange: null,
    marketTime: row.period ?? null,
    receivedAt: new Date().toISOString(),
    period: series.period,
    status: "ok",
    message: "",
  };
}
