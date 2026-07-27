import type { DailyComparison, DailyReview, RecognitionRanking } from "../domain/types";
import { resolveReviewStructureStatus } from "../domain/market-structure";

export const HISTORY_SORT_FIELDS = [
  "date", "rising", "falling", "flat", "riseFallRatio", "limitUp", "limitDown", "consecutive",
  "brokenCount", "largeDownCount", "sealRate", "yesterdaySuccessRate", "continuationAveragePct",
  "marketAmount", "maxStreak", "brokenBoardCount", "brokenBoardRate",
  "openPremium", "closePremium", "high20", "high120", "allTimeHigh", "marginBalance",
] as const;

export type HistorySortField = (typeof HISTORY_SORT_FIELDS)[number];
export type SortOrder = "asc" | "desc";

export interface HistoryRow {
  date: string;
  rising: number | null;
  falling: number | null;
  flat: number | null;
  riseFallRatio: number | null;
  limitUp: number | null;
  limitDown: number | null;
  largeRise: number | null;
  brokenCount: number | null;
  largeDownCount: number | null;
  sealRate: number | null;
  yesterdaySuccessRate: number | null;
  continuationPositiveRate: number | null;
  continuationAveragePct: number | null;
  continuationPromotionRate: number | null;
  marketAmount: number | null;
  consecutive: number | null;
  maxStreak: number;
  maxBoardNames: string;
  brokenBoardCount: number | null;
  brokenBoardRate: number | null;
  cycleLeader: string;
  recognition: string;
  recognitionCount?: number | null;
  recognitionTopScore?: number | null;
  recognitionLeader?: string;
  indexSummary: string;
  openPremium: number | null;
  closePremium: number | null;
  high20: number | null;
  high120: number | null;
  allTimeHigh: number | null;
  marginBalance: number | null;
  topSector: string;
  backfilled: boolean;
  status: "complete" | "partial" | "failed" | "demo";
  source: string;
  updatedAt: string;
  comparison?: DailyComparison;
  recognitionRanking?: RecognitionRanking;
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
  const comparison = review.comparison;
  const structureStatus = resolveReviewStructureStatus(review).status;
  const structureAvailable = structureStatus !== "failed";
  const maxStreak = structureAvailable
    ? comparison?.maxBoard?.height ?? Math.max(0, ...ladderItems.map((item) => item.limitStreak))
    : 0;
  const formatSignedPct = (value: number | null) =>
    value === null ? "暂缺" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  const recognitionRanking = review.recognitionRanking;
  const recognitionLeader = recognitionRanking?.items[0];
  const recognitionSummary = recognitionRanking
    ? recognitionLeader
      ? `入围${recognitionRanking.items.length}只 · ${recognitionLeader.name} · ${recognitionLeader.scores.total.toFixed(1)}分`
      : "入围0只 · 当日无共振入围"
    : structureAvailable
      ? comparison?.recognition.map((item) => item.name).join(" / ") || "新口径暂缺"
      : "新口径暂缺";
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
    brokenCount: comparison?.brokenCount ?? null,
    largeDownCount: comparison?.largeDownCount ?? null,
    sealRate: comparison?.sealRate ?? null,
    yesterdaySuccessRate: comparison?.yesterdaySuccessRate ?? null,
    continuationPositiveRate: comparison?.continuation?.positiveRate ?? null,
    continuationAveragePct: comparison?.continuation?.averagePct ?? null,
    continuationPromotionRate: comparison?.continuation?.promotionRate ?? null,
    marketAmount: comparison?.marketAmount ?? null,
    consecutive: structureAvailable ? review.metrics.consecutive : null,
    maxStreak,
    maxBoardNames: structureAvailable ? comparison?.maxBoard?.stocks.map((item) => item.name).join(" / ") ?? "—" : "—",
    brokenBoardCount: comparison?.brokenBoard.count ?? null,
    brokenBoardRate: comparison?.brokenBoard.rate ?? null,
    cycleLeader: structureAvailable && comparison?.cycleLeader
      ? `${comparison.cycleLeader.name} · ${comparison.cycleLeader.limitStreak}板`
      : "无明确周期龙头",
    recognition: recognitionSummary,
    recognitionCount: recognitionRanking?.items.length ?? null,
    recognitionTopScore: recognitionLeader?.scores.total ?? null,
    recognitionLeader: recognitionLeader?.name ?? "—",
    indexSummary: comparison?.indices.map((item) => `${item.name} ${formatSignedPct(item.pctChange)}`).join(" / ") || "暂缺",
    openPremium: review.premium.openPct,
    closePremium: review.premium.closePct,
    high20: review.metrics.high20 ?? null,
    high120: review.metrics.high120,
    allTimeHigh: review.metrics.allTimeHigh,
    marginBalance: review.metrics.marginBalance,
    topSector: structureAvailable
      ? comparison?.mainSectors.map((item) => item.name).join(" / ") || review.sectors[0]?.name || "—"
      : "—",
    backfilled: review.historyMeta?.backfilled === true,
    status: review.status,
    source: review.source,
    updatedAt: review.updatedAt,
    comparison,
    recognitionRanking,
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
