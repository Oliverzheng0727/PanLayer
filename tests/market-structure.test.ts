import { describe, expect, it } from "vitest";
import {
  resolveReviewSectorStatus,
  resolveReviewStructureStatus,
} from "../lib/domain/market-structure";
import type { DailyReview, Quote } from "../lib/domain/types";

const quote = (limitStreak: number): Quote => ({
  symbol: "600001.SH",
  name: "样本",
  exchange: "SH",
  board: "MAIN",
  isST: false,
  isNoLimitDay: false,
  previousClose: 10,
  open: 10,
  price: 11,
  high: 11,
  low: 10,
  pctChange: 10,
  amount: 1,
  turnoverRate: 1,
  limitUpPrice: 11,
  limitDownPrice: 9,
  sector: "未分类",
  firstLimitTime: null,
  limitStreak,
});

const review = (item: Quote): DailyReview => ({
  date: "2026-07-23",
  status: "partial",
  source: "新浪财经",
  updatedAt: "2026-07-23T08:10:00Z",
  breadth: [],
  metrics: { limitUp: 1, limitDown: 0, consecutive: 0, largeRise: 0, high120: null, allTimeHigh: null, marginBalance: null },
  premium: { openPct: null, closePct: null, sampleSize: 0 },
  ladder: { first: [item], second: [], third: [], fourth: [], fivePlus: [] },
  sectors: [{ name: "未分类", limitUpCount: 1, averagePct: 10, amountGrowthPct: null, maxStreak: 0 }],
  leaders: [item],
});

describe("review market structure status", () => {
  it("rejects legacy quote-only zero-board data instead of presenting it as a valid first board", () => {
    expect(resolveReviewStructureStatus(review(quote(0)))).toEqual({
      status: "failed",
      message: "旧版记录缺少涨停池连板高度与行业字段",
    });
  });

  it("keeps a legacy record with a real positive board height as partial data", () => {
    expect(resolveReviewStructureStatus(review(quote(1))).status).toBe("partial");
  });

  it("trusts an explicit current structure status", () => {
    const current = review(quote(0));
    current.structure = {
      status: "complete",
      source: "东方财富四池",
      message: "已校验",
      receivedAt: "2026-07-23T08:10:00Z",
    };
    expect(resolveReviewStructureStatus(current)).toEqual({ status: "complete", message: "已校验" });
  });

  it("rejects an unclassified sector placeholder even when ladder data is valid", () => {
    const current = review(quote(1));
    current.structure = {
      status: "complete",
      source: "东方财富四池",
      message: "已校验",
      receivedAt: "2026-07-23T08:10:00Z",
    };
    expect(resolveReviewSectorStatus(current)).toEqual({
      status: "failed",
      message: "板块分类数据暂缺；未展示“未分类”占位数据",
    });
  });

  it("keeps a verified sector available independently of the ladder status", () => {
    const current = review(quote(1));
    current.sectors = [{
      name: "机器人",
      limitUpCount: 2,
      averagePct: 3.5,
      amountGrowthPct: null,
      maxStreak: 2,
    }];
    expect(resolveReviewSectorStatus(current)).toEqual({
      status: "partial",
      message: "热点板块来自已验证涨停归属，板块指数仍待交叉校验",
    });
  });
});
