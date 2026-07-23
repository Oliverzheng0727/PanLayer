import { classifyEtf } from "../etf/catalog";
import type { EtfSnapshot } from "./provider";

const SINA_BASE_URL = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php";
const PAGE_SIZE = 100;

type SinaEtfRow = {
  symbol?: unknown;
  code?: unknown;
  name?: unknown;
  trade?: unknown;
  changepercent?: unknown;
  amount?: unknown;
  nmc?: unknown;
  turnoverratio?: unknown;
};

const numberValue = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

async function readJson<T>(fetcher: typeof fetch, url: string): Promise<T> {
  const response = await fetcher(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Sina ETF ${response.status}`);
  return response.json() as Promise<T>;
}

export async function fetchSinaEtfs(
  fetcher: typeof fetch = fetch,
  options: { concurrency?: number; now?: Date } = {},
): Promise<EtfSnapshot[]> {
  const countUrl = `${SINA_BASE_URL}/Market_Center.getHQNodeStockCount?node=etf_hq_fund`;
  const total = Math.max(0, numberValue(await readJson<unknown>(fetcher, countUrl)));
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pages: SinaEtfRow[][] = Array.from({ length: pageCount }, () => []);
  const concurrency = Math.min(4, Math.max(1, options.concurrency ?? 4));
  let cursor = 0;

  const worker = async () => {
    while (cursor < pageCount) {
      const index = cursor;
      cursor += 1;
      const params = new URLSearchParams({
        page: String(index + 1),
        num: String(PAGE_SIZE),
        sort: "amount",
        asc: "0",
        node: "etf_hq_fund",
        symbol: "",
        _s_r_a: "page",
      });
      const rows = await readJson<unknown>(fetcher, `${SINA_BASE_URL}/Market_Center.getHQNodeData?${params}`);
      pages[index] = Array.isArray(rows) ? rows as SinaEtfRow[] : [];
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pageCount) }, () => worker()));

  const updatedAt = (options.now ?? new Date()).toISOString();
  const uniqueRows = [...new Map(pages.flat().map((row) => [String(row.code ?? ""), row])).values()];
  const items = uniqueRows.flatMap((row): EtfSnapshot[] => {
    const symbol = String(row.code ?? "").trim();
    const rawSymbol = String(row.symbol ?? "").toLowerCase();
    const name = String(row.name ?? "").trim();
    const price = numberValue(row.trade);
    if (!/^\d{6}$/.test(symbol) || !name || price <= 0) return [];
    const classified = classifyEtf(name);
    return [{
      symbol,
      name,
      category: classified.category,
      tags: classified.tags,
      exchange: rawSymbol.startsWith("sh") || symbol.startsWith("5") ? "SH" : rawSymbol.startsWith("sz") || symbol.startsWith("1") ? "SZ" : "OTHER",
      price,
      pctChange: numberValue(row.changepercent),
      amount: numberValue(row.amount),
      averageAmount20: null,
      scale: numberValue(row.nmc) > 0 ? numberValue(row.nmc) * 10_000 : null,
      turnoverRate: numberValue(row.turnoverratio) || null,
      status: "active",
      updatedAt,
    }];
  });
  if (items.length === 0) throw new Error("Sina ETF catalog is empty");
  return items;
}
