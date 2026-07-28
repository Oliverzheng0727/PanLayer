import { createFuyaoMcpClient, type FuyaoMcpOptions } from "../data/fuyao-mcp";
import { fetchTencentAdjustedMarketBars } from "../data/tencent";

export type BarPeriod = "minute" | "day" | "week" | "month";
export type Adjustment = "none" | "forward";

export interface MarketBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
}

export interface EtfBarsResult {
  bars: MarketBar[];
  source: string;
  fallbackSource: string | null;
  status: "complete" | "partial";
  appliedAdjustment: Adjustment;
  appliedPeriod: BarPeriod;
  message: string;
}

const UPSTREAM_TIMEOUT_MS = 4_500;
const BAIDU_TIMEOUT_MS = 8_000;

const numberValue = (value: string | number | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function periodKey(date: string, period: "week" | "month"): string {
  if (period === "month") return date.slice(0, 7);
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  const mondayOffset = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - mondayOffset);
  return parsed.toISOString().slice(0, 10);
}

export function aggregateBars(bars: MarketBar[], period: "week" | "month"): MarketBar[] {
  const groups = new Map<string, MarketBar[]>();
  for (const bar of bars) {
    const key = periodKey(bar.time, period);
    groups.set(key, [...(groups.get(key) ?? []), bar]);
  }
  return [...groups.values()].map((group) => ({
    time: group.at(-1)!.time,
    open: group[0].open,
    high: Math.max(...group.map((item) => item.high)),
    low: Math.min(...group.map((item) => item.low)),
    close: group.at(-1)!.close,
    volume: group.reduce((sum, item) => sum + item.volume, 0),
    amount: group.reduce((sum, item) => sum + item.amount, 0),
  }));
}

export function sanitizeMarketBars(bars: MarketBar[]): MarketBar[] {
  const valid = bars.filter((bar) => {
    const prices = [bar.open, bar.high, bar.low, bar.close];
    return /^\d{4}-\d{2}-\d{2}/.test(bar.time)
      && prices.every((value) => Number.isFinite(value) && value > 0)
      && bar.high >= Math.max(bar.open, bar.close, bar.low)
      && bar.low <= Math.min(bar.open, bar.close, bar.high)
      && Number.isFinite(bar.volume)
      && bar.volume >= 0
      && Number.isFinite(bar.amount)
      && bar.amount >= 0;
  });
  return [...new Map(valid.map((bar) => [bar.time, bar])).values()]
    .toSorted((left, right) => left.time.localeCompare(right.time));
}

function secidFor(symbol: string): string {
  const code = symbol.split(".")[0];
  return `${code.startsWith("5") || code.startsWith("6") ? 1 : 0}.${code}`;
}

