import { describe, expect, it } from "vitest";
import { runDomesticPipeline } from "../lib/data/market-pipeline";
import type { Quote } from "../lib/domain/types";

const quote = (index: number): Quote => ({
  symbol: `${String(600000 + index).padStart(6, "0")}.SH`, name: `股票${index}`, exchange: "SH", board: "MAIN",
  isST: false, isNoLimitDay: false, previousClose: 10, open: 10, price: 10.1, high: 10.2, low: 9.9,
  pctChange: 1, amount: 1_000_000, turnoverRate: 1, limitUpPrice: 11, limitDownPrice: 9, sector: "测试",
  firstLimitTime: null, limitStreak: 0,
});

describe("domestic market pipeline", () => {
  it("uses cross-checked primary data when both sources agree", async () => {
    const quotes = Array.from({ length: 100 }, (_, index) => quote(index));
    const result = await runDomesticPipeline({
      at: "15:00", expectedSymbols: quotes.map((item) => item.symbol), now: new Date(), retryDelayMs: 0,
      primary: { name: "东方财富", getQuotes: async () => quotes },
      secondary: { name: "腾讯", getQuotes: async () => quotes },
    });
    expect(result).toMatchObject({ status: "complete", source: "东方财富 / 腾讯" });
    expect(result.quotes).toEqual(quotes);
  });

  it("does not mark a tiny all-A sample complete when the expected universe floor is much larger", async () => {
    const quotes = Array.from({ length: 100 }, (_, index) => quote(index));
    const result = await runDomesticPipeline({
      at: "11:00",
      expectedSymbols: [],
      minimumExpectedCount: 3_000,
      now: new Date(),
      retryDelayMs: 0,
      primary: { name: "东方财富", getQuotes: async () => quotes },
      secondary: { name: "腾讯", getQuotes: async () => quotes },
    });

    expect(result.status).toBe("partial");
    expect(result.audits[0].coveragePct).toBeCloseTo(3.33, 2);
  });

  it("cross-checks a bounded Tencent sample when the primary universe is available", async () => {
    const quotes = Array.from({ length: 100 }, (_, index) => quote(index));
    let requestedSymbols: string[] = [];
    const result = await runDomesticPipeline({
      at: "11:00",
      expectedSymbols: [],
      minimumExpectedCount: 100,
      secondarySampleSize: 20,
      now: new Date(),
      retryDelayMs: 0,
      primary: { name: "东方财富", getQuotes: async () => quotes },
      secondary: { name: "腾讯", getQuotes: async (symbols) => {
        requestedSymbols = symbols;
        return quotes.filter((item) => symbols.includes(item.symbol));
      } },
    });

    expect(requestedSymbols).toHaveLength(20);
    expect(result.quotes).toHaveLength(100);
  });

  it("keeps Fuyao prices while merging verified security metadata from the cross source", async () => {
    const primary = [{ ...quote(0), name: "600000", sector: "未分类", isNoLimitDay: false, price: 10.2 }];
    const cross = [{ ...quote(0), name: "浦发银行", sector: "银行", isNoLimitDay: true, price: 10.2 }];
    const result = await runDomesticPipeline({
      at: "15:00",
      expectedSymbols: [primary[0].symbol],
      now: new Date(),
      retryDelayMs: 0,
      mergeSecondaryMetadata: true,
      primary: { name: "扶摇 Fuyao", getQuotes: async () => primary },
      secondary: { name: "东方财富", getQuotes: async () => cross },
    });

    expect(result.quotes[0]).toMatchObject({
      price: 10.2,
      name: "浦发银行",
      sector: "银行",
      isNoLimitDay: true,
    });
  });

  it("falls back to Tencent with a partial status when primary fails", async () => {
    const quotes = Array.from({ length: 100 }, (_, index) => quote(index));
    const result = await runDomesticPipeline({
      at: "10:00", expectedSymbols: quotes.map((item) => item.symbol), now: new Date(), retryDelayMs: 0,
      primary: { name: "东方财富", getQuotes: async () => { throw new Error("down"); } },
      secondary: { name: "腾讯", getQuotes: async () => quotes },
    });
    expect(result).toMatchObject({ status: "partial", source: "腾讯" });
    expect(result.quotes).toHaveLength(100);
  });

  it("returns failed without stale quotes when both sources fail", async () => {
    const result = await runDomesticPipeline({
      at: "10:00", expectedSymbols: ["600000.SH"], now: new Date(), retryDelayMs: 0,
      primary: { name: "东方财富", getQuotes: async () => { throw new Error("down"); } },
      secondary: { name: "腾讯", getQuotes: async () => { throw new Error("down"); } },
    });
    expect(result).toMatchObject({ status: "failed", quotes: [] });
  });
});
