import { describe, expect, it } from "vitest";
import { compareDomesticSnapshots } from "../lib/data/quality";
import type { Quote } from "../lib/domain/types";

const quote = (index: number, pctChange = 1, priceOffset = 0): Quote => ({
  symbol: `${String(600000 + index).padStart(6, "0")}.SH`, name: `股票${index}`, exchange: "SH", board: "MAIN",
  isST: false, isNoLimitDay: false, previousClose: 10, open: 10, price: 10 * (1 + pctChange / 100) + priceOffset,
  high: 10.2, low: 9.8, pctChange, amount: 1_000_000, turnoverRate: 1, limitUpPrice: 11, limitDownPrice: 9,
  sector: "测试", firstLimitTime: null, limitStreak: 0,
});

describe("domestic source quality", () => {
  it("marks sufficiently covered and agreeing sources complete", () => {
    const primary = Array.from({ length: 100 }, (_, index) => quote(index, index < 60 ? 1 : -1));
    const secondary = primary.map((item) => ({ ...item, price: item.price + 0.001 }));
    const result = compareDomesticSnapshots(primary, secondary, 100, new Date("2026-07-23T07:00:00Z"));
    expect(result.summary).toMatchObject({ status: "complete", primaryCoveragePct: 100, secondaryCoveragePct: 100, directionAgreementPct: 100, priceAgreementPct: 100 });
  });

  it("marks insufficient secondary coverage partial", () => {
    const primary = Array.from({ length: 100 }, (_, index) => quote(index));
    const result = compareDomesticSnapshots(primary, primary.slice(0, 80), 100, new Date());
    expect(result.summary.status).toBe("partial");
    expect(result.summary.secondaryCoveragePct).toBe(80);
  });

  it("compares breadth only across symbols present in both source snapshots", () => {
    const primary = Array.from({ length: 100 }, (_, index) => quote(index, index < 50 ? 1 : -1));
    const secondary = primary.filter((_, index) => index % 5 === 0);
    const result = compareDomesticSnapshots(primary, secondary, 100, new Date());
    expect(result.summary.breadthDifference).toBe(0);
  });

  it("marks empty sources failed", () => {
    expect(compareDomesticSnapshots([], [], 100, new Date()).summary.status).toBe("failed");
  });

  it("detects price, direction, and breadth disagreements", () => {
    const primary = Array.from({ length: 100 }, (_, index) => quote(index, index < 5 ? 1 : index < 10 ? 0.06 : index < 55 ? 1 : -1));
    const secondary = primary.map((item, index) => index < 5
      ? { ...item, price: item.price + 1 }
      : index < 10
        ? { ...item, pctChange: -item.pctChange, price: 10 * (1 - item.pctChange / 100) }
        : item);
    const result = compareDomesticSnapshots(primary, secondary, 100, new Date());
    expect(result.summary.status).toBe("partial");
    expect(result.summary.priceAgreementPct).toBe(95);
    expect(result.summary.directionAgreementPct).toBe(95);
    expect(result.summary.breadthDifference).toBeGreaterThan(0);
  });
});
