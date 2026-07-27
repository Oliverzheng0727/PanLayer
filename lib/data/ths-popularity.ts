export interface PopularityStock {
  symbol: string;
  name: string;
  rank: number;
  rankChange: number;
  heat: number | null;
  concepts: string[];
  analysisTitle: string | null;
}

export interface PopularitySnapshot {
  source: string;
  status: "complete" | "partial" | "failed";
  marketTime: string;
  receivedAt: string;
  rawCount: number;
  items: PopularityStock[];
  message: string;
}

interface ThsHotRow {
  market?: number;
  code?: string;
  rate?: string | number;
  name?: string;
  hot_rank_chg?: number;
  order?: number;
  analyse_title?: string;
  tag?: {
    concept_tag?: string[];
    popularity_tag?: string;
  };
}

const THS_HOT_LIST_URL =
  "https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock?stock_type=a&type=day&list_type=normal";

function exchangeFor(code: string): "SH" | "SZ" | "BJ" {
  if (/^(4|8|9)/.test(code)) return "BJ";
  return /^6/.test(code) ? "SH" : "SZ";
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function fetchThsPopularitySnapshot(
  date: string,
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<PopularitySnapshot> {
  const receivedAt = now.toISOString();
  const marketTime = `${date}T15:00:00+08:00`;
  try {
    const response = await fetcher(THS_HOT_LIST_URL, {
      headers: {
        accept: "application/json,text/plain,*/*",
        referer: "https://www.10jqka.com.cn/",
        "user-agent": "Mozilla/5.0 PanLayer/1.0",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`同花顺热榜 ${response.status}`);
    const payload = await response.json() as {
      status_code?: number;
      data?: { stock_list?: ThsHotRow[] };
    };
    if (payload.status_code !== 0) throw new Error(`同花顺热榜 code ${payload.status_code ?? "unknown"}`);
    const rows = Array.isArray(payload.data?.stock_list) ? payload.data!.stock_list! : [];
    const items = [...new Map(rows.flatMap((row) => {
      const code = String(row.code ?? "").trim();
      const rank = finiteNumber(row.order);
      const name = String(row.name ?? "").trim();
      if (!/^\d{6}$/.test(code) || rank === null || rank < 1 || rank > 30 || !name) return [];
      // Preserve the source ranking exactly. ST, delisting and other base
      // exclusions are applied later by the deterministic ranking gate.
      if (/转债/i.test(name)) return [];
      const concepts = Array.isArray(row.tag?.concept_tag)
        ? row.tag!.concept_tag!.map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
        : [];
      const item: PopularityStock = {
        symbol: `${code}.${exchangeFor(code)}`,
        name,
        rank,
        rankChange: finiteNumber(row.hot_rank_chg) ?? 0,
        heat: finiteNumber(row.rate),
        concepts,
        analysisTitle: String(row.analyse_title ?? row.tag?.popularity_tag ?? "").trim() || null,
      };
      return [[item.symbol, item] as const];
    })).values()].toSorted((left, right) => left.rank - right.rank).slice(0, 30);
    const status = items.length >= 30 ? "complete" : items.length > 0 ? "partial" : "failed";
    return {
      source: "同花顺热榜",
      status,
      marketTime,
      receivedAt,
      rawCount: rows.length,
      items,
      message: status === "complete"
        ? "同花顺日榜前30已采集"
        : items.length > 0 ? `同花顺日榜仅取得 ${items.length}/30` : "同花顺热榜返回空数据",
    };
  } catch (error) {
    return {
      source: "同花顺热榜",
      status: "failed",
      marketTime,
      receivedAt,
      rawCount: 0,
      items: [],
      message: error instanceof Error ? error.message : "同花顺热榜采集失败",
    };
  }
}
