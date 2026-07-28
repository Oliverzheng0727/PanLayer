import { describe, expect, it } from "vitest";
import type { DailyReview } from "../lib/domain/types";
import { parseHistoryQuery, queryHistoryRows, reviewToHistoryRow, type HistoryRow } from "../lib/history/query";

const emptyComparisonColumns = {
  brokenCount: null,
  largeDownCount: null,
  sealRate: null,
  yesterdaySuccessRate: null,
  continuationPositiveRate: null,
  continuationAveragePct: null,
  continuationPromotionRate: null,
  marketAmount: null,
  maxBoardNames: "—",
  brokenBoardCount: null,
  brokenBoardRate: null,
  cycleLeader: "无明确周期龙头",
  recognition: "—",
  indexSummary: "暂缺",
  high20: null,
};

const rows: HistoryRow[] = [
  { ...emptyComparisonColumns, date: "2026-07-22", rising: 1530, falling: 2798, flat: 101, riseFallRatio: .55, limitUp: 47, limitDown: 8, largeRise: 23, consecutive: 12, maxStreak: 6, openPremium: 1.79, closePremium: 7.05, high20: 31, high120: 20, allTimeHigh: 8, marginBalance: 26978.8, topSector: "机器人 / 算力", backfilled: false, status: "complete", source: "东方财富", updatedAt: "2026-07-22 16:10" },
  { ...emptyComparisonColumns, date: "2026-07-21", rising: 3107, falling: 1280, flat: 88, riseFallRatio: 2.43, limitUp: 121, limitDown: 21, largeRise: 195, consecutive: 5, maxStreak: 4, openPremium: 2.2, closePremium: 3.16, high20: 28, high120: 19, allTimeHigh: 2, marginBalance: 26966.4, topSector: "医药 / 芯片", backfilled: false, status: "complete", source: "东方财富", updatedAt: "2026-07-21 16:10" },
  { ...emptyComparisonColumns, date: "2026-07-20", rising: 1740, falling: 2670, flat: 92, riseFallRatio: .65, limitUp: 53, limitDown: 12, largeRise: 18, consecutive: 7, maxStreak: 3, openPremium: -0.3, closePremium: -0.82, high20: 24, high120: 17, allTimeHigh: 4, marginBalance: null, topSector: "汽车 / 电池", backfilled: true, status: "partial", source: "历史回补", updatedAt: "2026-07-20 16:10" },
];

const review: DailyReview = {
  date: "2026-07-22",
  status: "complete",
  source: "东方财富",
  updatedAt: "2026-07-22 16:10",
  breadth: [{ time: "15:00", rising: 1530, falling: 2798, flat: 101 }],
  metrics: { limitUp: 47, limitDown: 8, consecutive: 12, largeRise: 23, high20: 31, high120: 20, allTimeHigh: 8, marginBalance: 26978.8 },
  premium: { openPct: 1.79, closePct: 7.05, sampleSize: 12 },
  ladder: { first: [], second: [], third: [], fourth: [], fivePlus: [] },
  sectors: [{ name: "机器人", limitUpCount: 9, averagePct: 3.2, amountGrowthPct: 10, maxStreak: 6 }],
  leaders: [],
};

