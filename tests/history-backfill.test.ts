import { describe, expect, it } from "vitest";
import {
  buildBackfilledReview,
  buildEvidenceOnlyBackfilledReview,
  mergeBackfilledStructure,
  runHistoryBackfillBatch,
} from "../lib/history/backfill";
import type { HistoricalBoardPools } from "../lib/history/backfill-sources";
import type { DailyReview } from "../lib/domain/types";

const pools: HistoricalBoardPools = {
  limitUp: [
    { code: "600001", name: "电子甲", pctChange: 10.01, amount: 800_000_000, industry: "电子", limitStreak: 3, previousLimitStreak: 0, firstLimitTime: "09:35:00" },
    { code: "000002", name: "医药乙", pctChange: 10.02, amount: 500_000_000, industry: "医药", limitStreak: 1, previousLimitStreak: 0, firstLimitTime: "10:05:00" },
  ],
  broken: [
    { code: "600004", name: "炸板丁", pctChange: 3, amount: 200_000_000, industry: "电子", limitStreak: 1, previousLimitStreak: 0, firstLimitTime: "10:15:00" },
  ],
  limitDown: [
    { code: "600003", name: "跌停丙", pctChange: -10, amount: 300_000_000, industry: "消费", limitStreak: 0, previousLimitStreak: 0, firstLimitTime: null },
  ],
  yesterdayLimitUp: [
    { code: "600001", name: "电子甲", pctChange: 2, amount: 800_000_000, industry: "电子", limitStreak: 0, previousLimitStreak: 2, firstLimitTime: "09:35:00" },
    { code: "600005", name: "断板戊", pctChange: -3, amount: 400_000_000, industry: "医药", limitStreak: 0, previousLimitStreak: 3, firstLimitTime: "10:20:00" },
  ],
};

function createBackfillDb(existing: Record<string, DailyReview> = {}) {
  const reviews = new Map(Object.entries(existing).map(([date, review]) => [date, JSON.stringify(review)]));
  const bootstrapState = new Map<string, string>();
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes("FROM bootstrap_state")) {
                const value = bootstrapState.get(String(args[0]));
                return (value ? { value } : null) as T;
              }
              if (sql.includes("FROM daily_reviews")) {
                const payload = reviews.get(String(args[0]));
                return (payload ? { payload } : null) as T;
              }
              return null as T;
            },
            async all<T>() {
              if (sql.includes("FROM daily_reviews") && sql.includes("BETWEEN")) {
                const from = String(args[0]);
                const to = String(args[1]);
                return {
                  results: [...reviews.entries()]
                    .filter(([date]) => date >= from && date <= to)
                    .map(([trade_date, payload]) => ({ trade_date, payload })),
                } as T;
              }
              return { results: [] } as T;
            },
            async run() {
              if (sql.includes("INSERT INTO bootstrap_state")) {
                bootstrapState.set(String(args[0]), String(args[1]));
              }
              if (sql.includes("INSERT INTO daily_reviews")) {
                reviews.set(String(args[0]), String(args[1]));
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
  return {
    db: db as unknown as D1Database,
    reviews,
    getProgress: () => [...bootstrapState.entries()]
      .find(([key]) => key.startsWith("history-backfill"))?.[1] ?? null,
  };
}

function createBackfillFetcher() {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("sina.com.cn")) {
      return new Response(JSON.stringify([
        { day: "2026-07-15", close: "3500" },
        { day: "2026-07-16", close: "3501" },
        { day: "2026-07-17", close: "3502" },
        { day: "2026-07-20", close: "3503" },
        { day: "2026-07-21", close: "3504" },
        { day: "2026-07-22", close: "3505" },
      ]));
    }
    if (url.includes("RPTA_WEB_RZRQ_LSSH")) {
      return new Response(JSON.stringify({ result: { data: [{ RZRQYE: 269788000000 }] } }));
    }
    const pool = url.includes("getTopicZTPool")
      ? [{ c: "600001", n: "电子甲", zdp: 10.01, amount: 800_000_000, hybk: "电子", lbc: 3, fbt: 93500 }]
      : url.includes("getTopicDTPool")
        ? [{ c: "600003", n: "跌停丙", zdp: -10, amount: 300_000_000, hybk: "消费", lbc: 0 }]
        : [];
    return new Response(JSON.stringify({ data: { pool } }));
  };
}

