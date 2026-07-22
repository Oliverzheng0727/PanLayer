import { describe, expect, it } from "vitest";
import { buildDailyReview, persistGlobalPoints, persistSourceAudits, shouldSkipMorningBrief } from "../lib/jobs/runner";
import type { Quote } from "../lib/domain/types";
import type { SourceAudit } from "../lib/data/quality";

const q = (symbol: string, pctChange: number, streak = 0): Quote => ({
  symbol, name: symbol, exchange: "SH", board: "MAIN", isST: false, isNoLimitDay: false,
  previousClose: 10, open: 10.2, price: pctChange === 10 ? 11 : 10 * (1 + pctChange / 100),
  high: 11, low: 9.8, pctChange, amount: 100, turnoverRate: 2,
  limitUpPrice: 11, limitDownPrice: 9, sector: streak ? "机器人" : "银行",
  firstLimitTime: streak ? "09:35:00" : null, limitStreak: streak,
});

describe("close review aggregation", () => {
  it("does not bill OpenAI twice for a completed date unless force is explicit", () => {
    expect(shouldSkipMorningBrief("complete", false)).toBe(true);
    expect(shouldSkipMorningBrief("complete", true)).toBe(false);
    expect(shouldSkipMorningBrief("failed", false)).toBe(false);
  });

  it("upserts domestic audits and global points by their unique keys", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return { bind: (...values: unknown[]) => ({ run: async () => { calls.push({ sql, values }); } }) };
      },
    } as unknown as D1Database;
    const audit: SourceAudit = {
      source: "东方财富", marketTime: "2026-07-23T15:00:00+08:00", receivedAt: "2026-07-23T07:00:00Z",
      rawCount: 100, validCount: 99, invalidCount: 1, coveragePct: 99, directionAgreementPct: 99,
      priceAgreementPct: 99, breadthDifference: 1, status: "complete", message: "双源一致",
    };
    await persistSourceAudits(db, "2026-07-23", "15:00", [audit]);
    await persistGlobalPoints(db, "2026-07-23", [{
      key: "sp500", label: "标普500", provider: "Twelve Data", value: 630, previousClose: 625, pctChange: .8,
      marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", status: "ok", message: "",
    }]);
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain("ON CONFLICT(trade_date, snapshot_time, source)");
    expect(calls[1].sql).toContain("ON CONFLICT(trade_date, symbol, provider)");
    expect(calls[0].values.slice(0, 3)).toEqual(["2026-07-23", "15:00", "东方财富"]);
    expect(calls[1].values.slice(0, 3)).toEqual(["2026-07-23", "sp500", "标普500"]);
  });

  it("builds objective metrics, ladders and rankings from quotes and the limit pool", () => {
    const review = buildDailyReview({
      date: "2026-07-22",
      quotes: [q("A", 10), q("B", -10), q("C", 8), q("D", 1)],
      limitPool: [q("A", 10, 2)],
      breadth: [{ time: "15:00", rising: 3, falling: 1, flat: 0 }],
      marginBalance: 26_000,
      high120: 4,
      allTimeHigh: 2,
      source: "东方财富",
    });
    expect(review.metrics).toMatchObject({ limitUp: 1, limitDown: 1, consecutive: 1, largeRise: 1, high120: 4, allTimeHigh: 2 });
    expect(review.ladder.second[0].symbol).toBe("A");
    expect(review.leaders[0].symbol).toBe("A");
    expect(review.status).toBe("complete");
  });

  it("marks unavailable new-high data partial instead of inventing zero values", () => {
    const review = buildDailyReview({
      date: "2026-07-22", quotes: [], limitPool: [], breadth: [], marginBalance: null,
      high120: null, allTimeHigh: null, source: "东方财富",
    });
    expect(review.status).toBe("partial");
    expect(review.metrics.high120).toBeNull();
    expect(review.metrics.allTimeHigh).toBeNull();
  });

  it("derives a 15:00 breadth snapshot when close review has no intraday rows", () => {
    const review = buildDailyReview({
      date: "2026-07-23", quotes: [q("A", 1), q("B", -1), q("C", 0)], limitPool: [], breadth: [],
      marginBalance: null, high120: null, allTimeHigh: null, source: "东方财富",
    });
    expect(review.breadth).toEqual([{ time: "15:00", rising: 1, falling: 1, flat: 1 }]);
  });
});
