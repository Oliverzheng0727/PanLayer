import type { DailyReview } from "../domain/types";

export const HISTORY_SORT_FIELDS = [
  "date", "rising", "falling", "limitUp", "limitDown", "consecutive",
  "maxStreak", "openPremium", "closePremium", "high120", "allTimeHigh",
] as const;

export type HistorySortField = (typeof HISTORY_SORT_FIELDS)[number];
export type SortOrder = "asc" | "desc";

export interface HistoryRow {
  date: string;
  rising: number;
  falling: number;
  flat: number;
  limitUp: number;
  limitDown: number;
  largeRise: number;
  consecutive: number;
  maxStreak: number;
  openPremium: number | null;
  closePremium: number | null;
  high120: number | null;
  allTimeHigh: number | null;
  topSector: string;
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
  const closeBreadth = review.breadth.at(-1) ?? { rising: 0, falling: 0, flat: 0 };
  const ladderItems = Object.values(review.ladder).flat();
  return {
    date: review.date,
    rising: closeBreadth.rising,
    falling: closeBreadth.falling,
    flat: closeBreadth.flat,
    limitUp: review.metrics.limitUp,
    limitDown: review.metrics.limitDown,
    largeRise: review.metrics.largeRise,
    consecutive: review.metrics.consecutive,
    maxStreak: Math.max(0, ...ladderItems.map((item) => item.limitStreak)),
    openPremium: review.premium.openPct,
    closePremium: review.premium.closePct,
    high120: review.metrics.high120,
    allTimeHigh: review.metrics.allTimeHigh,
    topSector: review.sectors[0]?.name ?? "—",
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
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
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
    const compared = compareValue(left[query.sort], right[query.sort]);
    return compared === 0 ? right.date.localeCompare(left.date) : compared * direction;
  });
  const items = sorted.slice(query.cursor, query.cursor + query.limit);
  const next = query.cursor + items.length;
  return { items, nextCursor: next < sorted.length ? next : null };
}
