import type { DailyReview } from "../domain/types";

export function createUnavailableReview(
  date: string,
  reason = "当天收盘复盘尚未采集",
  now = new Date(),
): DailyReview {
  return {
    date,
    status: "failed",
    source: "数据暂缺",
    updatedAt: now.toISOString(),
    unavailableReason: reason,
    breadth: [],
    metrics: {
      limitUp: null,
      limitDown: null,
      consecutive: null,
      largeRise: null,
      high120: null,
      allTimeHigh: null,
      marginBalance: null,
    },
    premium: { openPct: null, closePct: null, sampleSize: 0 },
    ladder: { first: [], second: [], third: [], fourth: [], fivePlus: [] },
    sectors: [],
    leaders: [],
    structure: {
      status: "failed",
      source: "数据暂缺",
      message: "涨停池、行业与连板明细尚未采集",
      receivedAt: now.toISOString(),
    },
  };
}
