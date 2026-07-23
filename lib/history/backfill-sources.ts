const SOURCE_TIMEOUT_MS = 4_500;
const SINA_TRADING_DATES =
  "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/" +
  "CN_MarketData.getKLineData?symbol=sh000001&scale=240&ma=no&datalen=90";
const EASTMONEY_TOKEN = "7eea3edcaed734bea9cbfc24409ed989";

const POOLS = {
  limitUp: ["getTopicZTPool", "fbt:asc"],
  broken: ["getTopicZBPool", "fbt:asc"],
  limitDown: ["getTopicDTPool", "fund:asc"],
  yesterdayLimitUp: ["getYesterdayZTPool", "zs:desc"],
} as const;

export interface HistoricalPoolItem {
  code: string;
  name: string;
  pctChange: number;
  amount: number;
  industry: string;
  limitStreak: number;
  firstLimitTime: string | null;
}

export interface HistoricalBoardPools {
  limitUp: HistoricalPoolItem[];
  broken: HistoricalPoolItem[];
  limitDown: HistoricalPoolItem[];
  yesterdayLimitUp: HistoricalPoolItem[];
}

interface EastmoneyPoolItem {
  c?: string | number;
  n?: string;
  zdp?: number | string;
  amount?: number | string;
  hybk?: string;
  lbc?: number | string;
  ylbc?: number | string;
  fbt?: number | string;
  yfbt?: number | string;
}

const numberValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function formatPoolTime(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const digits = String(value).replace(/\D/g, "").padStart(6, "0").slice(-6);
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}`;
}

function sourceRequestInit(referer: string): RequestInit {
  return {
    headers: {
      accept: "application/json",
      referer,
      "user-agent": "PanLayer/1.0",
    },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  };
}

async function fetchText(url: string, referer: string, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(url, sourceRequestInit(referer));
  if (!response.ok) throw new Error(`history source ${response.status}`);
  return response.text();
}

export async function fetchRecentTradingDates(
  endDate: string,
  count: number,
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  const text = await fetchText(SINA_TRADING_DATES, "https://finance.sina.com.cn/", fetcher);
  let rows: Array<{ day?: string; close?: string | number }>;
  try {
    rows = JSON.parse(text) as Array<{ day?: string; close?: string | number }>;
  } catch {
    throw new Error("Sina trading dates malformed JSON");
  }
  if (!Array.isArray(rows)) throw new Error("Sina trading dates missing rows");
  const dates = rows
    .filter((row) => typeof row.day === "string" && row.day <= endDate && numberValue(row.close) > 0)
    .map((row) => row.day!)
    .toSorted((left, right) => right.localeCompare(left));
  return [...new Set(dates)].slice(0, Math.max(0, count));
}

function mapPoolItem(item: EastmoneyPoolItem): HistoricalPoolItem {
  return {
    code: String(item.c ?? ""),
    name: String(item.n ?? ""),
    pctChange: numberValue(item.zdp),
    amount: numberValue(item.amount),
    industry: String(item.hybk ?? "未分类") || "未分类",
    limitStreak: Math.max(0, Math.trunc(numberValue(item.lbc ?? item.ylbc))),
    firstLimitTime: formatPoolTime(item.fbt ?? item.yfbt),
  };
}

async function fetchPool(
  endpoint: string,
  sort: string,
  date: string,
  fetcher: typeof fetch,
): Promise<HistoricalPoolItem[]> {
  const compactDate = date.replaceAll("-", "");
  const params = new URLSearchParams({
    ut: EASTMONEY_TOKEN,
    dpt: "wz.ztzt",
    Pageindex: "0",
    pagesize: "10000",
    sort,
    date: compactDate,
  });
  const text = await fetchText(
    `https://push2ex.eastmoney.com/${endpoint}?${params}`,
    "https://quote.eastmoney.com/",
    fetcher,
  );
  let payload: { data?: { pool?: EastmoneyPoolItem[] } | null };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    throw new Error(`Eastmoney ${endpoint} malformed JSON`);
  }
  if (!payload.data || !Array.isArray(payload.data.pool)) {
    throw new Error(`Eastmoney ${endpoint} missing pool`);
  }
  return payload.data.pool.map(mapPoolItem).filter((item) => item.code);
}

export async function fetchHistoricalBoardPools(
  date: string,
  fetcher: typeof fetch = fetch,
): Promise<HistoricalBoardPools> {
  const entries = await Promise.all(
    Object.entries(POOLS).map(async ([key, [endpoint, sort]]) => [
      key,
      await fetchPool(endpoint, sort, date, fetcher),
    ] as const),
  );
  return Object.fromEntries(entries) as unknown as HistoricalBoardPools;
}
