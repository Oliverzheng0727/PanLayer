import { describe, expect, it } from "vitest";
import { buildDailyReview } from "../lib/jobs/runner";
import type { Quote } from "../lib/domain/types";

const q = (symbol: string, pctChange: number, streak = 0): Quote => ({
  symbol, name: symbol, exchange: "SH", board: "MAIN", isST: false, isNoLimitDay: false,
  previousClose: 10, open: 10.2, price: pctChange === 10 ? 11 : 10 * (1 + pctChange / 100),
  high: 11, low: 9.8, pctChange, amount: 100, turnoverRate: 2,
  limitUpPrice: 11, limitDownPrice: 9, sector: streak ? "机器人" : "银行",
  firstLimitTime: streak ? "09:35:00" : null, limitStreak: streak,
});

describe("close review aggregation", () => {
  it("builds objective metrics, ladders and rankings from quotes and the limit pool", () => {
    const review = buildDailyReview({
      date: "2026-07-22",
      quotes: [q("A", 10), q("B", -10), q("C", 8), q("D", 1)],
      limitPool: [q("A", 10, 2)],
      breadth: [{ time: "15:00", rising: 3, falling: 1, flat: 0 }],
      marginBalance: 26_000,
      high120: 4,
      allTimeHigh: 2,
      source: "东方财富",
    });
    expect(review.metrics).toMatchObject({ limitUp: 1, limitDown: 1, consecutive: 1, largeRise: 1, high120: 4, allTimeHigh: 2 });
    expect(review.ladder.second[0].symbol).toBe("A");
    expect(review.leaders[0].symbol).toBe("A");
    expect(review.status).toBe("complete");
  });
});
