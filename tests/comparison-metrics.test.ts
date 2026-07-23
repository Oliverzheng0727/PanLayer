import { describe, expect, it } from "vitest";
import { buildMarketComparison } from "../lib/domain/comparison";
import type { Quote, SectorMetric } from "../lib/domain/types";
import type { BoardPools, IndexSnapshot, MarketAggregate } from "../lib/data/provider";

function quote(
  symbol: string,
  pctChange: number,
  options: Partial<Quote> = {},
): Quote {
  const previousClose = 10;
  return {
    symbol,
    name: symbol,
    exchange: symbol.endsWith(".SZ") ? "SZ" : symbol.endsWith(".BJ") ? "BJ" : "SH",
    board: "MAIN",
    isST: false,
    isNoLimitDay: false,
    previousClose,
    open: 10,
    price: previousClose * (1 + pctChange / 100),
    high: 11,
    low: 9,
    pctChange,
    amount: 100_000_000,
    turnoverRate: 2,
    limitUpPrice: 11,
    limitDownPrice: 9,
    sector: "电子",
    firstLimitTime: null,
    limitStreak: 0,
    ...options,
  };
}

const pools: BoardPools = {
  limitUp: [
    { code: "600001", name: "三板甲", pctChange: 10, amount: 900_000_000, industry: "电子", limitStreak: 3, previousLimitStreak: 0, firstLimitTime: "09:31:00" },
    { code: "000002", name: "二板乙", pctChange: 10, amount: 500_000_000, industry: "机器人", limitStreak: 2, previousLimitStreak: 0, firstLimitTime: "09:35:00" },
  ],
  broken: [
    { code: "600003", name: "炸板丙", pctChange: 4, amount: 300_000_000, industry: "电子", limitStreak: 1, previousLimitStreak: 0, firstLimitTime: "10:02:00" },
  ],
  limitDown: [
    { code: "600004", name: "跌停丁", pctChange: -10, amount: 200_000_000, industry: "消费", limitStreak: 0, previousLimitStreak: 0, firstLimitTime: null },
  ],
  yesterdayLimitUp: [
    { code: "600001", name: "三板甲", pctChange: 4, amount: 900_000_000, industry: "电子", limitStreak: 0, previousLimitStreak: 2, firstLimitTime: "09:31:00" },
    { code: "600005", name: "断板戊", pctChange: -3, amount: 400_000_000, industry: "医药", limitStreak: 0, previousLimitStreak: 3, firstLimitTime: "09:42:00" },
    { code: "000006", name: "首板己", pctChange: 1, amount: 200_000_000, industry: "汽车", limitStreak: 0, previousLimitStreak: 1, firstLimitTime: "10:10:00" },
  ],
};

const sectors: SectorMetric[] = [
  { name: "电子", limitUpCount: 3, averagePct: 2.8, amountGrowthPct: 12, maxStreak: 3 },
  { name: "机器人", limitUpCount: 2, averagePct: 3.1, amountGrowthPct: 9, maxStreak: 2 },
  { name: "医药", limitUpCount: 1, averagePct: 1.4, amountGrowthPct: 5, maxStreak: 1 },
  { name: "消费", limitUpCount: 1, averagePct: .8, amountGrowthPct: 2, maxStreak: 1 },
];

const aggregate: MarketAggregate = {
  amount: 1_234.56,
  rawCount: 5_320,
  validCount: 5_300,
  coveragePct: 99.62,
  marketTime: "2026-07-22T15:00:00+08:00",
  receivedAt: "2026-07-22T08:10:00.000Z",
  source: "东方财富",
  status: "complete",
  message: "沪深京全A含ST",
};

const indices: IndexSnapshot[] = [
  {
    symbol: "000001.SH",
    name: "上证指数",
    price: 3_600,
    pctChange: .52,
    amount: 720_000_000_000,
    marketTime: "2026-07-22T15:00:00+08:00",
    receivedAt: "2026-07-22T08:10:00.000Z",
    source: "腾讯 / 东方财富",
    status: "complete",
    message: "双源一致",
  },
];

