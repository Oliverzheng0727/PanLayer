import { describe, expect, it } from "vitest";
import { buildBackfilledReview, runHistoryBackfillBatch } from "../lib/history/backfill";
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
  let progressValue: string | null = null;
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes("FROM bootstrap_state")) return (progressValue ? { value: progressValue } : null) as T;
              if (sql.includes("FROM daily_reviews")) {
                const payload = reviews.get(String(args[0]));
                return (payload ? { payload } : null) as T;
              }
              return null as T;
            },
            async run() {
              if (sql.includes("INSERT INTO bootstrap_state")) {
                progressValue = String(args[1]);
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
  return { db: db as unknown as D1Database, reviews, getProgress: () => progressValue };
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

  it("backfills in resumable batches without overwriting a richer review", async () => {
    const richer: DailyReview = {
      ...buildBackfilledReview("2026-07-22", pools, 26978.8, "2026-07-22T08:00:00.000Z"),
      source: "实时收盘",
      historyMeta: undefined,
      breadth: [{ time: "15:00", rising: 3000, falling: 1800, flat: 100 }],
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
    expect(JSON.parse(fixture.reviews.get("2026-07-22")!).source).toBe("实时收盘");
    expect(JSON.parse(fixture.getProgress()!).completed).toHaveLength(6);
  });
});
