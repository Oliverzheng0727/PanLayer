import type { Board, Exchange, Quote } from "../domain/types";
import { classifyLimitStatus, rankSectors } from "../domain/metrics";
import type { MarketDataProvider } from "./provider";
import { classifyEtf } from "../etf/catalog";
import { fetchHistoricalBoardPools } from "../history/backfill-sources";
import { fetchTencentAdjustedBars, fetchTencentQuotes } from "./tencent";
import { withRetry } from "./resilience";

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
  f26?: number | string;
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

interface SinaQuoteRow {
  symbol?: string;
  code?: string;
  name?: string;
  trade?: number | string;
  changepercent?: number | string;
  settlement?: number | string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  amount?: number | string;
  turnoverratio?: number | string;
}

const numberValue = (value: number | string | undefined): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function securityMeta(code: string): { exchange: Exchange; board: Board; limitRate: number } {
  if (/^(9|8|4)/.test(code)) return { exchange: "BJ", board: "BEIJING", limitRate: 0.3 };
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
    listingDate: /^\d{8}$/.test(String(row.f26 ?? ""))
      ? `${String(row.f26).slice(0, 4)}-${String(row.f26).slice(4, 6)}-${String(row.f26).slice(6, 8)}`
      : null,
  };
}

const QUOTE_PAGE_SIZE = 100;
const QUOTE_PAGE_CONCURRENCY = 6;
const SOURCE_REQUEST_TIMEOUT_MS = 3_500;
const QUOTE_ORIGINS = [
  "https://push2.eastmoney.com",
  "http://40.push2.eastmoney.com",
  "https://82.push2.eastmoney.com",
  "https://48.push2.eastmoney.com",
];

function quotePageUrl(page: number, origin = QUOTE_ORIGINS[0]) {
  return `${origin}/api/qt/clist/get?pn=${page}&pz=${QUOTE_PAGE_SIZE}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048&fields=f12,f14,f2,f3,f6,f8,f15,f16,f17,f18,f26,f100`;
}

function limitPoolUrl(date: string) {
  return `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&d=${date.replaceAll("-", "")}`;
}

const SINA_COUNT_URL = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount?node=hs_a";
const A_SHARE_INDICES = [
  { symbol: "000001.SH", name: "上证指数", secid: "1.000001" },
  { symbol: "399001.SZ", name: "深证成指", secid: "0.399001" },
  { symbol: "399006.SZ", name: "创业板指", secid: "0.399006" },
  { symbol: "000688.SH", name: "科创50", secid: "1.000688" },
  { symbol: "000300.SH", name: "沪深300", secid: "1.000300" },
] as const;

function sinaPageUrl(page: number) {
  return `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=${QUOTE_PAGE_SIZE}&sort=symbol&asc=1&node=hs_a&symbol=&_s_r_a=page`;
}

function mapSinaQuote(row: SinaQuoteRow): Quote {
  return mapEastmoneyQuote({
    f12: String(row.code ?? String(row.symbol ?? "").replace(/^[a-z]+/i, "")),
    f14: String(row.name ?? row.code ?? ""),
    f2: numberValue(row.trade),
    f3: numberValue(row.changepercent),
    f6: numberValue(row.amount),
    f8: numberValue(row.turnoverratio),
    f15: numberValue(row.high),
    f16: numberValue(row.low),
    f17: numberValue(row.open),
    f18: numberValue(row.settlement),
    f100: "未分类",
  });
}

function timeFromNumber(value: number | string | undefined): string | null {
  const digits = String(value ?? "").padStart(6, "0");
  if (!/^\d{6}$/.test(digits)) return null;
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}`;
}

async function fetchJson<T>(fetcher: typeof fetch, url: string): Promise<T> {
  const response = await fetcher(url, {
    headers: { accept: "application/json", "user-agent": "PanLayer/1.0" },
    signal: AbortSignal.timeout(SOURCE_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Eastmoney ${response.status}`);
  return response.json() as Promise<T>;
}

async function loadPages<T>(
  pages: number[],
  concurrency: number,
  loader: (page: number) => Promise<T | null>,
): Promise<Array<T | null>> {
  const results: Array<T | null> = Array.from({ length: pages.length }, () => null);
  let cursor = 0;
  const worker = async () => {
    while (cursor < pages.length) {
      const index = cursor++;
      results[index] = await loader(pages[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, pages.length) }, worker),
  );
  return results;
}

