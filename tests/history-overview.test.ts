import { describe, expect, it } from "vitest";
import { historyRowToOverview } from "../lib/history/overview";
import type { HistoryRow } from "../lib/history/query";

function row(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    date: "2026-07-23",
    rising: 3200,
    falling: 1700,
    flat: 80,
    riseFallRatio: 1.88,
    limitUp: 72,
    limitDown: 8,
    largeRise: 44,
    brokenCount: 20,
    largeDownCount: 31,
    sealRate: 78.2,
    yesterdaySuccessRate: 61.5,
    continuationPositiveRate: 70,
    continuationAveragePct: 2.4,
    continuationPromotionRate: 34,
    marketAmount: 18253,
    consecutive: 12,
    maxStreak: 6,
    maxBoardNames: "甲公司",
    brokenBoardCount: 4,
    brokenBoardRate: 25,
    cycleLeader: "甲公司 · 6板",
    recognition: "甲公司 / 乙公司",
    indexSummary: "上证指数 +0.50%",
    openPremium: 1.2,
    closePremium: 2.1,
    high120: 39,
    allTimeHigh: 9,
    marginBalance: 19800,
    topSector: "机器人 / 存储",
    backfilled: false,
    status: "complete",
    source: "东方财富 / 腾讯行情",
    updatedAt: "2026-07-23T16:10:00+08:00",
    ...overrides,
  };
}

describe("history overview mapping", () => {
  it("maps one historical row into the six overview cards", () => {
    expect(historyRowToOverview(row())).toEqual({
      date: "2026-07-23",
      rising: 3200,
      falling: 1700,
      limitUp: 72,
      limitDown: 8,
      consecutive: 12,
      maxStreak: 6,
      allTimeHigh: 9,
      high120: 39,
      closePremium: 2.1,
      openPremium: 1.2,
      marginBalance: 19800,
      status: "complete",
      source: "东方财富 / 腾讯行情",
      updatedAt: "2026-07-23T16:10:00+08:00",
    });
  });

  it("keeps unavailable historical values null instead of inventing zeroes", () => {
    const overview = historyRowToOverview(row({
      rising: null,
      falling: null,
      limitUp: null,
      limitDown: null,
      consecutive: null,
      allTimeHigh: null,
      high120: null,
      closePremium: null,
      openPremium: null,
      marginBalance: null,
      status: "partial",
    }));

    expect(overview.rising).toBeNull();
    expect(overview.limitUp).toBeNull();
    expect(overview.consecutive).toBeNull();
    expect(overview.allTimeHigh).toBeNull();
    expect(overview.closePremium).toBeNull();
    expect(overview.marginBalance).toBeNull();
  });
});
