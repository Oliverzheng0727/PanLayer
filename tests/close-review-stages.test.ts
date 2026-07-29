import { describe, expect, it } from "vitest";
import { demoReview } from "../lib/data/demo";
import {
  assessStructuredSignalCore,
  CLOSE_REVIEW_CORE_STAGES,
  isCloseReviewCoreStage,
  mergeCloseReviewWithExisting,
  recoverableCloseReviewCoreStages,
} from "../lib/jobs/close-review-stages";

describe("staged close-review merge", () => {
  it("keeps a successful market structure when a retry loses board pools", () => {
    const retry = structuredClone(demoReview);
    retry.structure = {
      status: "failed",
      source: "东方财富",
      message: "board pools unavailable",
      receivedAt: "2026-07-24T08:20:00Z",
    };
    retry.metrics.limitUp = null;
    retry.metrics.limitDown = null;
    retry.metrics.consecutive = null;
    retry.ladder = { first: [], second: [], third: [], fourth: [], fivePlus: [] };
    retry.sectors = [];
    retry.leaders = [];

    const merged = mergeCloseReviewWithExisting(demoReview, retry);

    expect(merged.metrics.limitUp).toBe(demoReview.metrics.limitUp);
    expect(merged.ladder).toEqual(demoReview.ladder);
    expect(merged.leaders).toEqual(demoReview.leaders);
  });

  it("fills newly recovered indices without erasing existing comparison metrics", () => {
    const existing = structuredClone(demoReview);
    existing.comparison = {
      brokenCount: 2,
      largeDownCount: null,
      sealRate: 80,
      yesterdaySuccessRate: null,
      yesterdaySuccessSampleSize: 0,
      continuation: null,
      marketAmount: null,
      marketCoveragePct: null,
      maxBoard: null,
      brokenBoard: { count: null, rate: null, sampleSize: 0, stocks: [] },
      mainSectors: [],
      cycleLeader: null,
      recognition: [],
      indices: [],
      evidence: {},
    };
    const retry = structuredClone(existing);
    retry.comparison!.indices = [{
      symbol: "000001.SH",
      name: "上证指数",
      price: 3600,
      pctChange: 0.5,
      amount: 700_000_000_000,
      marketTime: "2026-07-24T15:00:00+08:00",
      receivedAt: "2026-07-24T08:20:00Z",
      source: "腾讯财经",
      status: "complete",
      message: "",
    }];

    const merged = mergeCloseReviewWithExisting(existing, retry);

    expect(merged.comparison?.brokenCount).toBe(2);
    expect(merged.comparison?.indices).toHaveLength(1);
  });

  it("keeps new-high initialization outside the six close-review core stages", () => {
    expect(CLOSE_REVIEW_CORE_STAGES).toHaveLength(6);
    expect(isCloseReviewCoreStage("indices")).toBe(true);
    expect(isCloseReviewCoreStage("new-highs")).toBe(false);
    expect(isCloseReviewCoreStage("assemble")).toBe(false);
  });

  it("drops legacy unclassified sector placeholders during recomposition", () => {
    const existing = structuredClone(demoReview);
    existing.comparison = {
      brokenCount: null,
      largeDownCount: null,
      sealRate: null,
      yesterdaySuccessRate: null,
      yesterdaySuccessSampleSize: 0,
      continuation: null,
      marketAmount: null,
      marketCoveragePct: null,
      maxBoard: null,
      brokenBoard: { count: null, rate: null, sampleSize: 0, stocks: [] },
      mainSectors: [{ name: "未分类", limitUpCount: 61, averagePct: -0.79, amountGrowthPct: null, maxStreak: 0 }],
      cycleLeader: null,
      recognition: [],
      indices: [],
      evidence: {},
    };
    const retry = structuredClone(existing);

    const merged = mergeCloseReviewWithExisting(existing, retry);

    expect(merged.comparison?.mainSectors).toEqual([]);
  });

  it("treats verified fallback signal datasets as a completed close-review core stage", () => {
    const review = structuredClone(demoReview);
    review.status = "complete";
    review.structuredSignals = {
      schemaVersion: 1,
      provider: "扶摇 Fuyao",
      referenceDate: review.date,
      marketTime: `${review.date}T15:00:00+08:00`,
      receivedAt: review.updatedAt,
      status: "partial",
      datasetTotal: 7,
      datasetSuccess: 5,
      requestIds: [],
      hotStocks: [{ symbol: "000001.SZ", name: "平安银行", rank: 1, rankChange: 0, heat: null }],
      skyrocket: [],
      dragonTiger: [],
      anomalies: [{
        symbol: "000001.SZ",
        name: "平安银行",
        title: "银行",
        analysis: null,
        keywords: ["银行"],
      }],
      sectors: [{ name: "银行", limitUpCount: 1, averagePct: 1, amountGrowthPct: 2, maxStreak: 1 }],
      evidence: {
        hotStocks: {
          source: "同花顺热榜（降级）",
          requestId: null,
          marketTime: `${review.date}T15:00:00+08:00`,
          receivedAt: review.updatedAt,
          rawCount: 30,
          validCount: 30,
          coveragePct: 100,
          status: "complete",
          message: "备用源完成",
        },
        anomalies: {
          source: "同花顺题材（降级）",
          requestId: null,
          marketTime: `${review.date}T15:00:00+08:00`,
          receivedAt: review.updatedAt,
          rawCount: 30,
          validCount: 20,
          coveragePct: 66.67,
          status: "complete",
          message: "备用源完成",
        },
        sectors: {
          source: "东方财富板块（降级）",
          requestId: null,
          marketTime: `${review.date}T15:00:00+08:00`,
          receivedAt: review.updatedAt,
          rawCount: 100,
          validCount: 100,
          coveragePct: 100,
          status: "complete",
          message: "备用源完成",
        },
      },
      errors: ["扩展龙虎榜暂缺"],
    };

    expect(assessStructuredSignalCore(review.structuredSignals)).toMatchObject({
      status: "complete",
      completed: 3,
      expected: 3,
    });
    expect(recoverableCloseReviewCoreStages(review)).toContain("signals");
  });

  it("does not promote structured signals when a required verified dataset is missing", () => {
    const review = structuredClone(demoReview);
    review.status = "complete";
    review.structuredSignals = {
      schemaVersion: 1,
      provider: "扶摇 Fuyao",
      referenceDate: review.date,
      marketTime: `${review.date}T15:00:00+08:00`,
      receivedAt: review.updatedAt,
      status: "partial",
      datasetTotal: 7,
      datasetSuccess: 2,
      requestIds: [],
      hotStocks: [],
      skyrocket: [],
      dragonTiger: [],
      anomalies: [],
      sectors: [],
      evidence: {},
      errors: ["结构化数据不足"],
    };

    expect(assessStructuredSignalCore(review.structuredSignals).status).toBe("partial");
    expect(recoverableCloseReviewCoreStages(review)).not.toContain("signals");
  });
});
