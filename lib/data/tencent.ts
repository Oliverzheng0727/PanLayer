import type { Board, Exchange, Quote } from "../domain/types";
import type { AdjustedBar, EtfSnapshot } from "./provider";

const TENCENT_URL = "https://qt.gtimg.cn/q=";
const TENCENT_KLINE_URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
const TENCENT_KLINE_FALLBACK_URL = "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get";
const TENCENT_KLINE_TIMEOUT_MS = 6_000;

function securityMeta(code: string, prefix?: string): { exchange: Exchange; board: Board; limitRate: number } {
  if (prefix === "bj" || /^(4|8|9)/.test(code)) return { exchange: "BJ", board: "BEIJING", limitRate: 0.3 };
  if (prefix === "sh" || /^(5|6)/.test(code)) {
    return /^688/.test(code)
      ? { exchange: "SH", board: "STAR", limitRate: 0.2 }
      : { exchange: "SH", board: "MAIN", limitRate: 0.1 };
  }
  return /^(300|301)/.test(code)
    ? { exchange: "SZ", board: "CHINEXT", limitRate: 0.2 }
    : { exchange: "SZ", board: "MAIN", limitRate: 0.1 };
}

const finiteNumber = (value: string | undefined): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const roundPrice = (value: number): number => Math.round(value * 100) / 100;

export function toTencentCode(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  const match = /^(\d{6})(?:\.(SH|SZ|BJ))?$/.exec(normalized);
  if (!match) throw new Error("Invalid market symbol");
  const [, code, explicitExchange] = match;
  const exchange = explicitExchange ?? securityMeta(code).exchange;
  return `${exchange.toLowerCase()}${code}`;
}

export function mapTencentLine(line: string): Quote | null {
  const match = /^v_((sh|sz|bj)(\d{6}))="([\s\S]*)";?$/.exec(line.trim());
  if (!match) return null;
  const [, , prefix, code, rawFields] = match;
  const fields = rawFields.split("~");
  const price = finiteNumber(fields[3]);
  const previousClose = finiteNumber(fields[4]);
  if (price === null || previousClose === null || price <= 0 || previousClose <= 0) return null;
  const meta = securityMeta(code, prefix);
  const pctChange = finiteNumber(fields[32]) ?? ((price / previousClose) - 1) * 100;
  const amountWan = finiteNumber(fields[37]);
  const name = fields[1]?.trim() || code;
  return {
    symbol: `${code}.${meta.exchange}`,
    name,
    exchange: meta.exchange,
    board: meta.board,
    isST: /ST|退/.test(name),
    isNoLimitDay: false,
    previousClose,
    open: finiteNumber(fields[5]) ?? price,
    price,
    high: finiteNumber(fields[33]) ?? price,
    low: finiteNumber(fields[34]) ?? price,
    pctChange: Number(pctChange.toFixed(4)),
    amount: amountWan === null ? 0 : amountWan * 10_000,
    turnoverRate: finiteNumber(fields[38]) ?? 0,
    limitUpPrice: roundPrice(previousClose * (1 + meta.limitRate)),
    limitDownPrice: roundPrice(previousClose * (1 - meta.limitRate)),
    sector: "未分类",
    firstLimitTime: null,
    limitStreak: 0,
  };
}