describe("history table query", () => {
  it("parses only allowlisted sort fields", () => {
    expect(parseHistoryQuery(new URLSearchParams("sort=limitUp&order=asc&limit=2"))).toMatchObject({ sort: "limitUp", order: "asc", limit: 2 });
    expect(parseHistoryQuery(new URLSearchParams("sort=sealRate&order=desc"))).toMatchObject({ sort: "sealRate", order: "desc" });
    expect(() => parseHistoryQuery(new URLSearchParams("sort=payload"))).toThrow("invalid history sort");
  });

  it("sorts numbers and filters sector text", () => {
    const page = queryHistoryRows(rows, { sort: "limitUp", order: "desc", sector: "医药", cursor: 0, limit: 30 });
    expect(page.items.map((row) => row.date)).toEqual(["2026-07-21"]);
  });

  it("paginates without repeating rows", () => {
    const first = queryHistoryRows(rows, { sort: "date", order: "desc", sector: "", cursor: 0, limit: 2 });
    const second = queryHistoryRows(rows, { sort: "date", order: "desc", sector: "", cursor: first.nextCursor!, limit: 2 });
    expect(first.items.map((row) => row.date)).toEqual(["2026-07-22", "2026-07-21"]);
    expect(second.items.map((row) => row.date)).toEqual(["2026-07-20"]);
    expect(second.nextCursor).toBeNull();
  });

  it("keeps unavailable backfilled metrics null instead of zero", () => {
    const row = reviewToHistoryRow({
      ...review,
      breadth: [],
      metrics: { ...review.metrics, largeRise: null, high120: null, allTimeHigh: null },
      historyMeta: { backfilled: true, receivedAt: "2026-07-23T08:00:00.000Z" },
    });
    expect(row).toMatchObject({
      rising: null,
      falling: null,
      flat: null,
      riseFallRatio: null,
      largeRise: null,
      backfilled: true,
    });
  });

  it("calculates a finite rise-fall ratio", () => {
    expect(reviewToHistoryRow(review).riseFallRatio).toBeCloseTo(1530 / 2798, 2);
  });

  it("maps the 20-day high count into the historical comparison row", () => {
    expect(reviewToHistoryRow(review).high20).toBe(31);
  });

  it("does not expose unclassified placeholders as a historical hot sector", () => {
    const row = reviewToHistoryRow({
      ...review,
      sectors: [{ name: "未分类", limitUpCount: 61, averagePct: -0.79, amountGrowthPct: null, maxStreak: 0 }],
      comparison: {
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
      },
    });

    expect(row.topSector).toBe("暂缺");
  });

  it("keeps unavailable values last when sorting either direction", () => {
    const descending = queryHistoryRows(rows, { sort: "marginBalance", order: "desc", sector: "", cursor: 0, limit: 30 });
    const ascending = queryHistoryRows(rows, { sort: "marginBalance", order: "asc", sector: "", cursor: 0, limit: 30 });
    expect(descending.items.at(-1)?.marginBalance).toBeNull();
    expect(ascending.items.at(-1)?.marginBalance).toBeNull();
  });

  it("maps the comparison snapshot into Excel-style history columns", () => {
    const row = reviewToHistoryRow({
      ...review,
      comparison: {
        brokenCount: 6,
        largeDownCount: 19,
        sealRate: 88.68,
        yesterdaySuccessRate: 63.64,
        yesterdaySuccessSampleSize: 44,
        continuation: { positiveRate: 75, averagePct: 2.45, promotionRate: 50, sampleSize: 8 },
        marketAmount: 18_253,
        marketCoveragePct: 99.2,
        maxBoard: { height: 6, stocks: [{ code: "600001", name: "周期甲", pctChange: 10, amount: 1e9, sector: "机器人", limitStreak: 6, firstLimitTime: "09:31:00" }] },
        brokenBoard: { count: 4, rate: 50, sampleSize: 8, stocks: [] },
        mainSectors: [
          { name: "机器人", limitUpCount: 9, averagePct: 3.2, amountGrowthPct: 10, maxStreak: 6 },
          { name: "算力", limitUpCount: 7, averagePct: 2.8, amountGrowthPct: 8, maxStreak: 4 },
        ],
        cycleLeader: { code: "600001", name: "周期甲", pctChange: 10, amount: 1e9, sector: "机器人", limitStreak: 6, firstLimitTime: "09:31:00" },
        recognition: [
          { code: "600001", name: "周期甲", pctChange: 10, amount: 1e9, sector: "机器人", limitStreak: 6, firstLimitTime: "09:31:00" },
          { code: "000002", name: "辨识乙", pctChange: 10, amount: 8e8, sector: "算力", limitStreak: 3, firstLimitTime: "09:35:00" },
        ],
        indices: [{ symbol: "000001.SH", name: "上证指数", price: 3600, pctChange: .52, amount: 7.2e11, marketTime: "2026-07-22T15:00:00+08:00", receivedAt: "2026-07-22T08:10:00Z", source: "腾讯 / 东方财富", status: "complete", message: "" }],
        evidence: {},
      },
    });

    expect(row).toMatchObject({
      brokenCount: 6,
      largeDownCount: 19,
      sealRate: 88.68,
      yesterdaySuccessRate: 63.64,
      continuationAveragePct: 2.45,
      marketAmount: 18_253,
      maxBoardNames: "周期甲",
      brokenBoardCount: 4,
      brokenBoardRate: 50,
      topSector: "机器人 / 算力",
      cycleLeader: "周期甲 · 6板",
      recognition: "旧口径记录 · 周期甲 / 辨识乙",
      indexSummary: "上证指数 +0.52%",
    });
    expect(row.comparison?.brokenCount).toBe(6);
  });
});
