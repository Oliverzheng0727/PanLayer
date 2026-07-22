import { describe, expect, it } from "vitest";
import {
  bucketLimitLadder,
  calculateBreadth,
  calculateLimitPremium,
  classifyLimitStatus,
  findNewHighs,
  rankLeaders,
  rankSectors,
} from "../lib/domain/metrics";
import type { Quote } from "../lib/domain/types";

const quote = (overrides: Partial<Quote>): Quote => ({
  symbol: "600000.SH",
  name: "浦发银行",
  exchange: "SH",
  board: "MAIN",
  isST: false,
  isNoLimitDay: false,
  previousClose: 10,
  open: 10,
  price: 10,
  high: 10,
  low: 10,
  pctChange: 0,
  amount: 100_000_000,
  turnoverRate: 2,
  limitUpPrice: 11,
  limitDownPrice: 9,
  sector: "银行",
  firstLimitTime: null,
  limitStreak: 0,
  ...overrides,
});

describe("market metric rules", () => {
  it("uses the provider limit prices and excludes no-limit trading days", () => {
    expect(classifyLimitStatus(quote({ price: 11 }))).toBe("limit-up");
    expect(classifyLimitStatus(quote({ price: 9 }))).toBe("limit-down");
    expect(classifyLimitStatus(quote({ price: 11, isNoLimitDay: true }))).toBe("normal");
  });

  it("counts breadth for non-ST stocks only", () => {
    const result = calculateBreadth([
      quote({ symbol: "1", price: 10.1 }),
      quote({ symbol: "2", price: 9.9 }),
      quote({ symbol: "3", price: 10 }),
      quote({ symbol: "4", price: 11, isST: true }),
    ]);
    expect(result).toEqual({ rising: 1, falling: 1, flat: 1 });
  });

  it("groups limit-up stocks into first through five-plus ladders", () => {
    const result = bucketLimitLadder([
      quote({ symbol: "1", limitStreak: 1, price: 11 }),
      quote({ symbol: "2", limitStreak: 2, price: 11 }),
      quote({ symbol: "3", limitStreak: 5, price: 11 }),
      quote({ symbol: "4", limitStreak: 7, price: 11 }),
    ]);
    expect(result.first).toHaveLength(1);
    expect(result.second).toHaveLength(1);
    expect(result.fivePlus.map((item) => item.symbol)).toEqual(["4", "3"]);
  });

  it("calculates equal-weight open and close premium for yesterday's 2+ board basket", () => {
    const result = calculateLimitPremium([
      { previousStreak: 2, openPct: 4, closePct: 8 },
      { previousStreak: 3, openPct: -2, closePct: 2 },
      { previousStreak: 1, openPct: 9, closePct: 9 },
    ]);
    expect(result).toEqual({ openPct: 1, closePct: 5, sampleSize: 2 });
  });

  it("requires sufficient adjusted history for 120-day and all-time highs", () => {
    const closes = Array.from({ length: 130 }, (_, index) => 5 + index * 0.01);
    const result = findNewHighs([...closes, 7], 7);
    expect(result).toEqual({ high120: true, allTimeHigh: true });
    expect(findNewHighs([1, 2, 3], 3)).toEqual({ high120: false, allTimeHigh: false });
  });
});

describe("objective rankings", () => {
  it("ranks leaders by streak, seal status, first seal time, then amount", () => {
    const leaders = rankLeaders([
      quote({ symbol: "A", price: 11, limitStreak: 2, firstLimitTime: "10:02:00", amount: 4 }),
      quote({ symbol: "B", price: 11, limitStreak: 3, firstLimitTime: "10:20:00", amount: 3 }),
      quote({ symbol: "C", price: 11, limitStreak: 3, firstLimitTime: "09:40:00", amount: 2 }),
    ]);
    expect(leaders.map((item) => item.symbol)).toEqual(["C", "B", "A"]);
  });

  it("ranks sectors by limit-ups, average change, amount growth, then max streak", () => {
    const sectors = rankSectors([
      { name: "机器人", limitUpCount: 5, averagePct: 2, amountGrowthPct: 18, maxStreak: 3 },
      { name: "存储", limitUpCount: 7, averagePct: 1, amountGrowthPct: 8, maxStreak: 2 },
      { name: "算力", limitUpCount: 5, averagePct: 3, amountGrowthPct: 12, maxStreak: 2 },
    ]);
    expect(sectors.map((item) => item.name)).toEqual(["存储", "算力", "机器人"]);
  });
});
