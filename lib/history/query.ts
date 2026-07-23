import type { DailyReview } from "../domain/types";

export const HISTORY_SORT_FIELDS = [
  "date", "rising", "falling", "riseFallRatio", "limitUp", "limitDown", "consecutive",
  "maxStreak", "openPremium", "closePremium", "high120", "allTimeHigh", "marginBalance",
] as const;

export type HistorySortField = (typeof HISTORY_SORT_FIELDS)[number];
export type SortOrder = "asc" | "desc";

export interface HistoryRow {
  date: string;
  rising: number | null;
  falling: number | null;
  flat: number | null;
  riseFallRatio: number | null;
  limitUp: number;
  limitDown: number;
  largeRise: number | null;
  consecutive: number;
  maxStreak: number;
  openPremium: number | null;
  closePremium: number | null;
  high120: number | null;
  allTimeHigh: number | null;
  marginBalance: number | null;
  topSector: string;
  backfilled: boolean;
  status: "complete" | "partial" | "failed" | "demo";
  source: string;
  updatedAt: string;
}

export interface HistoryQuery {
  sort: HistorySortField;
  order: SortOrder;
  sector: string;
  cursor: number;
  limit: number;
}

export interface HistoryPage {
  items: HistoryRow[];
  nextCursor: number | null;
}

export function reviewToHistoryRow(review: DailyReview): HistoryRow {
  const closeBreadth = review.breadth.at(-1);
  const rising = closeBreadth?.rising ?? null;
  const falling = closeBreadth?.falling ?? null;
  const ladderItems = Object.values(review.ladder).flat();
  return {
    date: review.date,
    rising,
    falling,
    flat: closeBreadth?.flat ?? null,
    riseFallRatio: rising !== null && falling !== null && falling > 0
      ? Number((rising / falling).toFixed(2))
      : null,
    limitUp: review.metrics.limitUp,
    limitDown: review.metrics.limitDown,
    largeRise: review.metrics.largeRise,
    consecutive: review.metrics.consecutive,
    maxStreak: Math.max(0, ...ladderItems.map((item) => item.limitStreak)),
    openPremium: review.premium.openPct,
    closePremium: review.premium.closePct,
    high120: review.metrics.high120,
    allTimeHigh: review.metrics.allTimeHigh,
    marginBalance: review.metrics.marginBalance,
    topSector: review.sectors[0]?.name ?? "—",
    backfilled: review.historyMeta?.backfilled === true,
    status: review.status,
    source: review.source,
    updatedAt: review.updatedAt,
  };
}

export function parseHistoryQuery(params: URLSearchParams): HistoryQuery {
  const sort = params.get("sort") ?? "date";
  if (!HISTORY_SORT_FIELDS.includes(sort as HistorySortField)) throw new Error("invalid history sort");
  const order = params.get("order") ?? "desc";
  if (order !== "asc" && order !== "desc") throw new Error("invalid history order");
  const rawCursor = Number(params.get("cursor") ?? 0);
  const rawLimit = Number(params.get("limit") ?? 30);
  return {
    sort: sort as HistorySortField,
    order,
    sector: (params.get("sector") ?? "").trim(),
    cursor: Number.isInteger(rawCursor) && rawCursor >= 0 ? rawCursor : 0,
    limit: Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 30,
  };
}

function compareValue(left: string | number | null, right: string | number | null): number {
  return typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right), "zh-CN");
}

export function queryHistoryRows(rows: HistoryRow[], query: HistoryQuery): HistoryPage {
  const needle = query.sector.toLocaleLowerCase("zh-CN");
  const filtered = needle
    ? rows.filter((row) => row.topSector.toLocaleLowerCase("zh-CN").includes(needle))
    : rows;
  const direction = query.order === "asc" ? 1 : -1;
  const sorted = filtered.toSorted((left, right) => {
    const leftValue = left[query.sort];
    const rightValue = right[query.sort];
    if (leftValue === null || rightValue === null) {
      if (leftValue === null && rightValue === null) return right.date.localeCompare(left.date);
      return leftValue === null ? 1 : -1;
    }
    const compared = compareValue(leftValue, rightValue);
    return compared === 0 ? right.date.localeCompare(left.date) : compared * direction;
  });
  const items = sorted.slice(query.cursor, query.cursor + query.limit);
  const next = query.cursor + items.length;
  return { items, nextCursor: next < sorted.length ? next : null };
}