describe("market comparison metrics", () => {
  it("derives board, turnover and leader fields from real samples", () => {
    const comparison = buildMarketComparison({
      date: "2026-07-22",
      quotes: [
        quote("600001.SH", 10, { name: "三板甲", limitStreak: 3, firstLimitTime: "09:31:00" }),
        quote("000002.SZ", 10, { name: "二板乙", limitStreak: 2, firstLimitTime: "09:35:00" }),
        quote("600007.SH", -8),
        quote("600004.SH", -10),
        quote("600008.SH", -8, { isST: true, name: "*ST样本" }),
      ],
      pools,
      marketAggregate: aggregate,
      indices,
      sectors,
      source: "东方财富 / 腾讯",
      receivedAt: "2026-07-22T08:10:00.000Z",
    });

    expect(comparison).toMatchObject({
      brokenCount: 1,
      largeDownCount: 1,
      sealRate: 66.67,
      yesterdaySuccessRate: 66.67,
      yesterdaySuccessSampleSize: 3,
      marketAmount: 1234.56,
      marketCoveragePct: 99.62,
      maxBoard: { height: 3 },
      brokenBoard: { count: 1, rate: 50, sampleSize: 2 },
      cycleLeader: { code: "600001", name: "三板甲", limitStreak: 3 },
    });
    expect(comparison.continuation).toEqual({
      positiveRate: 50,
      averagePct: .5,
      promotionRate: 50,
      sampleSize: 2,
    });
    expect(comparison.maxBoard?.stocks.map((item) => item.name)).toEqual(["三板甲"]);
    expect(comparison.brokenBoard.stocks.map((item) => item.name)).toEqual(["断板戊"]);
    expect(comparison.recognition.map((item) => item.name)).toEqual(["三板甲", "二板乙", "炸板丙"]);
    expect(comparison.mainSectors.map((item) => item.name)).toEqual(["电子", "机器人", "医药"]);
    expect(comparison.indices).toEqual(indices);
    expect(comparison.evidence.sealRate).toMatchObject({
      formula: "涨停家数 ÷（涨停家数 + 炸板家数）",
      sampleSize: 3,
      status: "complete",
    });
    expect(comparison.evidence.maxBoard.formula).toContain("最高连板高度");
    expect(comparison.evidence.cycleLeader.formula).toContain("连板高度");
    expect(comparison.evidence.recognition.formula).toContain("首次封板时间");
    expect(comparison.evidence.mainSectors.formula).toContain("涨停家数");
  });

  it("does not publish total turnover when all-A coverage is below 95%", () => {
    const comparison = buildMarketComparison({
      date: "2026-07-22",
      quotes: [],
      pools,
      marketAggregate: { ...aggregate, amount: null, coveragePct: 92, status: "partial" },
      indices: [],
      sectors: [],
      source: "东方财富",
      receivedAt: "2026-07-22T08:10:00.000Z",
    });

    expect(comparison.marketAmount).toBeNull();
    expect(comparison.evidence.marketAmount.status).toBe("partial");
  });

  it("keeps rates null when their denominators have no valid samples", () => {
    const comparison = buildMarketComparison({
      date: "2026-07-22",
      quotes: [],
      pools: { limitUp: [], broken: [], limitDown: [], yesterdayLimitUp: [] },
      marketAggregate: null,
      indices: [],
      sectors: [],
      source: "东方财富",
      receivedAt: "2026-07-22T08:10:00.000Z",
    });

    expect(comparison.sealRate).toBeNull();
    expect(comparison.yesterdaySuccessRate).toBeNull();
    expect(comparison.continuation).toBeNull();
    expect(comparison.brokenBoard).toEqual({ count: null, rate: null, sampleSize: 0, stocks: [] });
    expect(comparison.maxBoard).toBeNull();
    expect(comparison.cycleLeader).toBeNull();
  });

  it("excludes ST and delisting names from every sentiment pool", () => {
    const comparison = buildMarketComparison({
      date: "2026-07-22",
      quotes: [],
      pools: {
        limitUp: [...pools.limitUp, { ...pools.limitUp[0], code: "600099", name: "*ST样本", limitStreak: 8 }],
        broken: [...pools.broken, { ...pools.broken[0], code: "600098", name: "退市样本" }],
        limitDown: pools.limitDown,
        yesterdayLimitUp: [...pools.yesterdayLimitUp, { ...pools.yesterdayLimitUp[0], code: "600097", name: "ST样本", previousLimitStreak: 5 }],
      },
      marketAggregate: null,
      indices: [],
      sectors,
      source: "东方财富",
      receivedAt: "2026-07-22T08:10:00.000Z",
    });

    expect(comparison.brokenCount).toBe(1);
    expect(comparison.maxBoard?.height).toBe(3);
    expect(comparison.brokenBoard.sampleSize).toBe(2);
    expect(comparison.recognition.every((item) => !/ST|退/.test(item.name))).toBe(true);
  });

  it("marks pool-derived metrics partial when the pool and close-price calculation materially disagree", () => {
    const comparison = buildMarketComparison({
      date: "2026-07-22",
      quotes: [
        quote("600010.SH", 10),
        quote("600011.SH", 10),
        quote("600012.SH", 10),
      ],
      pools,
      marketAggregate: aggregate,
      indices,
      sectors,
      source: "东方财富 / 腾讯",
      receivedAt: "2026-07-22T08:10:00.000Z",
    });

    expect(comparison.evidence.poolConsistency).toMatchObject({
      status: "partial",
      sampleSize: 5,
    });
    expect(comparison.evidence.sealRate.status).toBe("partial");
    expect(comparison.evidence.sealRate.message).toContain("涨停池 2");
    expect(comparison.evidence.sealRate.message).toContain("收盘价计算 3");
  });

  it("ranks recognition candidates by streak, sealed status, first seal time and amount", () => {
    const brokenAtThree = {
      code: "600090",
      name: "三板炸板",
      pctChange: 5,
      amount: 2_000_000_000,
      industry: "电子",
      limitStreak: 3,
      previousLimitStreak: 2,
      firstLimitTime: "09:29:00",
    };
    const comparison = buildMarketComparison({
      date: "2026-07-22",
      quotes: [],
      pools: { ...pools, broken: [...pools.broken, brokenAtThree] },
      marketAggregate: null,
      indices: [],
      sectors,
      source: "东方财富",
      receivedAt: "2026-07-22T08:10:00.000Z",
    });

    expect(comparison.recognition.slice(0, 2).map((item) => [item.name, item.isLimitUp]))
      .toEqual([["三板甲", true], ["三板炸板", false]]);
  });
});
