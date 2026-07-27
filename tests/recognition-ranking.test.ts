import { describe, expect, it } from "vitest";
import type { AdjustedBar, BoardPoolItem } from "../lib/data/provider";
import type { PopularitySnapshot } from "../lib/data/ths-popularity";
import { buildRecognitionRanking } from "../lib/domain/recognition";
import type { Quote } from "../lib/domain/types";

function quote(symbol: string, options: Partial<Quote> = {}): Quote {
  return {
    symbol,
    name: symbol,
    exchange: symbol.endsWith(".SZ") ? "SZ" : "SH",
    board: "MAIN",
    isST: false,
    isNoLimitDay: false,
    previousClose: 10,
    open: 10,
    price: 11,
    high: 11,
    low: 10,
    pctChange: 10,
    amount: 2_000_000_000,
    turnoverRate: 12,
    limitUpPrice: 11,
    limitDownPrice: 9,
    sector: "机器人",
    firstLimitTime: "09:31:00",
    limitStreak: 3,
    listingDate: "2020-01-01",
    ...options,
  };
}

function pool(code: string, name: string, streak: number): BoardPoolItem {
  return {
    code,
    name,
    pctChange: 10,
    amount: null,
    industry: "机器人+算力",
    limitStreak: streak,
    previousLimitStreak: Math.max(0, streak - 1),
    firstLimitTime: "09:31:00",
  };
}

function bars(symbol: string, date = "2026-07-27") {
  const values: AdjustedBar[] = Array.from({ length: 30 }, (_, index) => {
    const day = new Date("2026-06-17T00:00:00Z");
    day.setUTCDate(day.getUTCDate() + index);
    return {
      date: index === 29 ? date : day.toISOString().slice(0, 10),
      close: 10 + index * .01,
      volume: index >= 27 ? 200 : 100,
    };
  }).toSorted((left, right) => left.date.localeCompare(right.date));
  return { symbol, bars: values, source: "扶摇 Fuyao 前复权日K" };
}

const popularity: PopularitySnapshot = {
  source: "同花顺热榜",
  status: "complete",
  marketTime: "2026-07-27T15:00:00+08:00",
  receivedAt: "2026-07-27T08:10:00.000Z",
  rawCount: 100,
  items: [
    {
      symbol: "600001.SH",
      name: "空间甲",
      rank: 1,
      rankChange: 0,
      heat: 10_000,
      concepts: ["机器人", "算力"],
      analysisTitle: "机器人+算力",
    },
    {
      symbol: "000002.SZ",
      name: "首板乙",
      rank: 10,
      rankChange: -1,
      heat: 5_000,
      concepts: ["存储"],
      analysisTitle: null,
    },
  ],
  message: "同花顺日榜前30已采集",
};

describe("objective recognition ranking", () => {
  it("applies all hard gates and produces reproducible three-factor scores", () => {
    const result = buildRecognitionRanking({
      date: "2026-07-27",
      quotes: [
        quote("600001.SH", { name: "空间甲", limitStreak: 3 }),
        quote("000002.SZ", { name: "首板乙", amount: 500_000_000, limitStreak: 1 }),
        quote("600003.SH", { name: "低换手", turnoverRate: 7 }),
      ],
      limitUpPool: [
        pool("600001", "空间甲", 3),
        pool("000002", "首板乙", 1),
        pool("600003", "低换手", 2),
      ],
      popularity,
      bars: [bars("600001.SH"), bars("000002.SZ")],
      quoteSource: "扶摇 Fuyao / 东方财富",
      ladderSource: "扶摇 Fuyao 涨停池",
      receivedAt: "2026-07-27T08:10:00.000Z",
    });

    expect(result.status).toBe("complete");
    expect(result.filters).toMatchObject({
      ladderCandidates: 3,
      excludedTurnover: 1,
      qualified: 2,
    });
    expect(result.items.map((item) => item.name)).toEqual(["空间甲", "首板乙"]);
    expect(result.items[0]).toMatchObject({
      rank: 1,
      tier: "first",
      hotRank: 1,
      priceVolumeState: "上涨放量",
      topic: "机器人+算力",
      scores: { streak: 30, popularity: 30 },
    });
    expect(result.items[0].scores.total).toBeGreaterThan(result.items[1].scores.total);
    expect(result.items[1].tier).toBe("second");
  });

  it("does not admit missing, stale or insufficient volume histories", () => {
    const staleBars = bars("600001.SH", "2026-07-26");
    const result = buildRecognitionRanking({
      date: "2026-07-27",
      quotes: [quote("600001.SH", { name: "空间甲" })],
      limitUpPool: [pool("600001", "空间甲", 3)],
      popularity,
      bars: [staleBars],
      quoteSource: "扶摇 Fuyao",
      ladderSource: "扶摇 Fuyao 涨停池",
      receivedAt: "2026-07-27T08:10:00.000Z",
    });

    expect(result.items).toEqual([]);
    expect(result.filters.excludedVolumeHistory).toBe(1);
    expect(result.evidence.message).toContain("不会");
  });

  it("uses Fuyao popularity only as a partial fallback", () => {
    const result = buildRecognitionRanking({
      date: "2026-07-27",
      quotes: [quote("600001.SH", { name: "空间甲" })],
      limitUpPool: [pool("600001", "空间甲", 3)],
      popularity: { ...popularity, status: "failed", items: [], message: "同花顺失败" },
      bars: [bars("600001.SH")],
      structuredSignals: {
        schemaVersion: 1,
        provider: "扶摇 Fuyao",
        referenceDate: "2026-07-27",
        marketTime: "2026-07-27T15:00:00+08:00",
        receivedAt: "2026-07-27T08:10:00.000Z",
        status: "partial",
        datasetTotal: 7,
        datasetSuccess: 1,
        requestIds: [],
        hotStocks: [{ symbol: "600001.SH", name: "空间甲", rank: 1, rankChange: 0, heat: 10 }],
        skyrocket: [],
        dragonTiger: [],
        anomalies: [],
        sectors: [],
        evidence: {},
        errors: [],
      },
      quoteSource: "扶摇 Fuyao",
      ladderSource: "扶摇 Fuyao 涨停池",
      receivedAt: "2026-07-27T08:10:00.000Z",
    });

    expect(result.items).toHaveLength(1);
    expect(result.status).toBe("partial");
    expect(result.evidence.hotListSource).toContain("降级");
  });
});
