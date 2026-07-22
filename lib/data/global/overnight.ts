import { fetchAlphaVantageQuote } from "./alpha-vantage";
import { fetchEiaSeries } from "./eia";
import { fetchFredSeries } from "./fred";
import { reconcileGlobalPoints } from "./reconcile";
import { fetchTwelveDataQuotes } from "./twelve-data";
import type { EiaSeries, FredSeries, GlobalInstrument, GlobalPoint, ReconciledGlobalPoint } from "./types";
import { unavailableGlobalPoint } from "./types";

export interface GlobalDataEnv {
  TWELVE_DATA_API_KEY?: string;
  ALPHA_VANTAGE_API_KEY?: string;
  FRED_API_KEY?: string;
  EIA_API_KEY?: string;
}

export const GLOBAL_MARKET_INSTRUMENTS: GlobalInstrument[] = [
  { key: "sp500", symbol: "SPY", label: "标普500", period: "daily" },
  { key: "nasdaq", symbol: "QQQ", label: "纳斯达克", period: "daily" },
  { key: "dow", symbol: "DIA", label: "道琼斯", period: "daily" },
  { key: "semiconductor", symbol: "SOXX", label: "费城半导体", period: "daily" },
  { key: "nvidia", symbol: "NVDA", label: "英伟达", period: "daily" },
  { key: "micron", symbol: "MU", label: "美光科技", period: "daily" },
  { key: "usd_cnh", symbol: "USD/CNH", label: "美元兑离岸人民币", period: "daily" },
  { key: "gold", symbol: "XAU/USD", label: "现货黄金", period: "daily" },
];

const ALPHA_VALIDATION_KEYS = new Set(["sp500", "semiconductor"]);
const FRED_US10Y: FredSeries = { key: "us10y", label: "美国10年期国债收益率", seriesId: "DGS10", period: "daily" };
const EIA_WTI: EiaSeries = { key: "wti", label: "WTI原油", route: "petroleum/pri/spt/data", valueField: "value", period: "daily" };

async function safePoint(
  item: GlobalInstrument | FredSeries | EiaSeries,
  provider: string,
  operation: () => Promise<GlobalPoint>,
): Promise<GlobalPoint> {
  try {
    return await operation();
  } catch {
    return unavailableGlobalPoint(item, provider, "failed", `${provider} 请求失败`);
  }
}

export async function loadGlobalOvernightSnapshot(
  env: GlobalDataEnv,
  fetcher: typeof fetch = fetch,
): Promise<{ raw: GlobalPoint[]; reconciled: ReconciledGlobalPoint[] }> {
  let twelve: GlobalPoint[];
  try {
    twelve = await fetchTwelveDataQuotes(GLOBAL_MARKET_INSTRUMENTS, env.TWELVE_DATA_API_KEY ?? "", fetcher);
  } catch {
    twelve = GLOBAL_MARKET_INSTRUMENTS.map((item) => unavailableGlobalPoint(item, "Twelve Data", "failed", "Twelve Data 请求失败"));
  }
  const alpha = await Promise.all(GLOBAL_MARKET_INSTRUMENTS
    .filter((item) => ALPHA_VALIDATION_KEYS.has(item.key))
    .map((item) => safePoint(item, "Alpha Vantage", () => fetchAlphaVantageQuote(item, env.ALPHA_VANTAGE_API_KEY ?? "", fetcher))));
  const [fred, eia] = await Promise.all([
    safePoint(FRED_US10Y, "FRED", () => fetchFredSeries(FRED_US10Y, env.FRED_API_KEY ?? "", fetcher)),
    safePoint(EIA_WTI, "EIA", () => fetchEiaSeries(EIA_WTI, env.EIA_API_KEY ?? "", fetcher)),
  ]);
  const raw = [...twelve, ...alpha, fred, eia];
  return { raw, reconciled: reconcileGlobalPoints(raw) };
}
