import type { GlobalInstrument, GlobalPoint } from "./types";
import { unavailableGlobalPoint } from "./types";

const numeric = (value: unknown): number | null => {
  const parsed = Number(String(value ?? "").replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
};

export async function fetchAlphaVantageQuote(
  instrument: GlobalInstrument,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<GlobalPoint> {
  if (!apiKey) return unavailableGlobalPoint(instrument, "Alpha Vantage", "unconfigured", "未配置 Alpha Vantage");
  const response = await fetcher(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(instrument.symbol)}&apikey=${encodeURIComponent(apiKey)}`);
  if (!response.ok) throw new Error(`Alpha Vantage ${response.status}`);
  const payload = await response.json() as { "Global Quote"?: Record<string, unknown> };
  const quote = payload["Global Quote"];
  const value = numeric(quote?.["05. price"]);
  if (value === null) return unavailableGlobalPoint(instrument, "Alpha Vantage", "failed", "Alpha Vantage 未返回有效数值");
  const previousClose = numeric(quote?.["08. previous close"]);
  const pctChange = numeric(quote?.["10. change percent"]);
  return {
    key: instrument.key,
    label: instrument.label,
    provider: "Alpha Vantage",
    value,
    previousClose,
    pctChange,
    marketTime: typeof quote?.["07. latest trading day"] === "string" ? quote["07. latest trading day"] : null,
    receivedAt: new Date().toISOString(),
    period: instrument.period,
    status: "ok",
    message: "",
  };
}
