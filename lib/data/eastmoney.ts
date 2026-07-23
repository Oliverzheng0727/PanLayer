import type { Board, Exchange, Quote } from "../domain/types";
import { classifyLimitStatus, rankSectors } from "../domain/metrics";
import type { MarketDataProvider } from "./provider";
import { classifyEtf } from "../etf/catalog";

export interface EastmoneyQuoteRow {
  f12: string;
  f14: string;
  f2: number | string;
  f3: number | string;
  f6: number | string;
  f8: number | string;
  f15: number | string;
  f16: number | string;
  f17: number | string;
  f18: number | string;
  f100?: string;
}

interface LimitPoolRow {
  c?: string;
  n?: string;
  p?: number | string;
  zdp?: number | string;
  amount?: number | string;
  hs?: number | string;
  hybk?: string;
  fbt?: number | string;
  lbc?: number | string;
}

interface EtfRow {
  f12?: string;
  f14?: string;
  f2?: number | string;
  f3?: number | string;
  f6?: number | string;
  f20?: number | string;
  f8?: number | string;
}

const numberValue = (value: number | string | undefined): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function securityMeta(code: string): { exchange: Exchange; board: Board; limitRate: number } {
  if (/^(8|4)/.test(code)) return { exchange: "BJ", board: "BEIJING", limitRate: 0.3 };
  if (/^688/.test(code)) return { exchange: "SH", board: "STAR", limitRate: 0.2 };
  if (/^(300|301)/.test(code)) return { exchange: "SZ", board: "CHINEXT", limitRate: 0.2 };
  if (/^6/.test(code)) return { exchange: "SH", board: "MAIN", limitRate: 0.1 };
  return { exchange: "SZ", board: "MAIN", limitRate: 0.1 };
}

export function mapEastmoneyQuote(row: EastmoneyQuoteRow): Quote {
  const meta = securityMeta(row.f12);
  const previousClose = numberValue(row.f18);
  const roundPrice = (value: number) => Math.round(value * 100) / 100;
  return {
    symbol: `${row.f12}.${meta.exchange}`,
    name: row.f14,
    exchange: meta.exchange,
    board: meta.board,
    isST: /ST|退/.test(row.f14),
    isNoLimitDay: false,
    previousClose,
    open: numberValue(row.f17),
    price: numberValue(row.f2),
    high: numberValue(row.f15),
    low: numberValue(row.f16),
    pctChange: numberValue(row.f3),
    amount: numberValue(row.f6),
    turnoverRate: numberValue(row.f8),
    limitUpPrice: roundPrice(previousClose * (1 + meta.limitRate)),
    limitDownPrice: roundPrice(previousClose * (1 - meta.limitRate)),
    sector: row.f100 || "未分类",
    firstLimitTime: null,
    limitStreak: 0,
  };
}

const QUOTE_PAGE_SIZE = 100;

function quotePageUrl(page: number) {
  return `https://82.push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=${QUOTE_PAGE_SIZE}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048&fields=f12,f14,f2,f3,f6,f8,f15,f16,f17,f18,f100`;
}

function limitPoolUrl(date: string) {
  return `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&d=${date.replaceAll("-", "")}`;
}

