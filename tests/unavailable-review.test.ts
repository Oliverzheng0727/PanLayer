import { describe, expect, it } from "vitest";
import { createUnavailableReview } from "../lib/data/unavailable";

describe("unavailable market review", () => {
  it("uses null for every unavailable market number instead of fabricated zeroes", () => {
    const review = createUnavailableReview("2026-07-24", "当天收盘复盘尚未采集");

    expect(review.status).toBe("failed");
    expect(review.source).toBe("数据暂缺");
    expect(review.breadth).toEqual([]);
    expect(review.metrics).toEqual({
      limitUp: null,
      limitDown: null,
      consecutive: null,
      largeRise: null,
      high120: null,
      allTimeHigh: null,
      marginBalance: null,
    });
    expect(review.premium).toEqual({ openPct: null, closePct: null, sampleSize: 0 });
    expect(review.comparison).toBeUndefined();
    expect(review.unavailableReason).toBe("当天收盘复盘尚未采集");
  });
});