async function decodeTencentResponse(response: Response): Promise<string> {
  const bytes = await response.arrayBuffer();
  try {
    return new TextDecoder("gbk").decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export async function fetchTencentQuotes(
  symbols: string[],
  fetcher: typeof fetch = fetch,
  options: { batchSize?: number; concurrency?: number } = {},
): Promise<Quote[]> {
  const batchSize = Math.min(60, Math.max(1, options.batchSize ?? 60));
  const concurrency = Math.min(4, Math.max(1, options.concurrency ?? 4));
  const codes = [...new Set(symbols.map(toTencentCode))];
  const batches: string[][] = [];
  for (let index = 0; index < codes.length; index += batchSize) batches.push(codes.slice(index, index + batchSize));
  const results: Quote[][] = Array.from({ length: batches.length }, () => []);
  let cursor = 0;

  const worker = async () => {
    while (cursor < batches.length) {
      const index = cursor;
      cursor += 1;
      const response = await fetcher(`${TENCENT_URL}${batches[index].join(",")}`, {
        headers: { accept: "text/plain" },
      });
      if (!response.ok) throw new Error(`Tencent ${response.status}`);
      const body = await decodeTencentResponse(response);
      results[index] = body.split(/\r?\n/).flatMap((line) => {
        const quote = mapTencentLine(line);
        return quote && !quote.isST ? [quote] : [];
      });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, () => worker()));
  return results.flat();
}

function previousDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export async function fetchTencentAdjustedBars(
  symbol: string,
  fetcher: typeof fetch = fetch,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<AdjustedBar[]> {
  const marketCode = toTencentCode(symbol);
  const pageSize = Math.min(640, Math.max(2, options.pageSize ?? 640));
  const maxPages = Math.min(16, Math.max(1, options.maxPages ?? 12));
  const byDate = new Map<string, AdjustedBar>();
  let endDate = "";
  let previousEarliest = "";

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(TENCENT_KLINE_URL);
    url.searchParams.set("param", `${marketCode},day,,${endDate},${pageSize},qfq`);
    const response = await fetcher(url, {
      headers: {
        accept: "application/json",
        referer: "https://gu.qq.com/",
        "user-agent": "PanLayer/1.0",
      },
      signal: AbortSignal.timeout(TENCENT_KLINE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Tencent K-line ${response.status}`);
    const payload = await response.json() as {
      code?: number;
      data?: Record<string, { qfqday?: Array<Array<string | number>>; day?: Array<Array<string | number>> }>;
    };
    if (payload.code !== undefined && payload.code !== 0) {
      throw new Error(`Tencent K-line code ${payload.code}`);
    }
    const item = payload.data?.[marketCode];
    const rows = Array.isArray(item?.qfqday)
      ? item.qfqday
      : Array.isArray(item?.day)
        ? item.day
        : [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const date = String(row[0] ?? "");
      const close = Number(row[2]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close) && close > 0) {
        const volume = Number(row[5]);
        byDate.set(date, {
          date,
          close,
          volume: Number.isFinite(volume) ? volume : undefined,
        });
      }
    }

    const earliest = String(rows[0]?.[0] ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(earliest) || earliest === previousEarliest || rows.length <= pageSize) {
      break;
    }
    previousEarliest = earliest;
    endDate = previousDate(earliest);
  }

  const bars = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  if (bars.length === 0) throw new Error("Tencent K-line returned no valid bars");
  return bars;
}

export interface TencentAdjustedMarketBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
}

export async function fetchTencentAdjustedMarketBars(
  symbol: string,
  fetcher: typeof fetch = fetch,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<TencentAdjustedMarketBar[]> {
  const marketCode = toTencentCode(symbol);
  const pageSize = Math.min(640, Math.max(2, options.pageSize ?? 640));
  const maxPages = Math.min(16, Math.max(1, options.maxPages ?? 4));
  const byDate = new Map<string, TencentAdjustedMarketBar>();
  let endDate = "";
  let previousEarliest = "";

  for (let page = 0; page < maxPages; page += 1) {
    let payload: {
      code?: number;
      data?: Record<string, { qfqday?: Array<Array<string | number>> }>;
    } | null = null;
    let lastError: unknown;
    for (const endpoint of [TENCENT_KLINE_URL, TENCENT_KLINE_FALLBACK_URL]) {
      try {
        const url = new URL(endpoint);
        url.searchParams.set("param", `${marketCode},day,,${endDate},${pageSize},qfq`);
        const response = await fetcher(url, {
          headers: {
            accept: "application/json",
            referer: "https://gu.qq.com/",
            "user-agent": "PanLayer/1.0",
          },
          signal: AbortSignal.timeout(TENCENT_KLINE_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`Tencent K-line ${response.status}`);
        payload = await response.json() as {
          code?: number;
          data?: Record<string, { qfqday?: Array<Array<string | number>> }>;
        };
        if (payload.code !== undefined && payload.code !== 0) {
          throw new Error(`Tencent K-line code ${payload.code}`);
        }
        break;
      } catch (error) {
        payload = null;
        lastError = error;
      }
    }
    if (!payload) {
      throw lastError instanceof Error ? lastError : new Error("Tencent K-line unavailable");
    }
    if (payload.code !== undefined && payload.code !== 0) {
      throw new Error(`Tencent K-line code ${payload.code}`);
    }
    const rows = payload.data?.[marketCode]?.qfqday ?? [];
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      const time = String(row[0] ?? "");
      const open = Number(row[1]);
      const close = Number(row[2]);
      const high = Number(row[3]);
      const low = Number(row[4]);
      const volume = Number(row[5]);
      const amount = Number(row[8] ?? row[6] ?? 0);
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(time)
        && [open, close, high, low].every((value) => Number.isFinite(value) && value > 0)
        && high >= Math.max(open, close, low)
        && low <= Math.min(open, close, high)
      ) {
        byDate.set(time, {
          time,
          open,
          high,
          low,
          close,
          volume: Number.isFinite(volume) && volume >= 0 ? volume : 0,
          amount: Number.isFinite(amount) && amount >= 0 ? amount : 0,
        });
      }
    }
    const earliest = String(rows[0]?.[0] ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(earliest) || earliest === previousEarliest || rows.length < pageSize) break;
    previousEarliest = earliest;
    endDate = previousDate(earliest);
  }
  const bars = [...byDate.values()].toSorted((left, right) => left.time.localeCompare(right.time));
  if (bars.length === 0) throw new Error("Tencent qfq returned no valid OHLC bars");
  return bars;
}

export async function refreshEtfCatalogFromTencent(
  catalog: EtfSnapshot[],
  fetcher: typeof fetch = fetch,
  options: { minimumCoverage?: number; now?: Date } = {},
): Promise<EtfSnapshot[]> {
  if (catalog.length === 0) throw new Error("Tencent ETF universe is empty");
  const quotes = await fetchTencentQuotes(
    catalog.map((item) => `${item.symbol}.${item.exchange}`),
    fetcher,
  );
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol.split(".")[0], quote]));
  const coverage = quoteBySymbol.size / catalog.length;
  const minimumCoverage = options.minimumCoverage ?? 0.7;
  if (coverage < minimumCoverage) {
    throw new Error(`Tencent ETF coverage ${(coverage * 100).toFixed(1)}% is below ${(minimumCoverage * 100).toFixed(1)}%`);
  }
  const updatedAt = (options.now ?? new Date()).toISOString();
  return catalog.map((item) => {
    const quote = quoteBySymbol.get(item.symbol);
    return quote ? {
      ...item,
      name: quote.name || item.name,
      price: quote.price,
      pctChange: quote.pctChange,
      amount: quote.amount,
      turnoverRate: quote.turnoverRate || item.turnoverRate,
      updatedAt,
    } : item;
  });
}
