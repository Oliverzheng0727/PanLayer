import { describe, expect, it } from "vitest";
import { demoReview } from "../lib/data/demo";
import {
  CLOSE_REVIEW_CORE_STAGES,
  isCloseReviewCoreStage,
  mergeCloseReviewWithExisting,
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
});
