import { describe, expect, it } from "vitest";
import { calculateAverageAmount20, mergeEtfDerivedMetrics, normalizeEtfCategory } from "../lib/etf/derived-metrics";
import type { EtfSnapshot } from "../lib/data/provider";

describe("ETF derived metrics", () => {
  it("calculates the average amount from exactly the latest 20 valid sessions", () => {
    const bars = Array.from({ length: 25 }, (_, index) => ({
      time: `2026-07-${String(index + 1).padStart(2, "0")}`,
      amount: (index + 1) * 100_000_000,
    }));

    expect(calculateAverageAmount20(bars)).toBe(1_550_000_000);
  });

  it("keeps the value unavailable when fewer than 20 sessions are valid", () => {
    expect(calculateAverageAmount20([{ time: "2026-07-01", amount: 100_000_000 }])).toBeNull();
  });

  it("classifies beauty, semiconductor, energy and auto index names", () => {
    expect(normalizeEtfCategory("主题ETF", "中证医疗美容主题指数")).toBe("美容护理");
    expect(normalizeEtfCategory("主题ETF", "中华半导体芯片指数")).toBe("半导体存储");
    expect(normalizeEtfCategory("主题ETF", "新能源电池指数")).toBe("新能源");
    expect(normalizeEtfCategory("主题ETF", "智能汽车指数")).toBe("汽车");
  });

  it("preserves a verified 20-day amount when live quotes refresh", () => {
    const item = (averageAmount20: number | null): EtfSnapshot => ({
      symbol: "510300",
      name: "沪深300ETF",
      category: "宽基指数",
      tags: ["宽基"],
      exchange: "SH",
      price: 4.2,
      pctChange: 0.5,
      amount: 5_000_000_000,
      averageAmount20,
      scale: 100_000_000_000,
      turnoverRate: 1,
      status: "active",
      updatedAt: "2026-07-24T15:00:00+08:00",
    });

    expect(mergeEtfDerivedMetrics([item(null)], [item(42.5)])[0].averageAmount20).toBe(4_250_000_000);
  });
});