async function fetchJson<T>(url: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(url, {
    headers: {
      accept: "application/json",
      origin: "https://quote.eastmoney.com",
      referer: "https://quote.eastmoney.com/",
      "user-agent": "Mozilla/5.0 PanLayer/1.0",
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Eastmoney ${response.status}`);
  return response.json() as Promise<T>;
}

function sinaSymbol(symbol: string): string {
  const code = symbol.split(".")[0];
  return `${code.startsWith("5") || code.startsWith("6") ? "sh" : "sz"}${code}`;
}

interface SinaBar {
  day?: string;
  open?: string | number;
  high?: string | number;
  low?: string | number;
  close?: string | number;
  volume?: string | number;
  amount?: string | number;
}

function mapSinaBars(rows: SinaBar[]): MarketBar[] {
  return rows.flatMap((row) => {
    const bar = {
      time: (row.day ?? "").replace(/:00$/, ""),
      open: numberValue(row.open),
      high: numberValue(row.high),
      low: numberValue(row.low),
      close: numberValue(row.close),
      volume: numberValue(row.volume),
      amount: numberValue(row.amount),
    };
    return bar.time && bar.close > 0 ? [bar] : [];
  });
}

async function fetchSinaText(url: string, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(url, {
    headers: {
      accept: "application/json,text/javascript,*/*;q=0.8",
      referer: "https://finance.sina.com.cn/",
      "user-agent": "PanLayer/1.0",
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Sina ${response.status}`);
  return response.text();
}

interface BaiduKlinePayload {
  ResultCode?: string | number;
  Result?: {
    newMarketData?: {
      keys?: string[];
      marketData?: string;
    };
  };
}

export async function fetchBaiduDailyBars(symbol: string, fetcher: typeof fetch = fetch): Promise<MarketBar[]> {
  const code = symbol.split(".")[0];
  const params = new URLSearchParams({
    all: "1",
    isIndex: "false",
    isBk: "false",
    isBlock: "false",
    stock_type: "ab",
    newFormat: "1",
    code,
    market: "ab",
    ktype: "1",
    finClientType: "pc",
    group: "quotation_kline_ab",
    startDate: "19900101",
    endDate: "20500101",
    isfq: "0",
  });
  const response = await fetcher(`https://finance.pae.baidu.com/selfselect/getstockquotation?${params.toString()}`, {
    headers: {
      accept: "application/vnd.finance-web.v1+json",
      origin: "https://gushitong.baidu.com",
      referer: "https://gushitong.baidu.com/",
      "user-agent": "Mozilla/5.0 PanLayer/1.0",
    },
    signal: AbortSignal.timeout(BAIDU_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Baidu ${response.status}`);
  const payload = await response.json() as BaiduKlinePayload;
  if (String(payload.ResultCode ?? "") !== "0") {
    throw new Error(`Baidu result ${String(payload.ResultCode ?? "missing")}`);
  }
  const keys = payload.Result?.newMarketData?.keys ?? [];
  const marketData = payload.Result?.newMarketData?.marketData ?? "";
  if (!keys.length || !marketData) return [];
  const positions = new Map(keys.map((key, index) => [key, index]));
  const valueAt = (values: string[], key: string) => values[positions.get(key) ?? -1];
  return marketData.split(";").flatMap((line) => {
    const values = line.split(",");
    const bar = {
      time: valueAt(values, "time") ?? "",
      open: numberValue(valueAt(values, "open")),
      high: numberValue(valueAt(values, "high")),
      low: numberValue(valueAt(values, "low")),
      close: numberValue(valueAt(values, "close")),
      volume: numberValue(valueAt(values, "volume")),
      amount: numberValue(valueAt(values, "amount")),
    };
    return bar.time && bar.close > 0 ? [bar] : [];
  });
}

export async function fetchEastmoneyDailyBars(symbol: string, adjustment: Adjustment, fetcher: typeof fetch = fetch): Promise<MarketBar[]> {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secidFor(symbol)}&klt=101&fqt=${adjustment === "forward" ? 1 : 0}&lmt=1000&end=20500101&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57`;
  const payload = await fetchJson<{ data?: { klines?: string[] } }>(url, fetcher);
  return (payload.data?.klines ?? []).flatMap((line) => {
    const [time, open, close, high, low, volume, amount] = line.split(",");
    const bar = { time, open: numberValue(open), high: numberValue(high), low: numberValue(low), close: numberValue(close), volume: numberValue(volume), amount: numberValue(amount) };
    return bar.time && bar.close > 0 ? [bar] : [];
  });
}

export async function fetchEastmoneyMinuteBars(symbol: string, fetcher: typeof fetch = fetch): Promise<MarketBar[]> {
  const url = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${secidFor(symbol)}&ndays=1&iscr=0&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;
  const payload = await fetchJson<{ data?: { trends?: string[] } }>(url, fetcher);
  return (payload.data?.trends ?? []).flatMap((line) => {
    const [time, open, close, high, low, volume, amount] = line.split(",");
    const bar = { time, open: numberValue(open), high: numberValue(high), low: numberValue(low), close: numberValue(close), volume: numberValue(volume), amount: numberValue(amount) };
    return bar.time && bar.close > 0 ? [bar] : [];
  });
}

export async function fetchSinaDailyBars(symbol: string, fetcher: typeof fetch = fetch): Promise<MarketBar[]> {
  const marketSymbol = sinaSymbol(symbol);
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${marketSymbol}&scale=240&ma=no&datalen=1023`;
  const text = await fetchSinaText(url, fetcher);
  try {
    const rows = JSON.parse(text) as SinaBar[];
    if (!Array.isArray(rows)) throw new Error("not an array");
    return mapSinaBars(rows);
  } catch (error) {
    throw new Error(`Sina JSON: ${error instanceof Error ? error.message : "invalid response"}`);
  }
}

export async function fetchSinaMinuteBars(symbol: string, fetcher: typeof fetch = fetch): Promise<MarketBar[]> {
  const marketSymbol = sinaSymbol(symbol);
  const url = `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_${marketSymbol}_5_240/CN_MarketDataService.getKLineData?symbol=${marketSymbol}&scale=5&ma=no&datalen=240`;
  const text = await fetchSinaText(url, fetcher);
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("Sina JSONP: invalid response");
  try {
    const rows = JSON.parse(text.slice(start, end + 1)) as SinaBar[];
    if (!Array.isArray(rows)) throw new Error("not an array");
    return mapSinaBars(rows);
  } catch (error) {
    throw new Error(`Sina JSONP: ${error instanceof Error ? error.message : "invalid response"}`);
  }
}

export async function loadEtfBarsWithFallback(
  symbol: string,
  period: BarPeriod,
  adjustment: Adjustment,
  fetcher: typeof fetch = fetch,
  fuyaoOptions?: FuyaoMcpOptions,
): Promise<EtfBarsResult> {
  const loadFuyaoBars = async () => {
    if (!fuyaoOptions || period === "minute") throw new Error("Fuyao ETF daily source is unavailable");
    const daily = sanitizeMarketBars(
      await createFuyaoMcpClient({ ...fuyaoOptions, fetcher }).fetchFundDailyBars(symbol),
    );
    const bars = period === "day" ? daily : aggregateBars(daily, period);
    if (bars.length === 0) throw new Error("Fuyao ETF bars are empty");
    return bars;
  };

  const periodLabel = period === "day" ? "日K" : period === "week" ? "周K" : "月K";
  if (period === "minute") {
    try {
      const bars = sanitizeMarketBars(await fetchEastmoneyMinuteBars(symbol, fetcher));
      if (bars.length === 0) throw new Error("empty market bars");
      return {
        bars,
        source: "东方财富",
        fallbackSource: null,
        status: "complete",
        appliedAdjustment: "none",
        appliedPeriod: "minute",
        message: "东方财富分时行情",
      };
    } catch (primaryError) {
      try {
        const bars = sanitizeMarketBars(await fetchSinaMinuteBars(symbol, fetcher));
        if (bars.length === 0) throw new Error("empty market bars");
        return {
          bars,
          source: "新浪财经（5分钟）",
          fallbackSource: "新浪财经",
          status: "partial",
          appliedAdjustment: "none",
          appliedPeriod: "minute",
          message: "东方财富分时不可用，已降级为新浪5分钟K线",
        };
      } catch (fallbackError) {
        const primaryMessage = primaryError instanceof Error ? primaryError.message : "primary source failed";
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "fallback source failed";
        throw new Error(`ETF bars unavailable: ${primaryMessage}; ${fallbackMessage}`);
      }
    }
  }

  let fuyaoPrimaryError: unknown;
  if (adjustment === "none" && fuyaoOptions) {
    try {
      return {
        bars: await loadFuyaoBars(),
        source: period === "day" ? "扶摇 Fuyao" : `扶摇 Fuyao（日K聚合${periodLabel}）`,
        fallbackSource: null,
        status: "complete",
        appliedAdjustment: "none",
        appliedPeriod: period,
        message: period === "day" ? "扶摇ETF日K" : `扶摇ETF日K由服务端聚合为${periodLabel}`,
      };
    } catch (error) {
      fuyaoPrimaryError = error;
    }
  }

  let eastmoneyError: unknown;
  try {
    const daily = sanitizeMarketBars(await fetchEastmoneyDailyBars(symbol, adjustment, fetcher));
    const bars = period === "day" ? daily : aggregateBars(daily, period);
    if (bars.length === 0) throw new Error("empty market bars");
    const fellBackFromFuyao = adjustment === "none" && Boolean(fuyaoOptions);
    return {
      bars,
      source: "东方财富",
      fallbackSource: fellBackFromFuyao ? "东方财富" : null,
      status: "complete",
      appliedAdjustment: adjustment,
      appliedPeriod: period,
      message: fellBackFromFuyao
        ? `扶摇${periodLabel}不可用，已降级至东方财富`
        : `东方财富${adjustment === "forward" ? "前复权" : "不复权"}${periodLabel}`,
    };
  } catch (error) {
    eastmoneyError = error;
  }

  let tencentForwardError: unknown;
  if (adjustment === "forward") {
    try {
      const daily = sanitizeMarketBars(await fetchTencentAdjustedMarketBars(symbol, fetcher));
      const bars = period === "day" ? daily : aggregateBars(daily, period);
      if (bars.length === 0) throw new Error("empty market bars");
      return {
        bars,
        source: "腾讯证券（前复权）",
        fallbackSource: "腾讯证券",
        status: "complete",
        appliedAdjustment: "forward",
        appliedPeriod: period,
        message: `东方财富前复权${periodLabel}不可用，已由腾讯前复权接管`,
      };
    } catch (error) {
      tencentForwardError = error;
    }
  }

  if (fuyaoOptions && adjustment === "forward") {
    try {
      return {
        bars: await loadFuyaoBars(),
        source: period === "day" ? "扶摇 Fuyao（不复权）" : `扶摇 Fuyao（日K聚合${periodLabel}，不复权）`,
        fallbackSource: "扶摇 Fuyao",
        status: "partial",
        appliedAdjustment: "none",
        appliedPeriod: period,
        message: `东方财富与腾讯前复权${periodLabel}不可用；扶摇仅提供不复权数据，当前K线未冒充前复权`,
      };
    } catch {
      // Continue to public unadjusted fallbacks.
    }
  }

  try {
    const daily = sanitizeMarketBars(await fetchBaiduDailyBars(symbol, fetcher));
    const bars = period === "day" ? daily : aggregateBars(daily, period);
    if (bars.length === 0) throw new Error("empty market bars");
    return {
      bars,
      source: "百度股市通（不复权）",
      fallbackSource: "百度股市通",
      status: "partial",
      appliedAdjustment: "none",
      appliedPeriod: period,
      message: `${adjustment === "forward" ? "前复权数据不可用；" : ""}已降级至百度股市通不复权${periodLabel}`,
    };
  } catch {
    // Continue to Sina, whose daily endpoint lacks historical turnover amount.
  }

  try {
    const daily = sanitizeMarketBars(await fetchSinaDailyBars(symbol, fetcher));
    const bars = period === "day" ? daily : aggregateBars(daily, period);
    if (bars.length === 0) throw new Error("empty market bars");
    return {
      bars,
      source: "新浪财经（不复权）",
      fallbackSource: "新浪财经",
      status: "partial",
      appliedAdjustment: "none",
      appliedPeriod: period,
      message: `${adjustment === "forward" ? "前复权数据不可用；" : ""}已降级至新浪财经不复权${periodLabel}`,
    };
  } catch (fallbackError) {
    const primaryError = adjustment === "none" && fuyaoOptions ? fuyaoPrimaryError : eastmoneyError;
    const primaryMessage = [
      primaryError instanceof Error ? primaryError.message : "primary source failed",
      tencentForwardError instanceof Error ? `Tencent: ${tencentForwardError.message}` : "",
    ].filter(Boolean).join("; ");
    const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "fallback source failed";
    throw new Error(`ETF bars unavailable: ${primaryMessage}; ${fallbackMessage}`);
  }
}
