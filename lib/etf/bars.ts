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

function secidFor(symbol: string): string {
  const code = symbol.split(".")[0];
  return `${code.startsWith("5") || code.startsWith("6") ? 1 : 0}.${code}`;
}

async function fetchJson<T>(url: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(url, { headers: { accept: "application/json", "user-agent": "PanLayer/1.0" } });
  if (!response.ok) throw new Error(`Eastmoney ${response.status}`);
  return response.json() as Promise<T>;
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
    const [time, price, , volume, amount] = line.split(",");
    const close = numberValue(price);
    return time && close > 0 ? [{ time, open: close, high: close, low: close, close, volume: numberValue(volume), amount: numberValue(amount) }] : [];
  });
}

export function createDemoBars(symbol: string, period: BarPeriod, lastPrice = 1): MarketBar[] {
  const count = period === "minute" ? 120 : period === "month" ? 48 : period === "week" ? 80 : 160;
  const seed = [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const start = period === "minute" ? new Date("2026-07-22T01:30:00Z") : new Date("2026-01-01T00:00:00Z");
  return Array.from({ length: count }, (_, index) => {
    const drift = 1 + index / count * .16;
    const wave = Math.sin((index + seed) / 7) * .035 + Math.cos((index + seed) / 19) * .02;
    const close = lastPrice / 1.16 * (drift + wave);
    const open = close * (1 + Math.sin(index * 1.7) * .008);
    const high = Math.max(open, close) * 1.012;
    const low = Math.min(open, close) * .988;
    const date = new Date(start);
    if (period === "minute") date.setUTCMinutes(start.getUTCMinutes() + index);
    else if (period === "day") date.setUTCDate(start.getUTCDate() + index);
    else if (period === "week") date.setUTCDate(start.getUTCDate() + index * 7);
    else date.setUTCMonth(start.getUTCMonth() + index);
    return {
      time: period === "minute" ? date.toISOString().slice(0, 16).replace("T", " ") : date.toISOString().slice(0, 10),
      open: Number(open.toFixed(3)), high: Number(high.toFixed(3)), low: Number(low.toFixed(3)), close: Number(close.toFixed(3)),
      volume: 1_000_000 + (index % 17) * 170_000, amount: close * (1_000_000 + (index % 17) * 170_000),
    };
  });
}
