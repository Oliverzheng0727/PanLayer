import type { GlobalInstrument, GlobalPoint } from "./types";
import { unavailableGlobalPoint } from "./types";

interface TwelveQuote {
  symbol?: string;
  close?: string | number;
  price?: string | number;
  previous_close?: string | number;
  percent_change?: string | number;
  datetime?: string;
  timestamp?: number;
  status?: string;
  message?: string;
}

const numeric = (value: string | number | undefined): number | null => {
  const parsed = Number(String(value ?? "").replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
};

export async function fetchTwelveDataQuotes(
  instruments: GlobalInstrument[],
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<GlobalPoint[]> {
  if (instruments.length > 8) throw new Error("Twelve Data batch exceeds 8 symbols");
  if (!apiKey) return instruments.map((item) => unavailableGlobalPoint(item, "Twelve Data", "unconfigured", "未配置 Twelve Data"));
  const symbols = instruments.map((item) => item.symbol).join(",");
  const response = await fetcher(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols)}&apikey=${encodeURIComponent(apiKey)}`);
  if (!response.ok) throw new Error(`Twelve Data ${response.status}`);
  const payload = await response.json() as Record<string, TwelveQuote> & TwelveQuote;
  const receivedAt = new Date().toISOString();
  return instruments.map((item) => {
    const row = instruments.length === 1 && payload.symbol ? payload : payload[item.symbol];
    const value = numeric(row?.close ?? row?.price);
    if (!row || value === null) return unavailableGlobalPoint(item, "Twelve Data", "failed", "Twelve Data 未返回有效数值");
    const previousClose = numeric(row.previous_close);
    const pctChange = numeric(row.percent_change) ?? (previousClose && previousClose !== 0 ? ((value / previousClose) - 1) * 100 : null);
    return {
      key: item.key,
      label: item.label,
      provider: "Twelve Data",
      value,
      previousClose,
      pctChange: pctChange === null ? null : Number(pctChange.toFixed(4)),
      marketTime: row.datetime ?? (row.timestamp ? new Date(row.timestamp * 1_000).toISOString() : null),
      receivedAt,
      period: item.period,
      status: "ok",
      message: "",
    };
  });
}