describe("history review backfill", () => {
  it("builds a truthful partial review from historical board pools", () => {
    const review = buildBackfilledReview("2026-07-22", pools, 26978.8, "2026-07-23T08:00:00.000Z");

    expect(review.breadth).toEqual([]);
    expect(review.metrics).toMatchObject({
      limitUp: 2,
      limitDown: 1,
      consecutive: 1,
      largeRise: null,
      high120: null,
      allTimeHigh: null,
      marginBalance: 26978.8,
    });
    expect(review.ladder.third).toHaveLength(1);
    expect(review.comparison).toMatchObject({
      brokenCount: 1,
      largeDownCount: null,
      sealRate: 66.67,
      yesterdaySuccessRate: 50,
      marketAmount: null,
      brokenBoard: { count: 1, rate: 50, sampleSize: 2 },
    });
    expect(review.status).toBe("partial");
    expect(review.historyMeta).toEqual({ backfilled: true, receivedAt: "2026-07-23T08:00:00.000Z" });
  });

  it("keeps pool-derived fields null when the public pool archive cannot reach an older date", () => {
    const review = buildEvidenceOnlyBackfilledReview(
      "2026-01-30",
      26_500,
      "2026-07-27T10:00:00.000Z",
      [],
      "历史四池超出公开源可回溯窗口",
    );

    expect(review.status).toBe("partial");
    expect(review.metrics).toMatchObject({
      limitUp: null,
      limitDown: null,
      consecutive: null,
      high20: null,
      high120: null,
      allTimeHigh: null,
      marginBalance: 26_500,
    });
    expect(review.comparison).toMatchObject({
      brokenCount: null,
      sealRate: null,
      yesterdaySuccessRate: null,
      maxBoard: null,
      brokenBoard: { count: null, rate: null, sampleSize: 0 },
    });
    expect(review.comparison?.evidence.brokenCount.status).toBe("failed");
  });

  it("repairs a richer review's missing market structure without overwriting its breadth", async () => {
    const richer: DailyReview = {
      ...buildBackfilledReview("2026-07-22", pools, 26978.8, "2026-07-22T08:00:00.000Z"),
      source: "实时收盘",
      historyMeta: undefined,
      breadth: [{ time: "15:00", rising: 3000, falling: 1800, flat: 100 }],
      structure: {
        status: "failed",
        source: "新浪财经",
        message: "涨停池不可用",
        receivedAt: "2026-07-22T08:10:00.000Z",
      },
      ladder: { first: [], second: [], third: [], fourth: [], fivePlus: [] },
      sectors: [],
      leaders: [],
    };
    const fixture = createBackfillDb({ "2026-07-22": richer });
    const fetcher = createBackfillFetcher();

    const first = await runHistoryBackfillBatch({
      db: fixture.db,
      endDate: "2026-07-22",
      days: 6,
      batchSize: 5,
      fetcher: fetcher as typeof fetch,
    });
    const second = await runHistoryBackfillBatch({
      db: fixture.db,
      endDate: "2026-07-22",
      days: 6,
      batchSize: 5,
      fetcher: fetcher as typeof fetch,
    });

    expect(first).toMatchObject({ target: 6, completed: 5, remaining: 1 });
    expect(second).toMatchObject({ target: 6, completed: 6, remaining: 0 });
    expect(fixture.reviews.size).toBe(6);
    const repaired = JSON.parse(fixture.reviews.get("2026-07-22")!) as DailyReview;
    expect(repaired.source).toContain("实时收盘");
    expect(repaired.breadth).toEqual([{ time: "15:00", rising: 3000, falling: 1800, flat: 100 }]);
    expect(repaired.ladder.third[0].name).toBe("电子甲");
    expect(repaired.sectors[0].name).toBe("电子");
    expect(repaired.leaders[0].name).toBe("电子甲");
    expect(repaired.structure).toMatchObject({ status: "complete", source: "东方财富历史四池" });
    expect(JSON.parse(fixture.getProgress()!).completed).toHaveLength(6);
  });

  it("seeds a larger target from already backfilled dates instead of downloading them again", async () => {
    const existing = buildBackfilledReview(
      "2026-07-22",
      pools,
      26978.8,
      "2026-07-22T08:00:00.000Z",
    );
    const fixture = createBackfillDb({ "2026-07-22": existing });

    const progress = await runHistoryBackfillBatch({
      db: fixture.db,
      endDate: "2026-07-22",
      days: 6,
      batchSize: 5,
      fetcher: createBackfillFetcher() as typeof fetch,
    });

    expect(progress).toMatchObject({ target: 6, completed: 6, remaining: 0 });
  });

  it("advances across older dates with truthful partial rows when historical pools have expired", async () => {
    const fixture = createBackfillDb();
    const normalFetcher = createBackfillFetcher();
    const expiredPoolFetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (
        url.includes("getTopicZTPool")
        || url.includes("getTopicZBPool")
        || url.includes("getTopicDTPool")
        || url.includes("getYesterdayZTPool")
      ) {
        return new Response(JSON.stringify({ data: null }));
      }
      return normalFetcher(input, init);
    };

    const progress = await runHistoryBackfillBatch({
      db: fixture.db,
      endDate: "2026-07-22",
      days: 6,
      batchSize: 5,
      fetcher: expiredPoolFetcher as typeof fetch,
    });

    expect(progress).toMatchObject({ target: 6, completed: 5, remaining: 1 });
    const review = JSON.parse(fixture.reviews.get("2026-07-22")!) as DailyReview;
    expect(review.metrics.limitUp).toBeNull();
    expect(review.metrics.marginBalance).toBeNull();
    expect(review.unavailableReason).toContain("不写入伪造零值");
  });

  it("preserves verified aggregate and index evidence while replacing historical pool structure", () => {
    const existing = buildBackfilledReview(
      "2026-07-22",
      pools,
      26978.8,
      "2026-07-22T08:00:00.000Z",
    );
    existing.comparison!.largeDownCount = 167;
    existing.comparison!.marketAmount = 18_253;
    existing.comparison!.marketCoveragePct = 98.5;
    existing.comparison!.indices = [{
      symbol: "000001.SH",
      name: "上证指数",
      price: 3500,
      pctChange: 0.5,
      amount: 500_000_000_000,
      marketTime: "2026-07-22T15:00:00+08:00",
      receivedAt: "2026-07-22T15:01:00+08:00",
      source: "腾讯 / 东方财富",
      status: "complete",
      message: "已交叉核验",
    }];
    existing.comparison!.evidence.largeDownCount = {
      source: "全市场收盘快照",
      formula: "真实快照计算",
      marketTime: "2026-07-22T15:00:00+08:00",
      receivedAt: "2026-07-22T15:01:00+08:00",
      sampleSize: 5300,
      coveragePct: 99,
      status: "complete",
      message: "",
    };
    existing.comparison!.evidence.marketAmount = {
      ...existing.comparison!.evidence.largeDownCount,
      source: "全市场成交额快照",
    };
    existing.comparison!.evidence.indices = {
      ...existing.comparison!.evidence.largeDownCount,
      source: "腾讯 / 东方财富",
      sampleSize: 5,
    };
    const refreshed = buildBackfilledReview(
      "2026-07-22",
      { ...pools, broken: [] },
      null,
      "2026-07-24T08:00:00.000Z",
    );

    const merged = mergeBackfilledStructure(existing, refreshed);

    expect(merged.comparison?.brokenCount).toBe(0);
    expect(merged.comparison?.largeDownCount).toBe(167);
    expect(merged.comparison?.marketAmount).toBe(18_253);
    expect(merged.comparison?.marketCoveragePct).toBe(98.5);
    expect(merged.comparison?.indices[0]?.source).toBe("腾讯 / 东方财富");
    expect(merged.comparison?.evidence.marketAmount.source).toBe("全市场成交额快照");
  });
});