function timeFromNumber(value: number | string | undefined): string | null {
  const digits = String(value ?? "").padStart(6, "0");
  if (!/^\d{6}$/.test(digits)) return null;
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}`;
}

async function fetchJson<T>(fetcher: typeof fetch, url: string): Promise<T> {
  const response = await fetcher(url, { headers: { accept: "application/json", "user-agent": "PanLayer/1.0" } });
  if (!response.ok) throw new Error(`Eastmoney ${response.status}`);
  return response.json() as Promise<T>;
}

export function createEastmoneyProvider(fetcher: typeof fetch = fetch): MarketDataProvider {
  const getQuotes = async (): Promise<Quote[]> => {
    const firstPayload = await fetchJson<{ data?: { total?: number; diff?: EastmoneyQuoteRow[] } }>(fetcher, quotePageUrl(1));
    const firstRows = Array.isArray(firstPayload?.data?.diff) ? firstPayload.data.diff : [];
    const total = Math.max(firstRows.length, numberValue(firstPayload?.data?.total));
    const effectivePageSize = Math.max(1, firstRows.length);
    const pageCount = Math.min(80, Math.max(1, Math.ceil(total / effectivePageSize)));
    const rows = [...firstRows];
    for (let start = 2; start <= pageCount; start += 6) {
      const pages = Array.from({ length: Math.min(6, pageCount - start + 1) }, (_, index) => start + index);
      const payloads = await Promise.all(pages.map((page) => fetchJson<{ data?: { diff?: EastmoneyQuoteRow[] } }>(fetcher, quotePageUrl(page))));
      payloads.forEach((payload) => {
        if (Array.isArray(payload?.data?.diff)) rows.push(...payload.data.diff);
      });
    }
    const uniqueRows = [...new Map(rows.map((row) => [String(row.f12 ?? ""), row])).values()];
    return uniqueRows.map(mapEastmoneyQuote).filter((item: Quote) => !item.isST && item.price > 0);
  };

  return {
    name: "东方财富",
    getUniverse: getQuotes,
    getQuotes,
    async getLimitPool(date) {
      const payload = await fetchJson<{ data?: { pool?: LimitPoolRow[] } }>(fetcher, limitPoolUrl(date));
      const rows = Array.isArray(payload?.data?.pool) ? payload.data.pool : [];
      return rows.map((row) => {
        const code = String(row.c ?? "");
        const current = numberValue(row.p) / 1000;
        const pct = numberValue(row.zdp);
        const previousClose = pct === -100 ? current : current / (1 + pct / 100);
        const base = mapEastmoneyQuote({
          f12: code,
          f14: String(row.n ?? code),
          f2: current,
          f3: pct,
          f6: numberValue(row.amount),
          f8: numberValue(row.hs),
          f15: current,
          f16: current,
          f17: current,
          f18: previousClose,
          f100: String(row.hybk ?? "未分类"),
        });
        return {
          ...base,
          limitUpPrice: current,
          firstLimitTime: timeFromNumber(row.fbt),
          limitStreak: Math.max(1, numberValue(row.lbc)),
        };
      }).filter((item: Quote) => !item.isST);
    },
    async getAdjustedBars(symbol) {
      const [code, exchange] = symbol.split(".");
      const secid = `${exchange === "SH" ? 1 : 0}.${code}`;
      const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&lmt=10000&end=20500101&fields1=f1,f2,f3&fields2=f51,f53`;
      const payload = await fetchJson<{ data?: { klines?: string[] } }>(fetcher, url);
      const rows: string[] = Array.isArray(payload?.data?.klines) ? payload.data.klines : [];
      return rows.map((row) => {
        const [date, close] = row.split(",");
        return { date, close: numberValue(close) };
      }).filter((bar) => bar.date && bar.close > 0);
    },
    async getSectors() {
      const quotes = await getQuotes();
      const grouped = new Map<string, Quote[]>();
      quotes.forEach((item) => grouped.set(item.sector, [...(grouped.get(item.sector) ?? []), item]));
      return rankSectors([...grouped].map(([name, items]) => ({
        name,
        limitUpCount: items.filter((item) => classifyLimitStatus(item) === "limit-up").length,
        averagePct: Number((items.reduce((sum, item) => sum + item.pctChange, 0) / items.length).toFixed(2)),
        amountGrowthPct: 0,
        maxStreak: Math.max(0, ...items.map((item) => item.limitStreak)),
      })));
    },
    async getEtfs() {
      const etfPageUrl = (page: number) => `https://88.push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f6&fs=b:MK0021,b:MK0022,b:MK0023,b:MK0024&fields=f12,f14,f2,f3,f6,f8,f20`;
      const firstPayload = await fetchJson<{ data?: { total?: number; diff?: EtfRow[] } }>(fetcher, etfPageUrl(1));
      const firstRows = Array.isArray(firstPayload?.data?.diff) ? firstPayload.data.diff : [];
      const total = Math.max(firstRows.length, numberValue(firstPayload?.data?.total));
      const effectivePageSize = Math.max(1, firstRows.length);
      const pageCount = Math.min(50, Math.max(1, Math.ceil(total / effectivePageSize)));
      const rows = [...firstRows];
      for (let start = 2; start <= pageCount; start += 4) {
        const pages = Array.from({ length: Math.min(4, pageCount - start + 1) }, (_, index) => start + index);
        const payloads = await Promise.all(pages.map((page) => fetchJson<{ data?: { diff?: EtfRow[] } }>(fetcher, etfPageUrl(page))));
        payloads.forEach((payload) => {
          if (Array.isArray(payload?.data?.diff)) rows.push(...payload.data.diff);
        });
      }
      const uniqueRows = [...new Map(rows.map((row) => [String(row.f12 ?? ""), row])).values()];
      return uniqueRows.map((row) => {
        const symbol = String(row.f12 ?? "");
        const name = String(row.f14 ?? "");
        const classified = classifyEtf(name);
        return {
          symbol, name, category: classified.category, tags: classified.tags,
          exchange: (symbol.startsWith("5") ? "SH" : symbol.startsWith("1") ? "SZ" : "OTHER") as "SH" | "SZ" | "OTHER",
          price: numberValue(row.f2), pctChange: numberValue(row.f3), amount: numberValue(row.f6),
          averageAmount20: null, scale: numberValue(row.f20) || null, turnoverRate: numberValue(row.f8) || null,
          status: "active" as const, updatedAt: new Date().toISOString(),
        };
      }).filter((item) => item.symbol && item.price > 0);
    },
    async getMarginBalance(date) {
      const filter = encodeURIComponent(`(TRADE_DATE='${date}')`);
      const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_WEB_RZRQ_LSSH&columns=ALL&filter=${filter}&pageNumber=1&pageSize=10&sortColumns=TRADE_DATE&sortTypes=-1&source=WEB&client=WEB`;
      const payload = await fetchJson<{ result?: { data?: Array<{ RZRQYE?: number | string; RZYE?: number | string }> } }>(fetcher, url);
      const row = payload?.result?.data?.[0];
      const value = numberValue(row?.RZRQYE ?? row?.RZYE);
      return value > 0 ? value : null;
    },
  };
}
