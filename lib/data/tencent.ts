import type { Board, Exchange, Quote } from "../domain/types";

const TENCENT_URL = "https://qt.gtimg.cn/q=";

function securityMeta(code: string, prefix?: string): { exchange: Exchange; board: Board; limitRate: number } {
  if (prefix === "bj" || /^(4|8|9)/.test(code)) return { exchange: "BJ", board: "BEIJING", limitRate: 0.3 };
  if (prefix === "sh" || /^6/.test(code)) {
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
