import type { DailyReview, SectorMetric } from "./types";

export interface ResolvedStructureStatus {
  status: "complete" | "partial" | "failed";
  message: string;
}

export function isVerifiedSectorMetric(sector: SectorMetric): boolean {
  const name = sector.name.trim();
  return Boolean(name)
    && name !== "未分类"
    && name !== "-"
    && sector.limitUpCount > 0
    && sector.maxStreak >= 1;
}

export function resolveReviewSectorStatus(review: DailyReview): ResolvedStructureStatus {
  const verified = review.sectors.filter(isVerifiedSectorMetric);
  const evidence = review.structuredSignals?.evidence.sectors;
  if (verified.length === 0) {
    return {
      status: "failed",
      message: evidence?.message
        ? `${evidence.message}；未展示“未分类”占位数据`
        : "板块分类数据暂缺；未展示“未分类”占位数据",
    };
  }
  return {
    status: evidence?.status === "complete" ? "complete" : "partial",
    message: evidence?.message || "热点板块来自已验证涨停归属，板块指数仍待交叉校验",
  };
}

export function resolveReviewStructureStatus(review: DailyReview): ResolvedStructureStatus {
  if (review.structure) {
    return {
      status: review.structure.status,
      message: review.structure.message,
    };
  }

  const ladderItems = Object.values(review.ladder).flat();
  const hasPositiveBoardHeight = ladderItems.some((item) => item.limitStreak >= 1);
  const hasOnlyZeroBoardItems = ladderItems.length > 0
    && ladderItems.every((item) => item.limitStreak <= 0);
  const hasOnlyUnclassifiedSectors = review.sectors.length > 0
    && review.sectors.every((sector) => !sector.name || sector.name === "未分类");
  const hasQuoteOnlyLeaders = review.leaders.length > 0
    && review.leaders.every((item) => item.limitStreak <= 0);
  const hasVerifiedComparison = Boolean(
    review.comparison?.maxBoard
    || review.comparison?.cycleLeader
    || review.comparison?.recognition.length,
  );

  if (
    hasOnlyZeroBoardItems
    || (hasOnlyUnclassifiedSectors && hasQuoteOnlyLeaders)
    || (
      review.metrics.limitUp !== null
      && review.metrics.limitUp > 0
      && ladderItems.length === 0
      && !hasVerifiedComparison
    )
  ) {
    return {
      status: "failed",
      message: "旧版记录缺少涨停池连板高度与行业字段",
    };
  }

  if (hasPositiveBoardHeight || review.sectors.length > 0 || review.leaders.length > 0) {
    return {
      status: "partial",
      message: "旧版复盘记录，结构数据尚未完成来源标记",
    };
  }

  return {
    status: "failed",
    message: "涨停池、行业与连板明细暂缺",
  };
}
