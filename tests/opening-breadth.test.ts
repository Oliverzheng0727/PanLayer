import { describe, expect, it } from "vitest";
import { calculateOpeningBreadth } from "../lib/domain/metrics";
import type { Quote } from "../lib/domain/types";

function quote(symbol: string, open: number, previousClose = 10): Quote {
  return {
    symbol,
    name: symbol,
    exchange: "SH",
    board: "MAIN",
    isST: false,
    isNoLimitDay: false,
    previousClose,
    open,
    price: 12,
    high: 12,
    low: 9,
    pctChange: 20,
    amount: 100,
    turnoverRate: 1,
    limitUpPrice: 11,
    limitDownPrice: 9,
    sector: "测试",
    firstLimitTime: null,
    limitStreak: 0,
  };
}

describe("09:25 opening breadth reconstruction", () => {
  it("uses the official opening price rather than a later intraday price", () => {
    const result = calculateOpeningBreadth([
      quote("UP", 10.2),
      quote("DOWN", 9.8),
      quote("FLAT", 10),
    ]);

    expect(result).toMatchObject({
      rising: 1,
      falling: 1,
      flat: 1,
      validCount: 3,
      expectedCount: 3,
      coveragePct: 100,
    });
  });

  it("reports missing opening prices as incomplete coverage", () => {
    const result = calculateOpeningBreadth([
      quote("UP", 10.2),
      quote("MISSING", 0),
    ]);

    expect(result.validCount).toBe(1);
    expect(result.expectedCount).toBe(2);
    expect(result.coveragePct).toBe(50);
  });
});