export function createEastmoneyProvider(fetcher: typeof fetch = fetch): MarketDataProvider {
  type QuoteSnapshot = { quotes: Quote[]; total: number; source: string };
  const getEastmoneyQuotes = async (): Promise<QuoteSnapshot> => {
    let preferredOrigin = QUOTE_ORIGINS[0];
    const loadPage = async (page: number) => {
      let lastError: unknown;
      const origins = [preferredOrigin, ...QUOTE_ORIGINS.filter((origin) => origin !== preferredOrigin)];
      for (const [index, origin] of origins.entries()) {
        try {
          const payload = await fetchJson<{ data?: { total?: number; diff?: EastmoneyQuoteRow[] } }>(
            fetcher,
            quotePageUrl(page, origin),
          );
          preferredOrigin = origin;
          return payload;
        } catch (error) {
          lastError = error;
          if (index < origins.length - 1) await new Promise((resolve) => setTimeout(resolve, 120));
        }
      }
      throw lastError instanceof Error ? lastError : new Error("Eastmoney 行情页获取失败");
    };
    const firstPayload = await loadPage(1);
    const firstRows = Array.isArray(firstPayload?.data?.diff) ? firstPayload.data.diff : [];
    const total = Math.max(firstRows.length, numberValue(firstPayload?.data?.total));
    const effectivePageSize = Math.max(1, firstRows.length);
    const pageCount = Math.min(80, Math.max(1, Math.ceil(total / effectivePageSize)));
    const rows = [...firstRows];
    const remainingPages = Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => index + 2);
    const payloads = await loadPages(
      remainingPages,
      QUOTE_PAGE_CONCURRENCY,
      (page) => loadPage(page).catch(() => null),
    );
    payloads.forEach((payload) => {
      if (Array.isArray(payload?.data?.diff)) rows.push(...payload.data.diff);
    });
    const uniqueRows = [...new Map(rows.map((row) => [String(row.f12 ?? ""), row])).values()];
    return {
      quotes: uniqueRows.map(mapEastmoneyQuote).filter((item: Quote) => item.price > 0),
      total,
      source: "东方财富",
    };
  };

  const getSinaQuotes = async (): Promise<QuoteSnapshot> => {
    const totalPayload = await fetchJson<number | string>(fetcher, SINA_COUNT_URL);
    const total = Math.max(0, numberValue(totalPayload));
    if (total === 0) throw new Error("Sina 证券池为空");
    const pageCount = Math.min(80, Math.max(1, Math.ceil(total / QUOTE_PAGE_SIZE)));
    const rows: SinaQuoteRow[] = [];
    const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
    const payloads = await loadPages(
      pages,
      QUOTE_PAGE_CONCURRENCY,
      (page) => fetchJson<SinaQuoteRow[]>(fetcher, sinaPageUrl(page)).catch(() => null),
    );
    payloads.forEach((payload) => {
      if (Array.isArray(payload)) rows.push(...payload);
    });
    const uniqueRows = [...new Map(rows.map((row) => [String(row.code ?? row.symbol ?? ""), row])).values()];
    if (uniqueRows.length / total < 0.95) {
      throw new Error(`Sina 行情覆盖不足 ${uniqueRows.length}/${total}`);
    }
    return {
      quotes: uniqueRows.map(mapSinaQuote).filter((item) => item.price > 0),
      total,
      source: "新浪财经",
    };
  };

  let quoteSnapshot: Promise<QuoteSnapshot> | null = null;
  const loadQuoteSnapshot = async (): Promise<QuoteSnapshot> => {
    let eastmoney: QuoteSnapshot;
    try {
      eastmoney = await getEastmoneyQuotes();
    } catch (eastmoneyError) {
      try {
        return await getSinaQuotes();
      } catch (sinaError) {
        const primaryMessage = eastmoneyError instanceof Error ? eastmoneyError.message : "Eastmoney failed";
        const fallbackMessage = sinaError instanceof Error ? sinaError.message : "Sina failed";
        throw new Error(`${primaryMessage}；${fallbackMessage}`);
      }
    }
    if (eastmoney.total === 0 || eastmoney.quotes.length / eastmoney.total >= 0.95) {
      return eastmoney;
    }
    try {
      const sina = await getSinaQuotes();
      const quotes = [
        ...new Map(
          [...sina.quotes, ...eastmoney.quotes]
            .map((quote) => [quote.symbol, quote]),
        ).values(),
      ];
      const total = Math.max(eastmoney.total, sina.total, quotes.length);
      if (quotes.length / Math.max(1, total) < 0.95) {
        throw new Error(`合并行情覆盖不足 ${quotes.length}/${total}`);
      }
      return {
        quotes,
        total,
        source: "东方财富 / 新浪财经",
      };
    } catch (sinaError) {
      const fallbackMessage = sinaError instanceof Error ? sinaError.message : "Sina failed";
      throw new Error(
        `Eastmoney 行情覆盖不足 ${eastmoney.quotes.length}/${eastmoney.total}；${fallbackMessage}`,
      );
    }
  };
  const getQuoteSnapshot = () => {
    quoteSnapshot ??= loadQuoteSnapshot().catch((error) => {
      quoteSnapshot = null;
      throw error;
    });
    return quoteSnapshot;
  };
  const getQuotes = async (): Promise<Quote[]> =>
    (await getQuoteSnapshot()).quotes.filter((item) => !item.isST);

  return {
    name: "东方财富 / 新浪备用",
    getUniverse: getQuotes,
    getQuotes,
    getBoardPools(date) {
      return fetchHistoricalBoardPools(date, fetcher);
    },
    async getMarketAggregate(at) {
      const snapshot = await getQuoteSnapshot();
      const unique = [...new Map(snapshot.quotes.map((item) => [item.symbol, item])).values()];
      const valid = unique.filter((item) =>
        item.symbol
        && Number.isFinite(item.price)
        && item.price > 0
        && Number.isFinite(item.amount)
        && item.amount >= 0,
      );
      const denominator = Math.max(1, snapshot.total);
      const coveragePct = Number(((valid.length / denominator) * 100).toFixed(2));
      const complete = coveragePct >= 95;
      const receivedAt = new Date().toISOString();
      return {
        amount: complete
          ? Number((valid.reduce((sum, item) => sum + item.amount, 0) / 100_000_000).toFixed(2))
          : null,
        rawCount: unique.length,
        validCount: valid.length,
        coveragePct,
        marketTime: `${receivedAt.slice(0, 10)}T${at}:00+08:00`,
        receivedAt,
        source: snapshot.source,
        status: complete ? "complete" : "partial",
        message: complete ? "沪深京全 A（含 ST）成交额覆盖完整" : `全 A 行情覆盖率 ${coveragePct}%`,
      };
    },
    async getIndexSnapshots(date) {
      const receivedAt = new Date().toISOString();
      const beijingToday = new Date(Date.now() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
      const isCurrentDate = date === beijingToday;
      const tencentQuotes = isCurrentDate
        ? await withRetry(
          () => fetchTencentQuotes(A_SHARE_INDICES.map((item) => item.symbol), fetcher),
          { retries: 2, delayMs: 120 },
        ).catch(() => [])
        : [];
      const tencentBySymbol = new Map(tencentQuotes.map((item) => [item.symbol, item]));
      const datedBars = await Promise.all(A_SHARE_INDICES.map(async (item) => {
        const compactDate = date.replaceAll("-", "");
        const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${item.secid}&klt=101&fqt=0&lmt=1&end=${compactDate}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;
        try {
          const payload = await withRetry(
            () => fetchJson<{ data?: { klines?: string[] } }>(fetcher, url),
            { retries: 2, delayMs: 120 },
          );
          const row = payload?.data?.klines?.at(-1);
          if (!row) return null;
          const fields = row.split(",");
          if (fields[0] !== date) return null;
          const price = Number(fields[2]);
          const amount = Number(fields[6]);
          const pctChange = Number(fields[8]);
          if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(pctChange)) return null;
          return {
            price,
            pctChange,
            amount: Number.isFinite(amount) && amount >= 0 ? amount : null,
          };
        } catch {
          return null;
        }
      }));

      return A_SHARE_INDICES.map((item, index) => {
        const primary = tencentBySymbol.get(item.symbol);
        const cross = datedBars[index];
        if (!isCurrentDate && cross) {
          return {
            symbol: item.symbol,
            name: item.name,
            price: cross.price,
            pctChange: cross.pctChange,
            amount: cross.amount,
            marketTime: `${date}T15:00:00+08:00`,
            receivedAt,
            source: "东方财富历史K线",
            status: "partial" as const,
            message: "历史指数为东方财富单源日线，未使用当前行情冒充交叉源",
          };
        }
        if (primary && cross) {
          const priceAgreement = Math.abs(primary.price - cross.price) / Math.max(1, cross.price) <= .003;
          const directionAgreement = Math.abs(primary.pctChange - cross.pctChange) <= .3;
          const complete = priceAgreement && directionAgreement;
          return {
            symbol: item.symbol,
            name: item.name,
            price: primary.price,
            pctChange: primary.pctChange,
            amount: primary.amount > 0 ? primary.amount : cross.amount,
            marketTime: `${date}T15:00:00+08:00`,
            receivedAt,
            source: "腾讯 / 东方财富",
            status: complete ? "complete" as const : "partial" as const,
            message: complete ? "腾讯与东方财富收盘点位及涨跌幅一致" : "腾讯与东方财富指数快照存在差异",
          };
        }
        if (primary) {
          return {
            symbol: item.symbol,
            name: item.name,
            price: primary.price,
            pctChange: primary.pctChange,
            amount: primary.amount,
            marketTime: `${date}T15:00:00+08:00`,
            receivedAt,
            source: "腾讯",
            status: "partial" as const,
            message: "东方财富交叉源暂缺",
          };
        }
        if (cross) {
          return {
            symbol: item.symbol,
            name: item.name,
            price: cross.price,
            pctChange: cross.pctChange,
            amount: cross.amount,
            marketTime: `${date}T15:00:00+08:00`,
            receivedAt,
            source: "东方财富",
            status: "partial" as const,
            message: "腾讯主源暂缺",
          };
        }
        return {
          symbol: item.symbol,
          name: item.name,
          price: null,
          pctChange: null,
          amount: null,
          marketTime: `${date}T15:00:00+08:00`,
          receivedAt,
          source: "腾讯 / 东方财富",
          status: "failed" as const,
          message: "指数主源与交叉源均不可用",
        };
      });
    },
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
      try {
        const [code, exchange] = symbol.split(".");
        const secid = `${exchange === "SH" ? 1 : 0}.${code}`;
        const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&lmt=10000&end=20500101&fields1=f1,f2,f3&fields2=f51,f53,f56,f57,f59`;
        const payload = await fetchJson<{ data?: { klines?: string[] } }>(fetcher, url);
        const rows: string[] = Array.isArray(payload?.data?.klines) ? payload.data.klines : [];
        const bars = rows.map((row) => {
          const [date, close, volume, amount, pctChange] = row.split(",");
          return {
            date,
            close: numberValue(close),
            volume: numberValue(volume),
            amount: numberValue(amount),
            pctChange: numberValue(pctChange),
          };
        }).filter((bar) => bar.date && bar.close > 0);
        if (bars.length === 0) throw new Error("Eastmoney K-line returned no valid bars");
        return bars;
      } catch {
        return fetchTencentAdjustedBars(symbol, fetcher);
      }
    },
    async getSectors() {
      const quotes = await getQuotes();
      const grouped = new Map<string, Quote[]>();
      quotes.forEach((item) => grouped.set(item.sector, [...(grouped.get(item.sector) ?? []), item]));
      return rankSectors([...grouped].map(([name, items]) => ({
        name,
        limitUpCount: items.filter((item) => classifyLimitStatus(item) === "limit-up").length,
        averagePct: Number((items.reduce((sum, item) => sum + item.pctChange, 0) / items.length).toFixed(2)),
        amountGrowthPct: null,
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
      const filter = encodeURIComponent(`(DIM_DATE<='${date}')`);
      const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_WEB_RZRQ_LSSH&columns=ALL&filter=${filter}&pageNumber=1&pageSize=10&sortColumns=DIM_DATE&sortTypes=-1&source=WEB&client=WEB`;
      const payload = await fetchJson<{
        result?: {
          data?: Array<{
            DIM_DATE?: string;
            RZRQYE?: number | string;
            RZYE?: number | string;
          }>;
        };
      }>(fetcher, url);
      const rows = payload?.result?.data ?? [];
      const latestDate = rows
        .map((row) => row.DIM_DATE?.slice(0, 10))
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1);
      if (!latestDate) return null;
      const value = rows
        .filter((row) => row.DIM_DATE?.slice(0, 10) === latestDate)
        .reduce((sum, row) => sum + numberValue(row.RZRQYE ?? row.RZYE), 0);
      return value > 0 ? Number((value / 1e8).toFixed(2)) : null;
    },
  };
}
