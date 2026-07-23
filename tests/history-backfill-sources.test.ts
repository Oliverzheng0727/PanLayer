import { describe, expect, it } from "vitest";
import { fetchHistoricalBoardPools, fetchRecentTradingDates } from "../lib/history/backfill-sources";

describe("history backfill sources", () => {
  it("returns the newest 20 Shanghai Composite trading dates on or before endDate", async () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      day: `2026-07-${String(index + 1).padStart(2, "0")}`,
      close: "3500",
    }));
    const fetcher = async () => new Response(JSON.stringify(rows));

    const dates = await fetchRecentTradingDates("2026-07-23", 20, fetcher as typeof fetch);

    expect(dates).toHaveLength(20);
    expect(dates[0]).toBe("2026-07-23");
    expect(dates.at(-1)).toBe("2026-07-04");
  });

  it("maps Eastmoney four-pool fields without inventing values", async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const endpoint = String(input);
      const pool = endpoint.includes("getTopicZTPool")
        ? [{ c: "600001", n: "示例", zdp: 10.01, amount: 800000000, hybk: "电子", lbc: 3, fbt: 93500 }]
        : [];
      return new Response(JSON.stringify({ data: { pool } }));
    };

    const pools = await fetchHistoricalBoardPools("2026-07-22", fetcher as typeof fetch);

    expect(pools.limitUp[0]).toMatchObject({
      code: "600001",
      name: "示例",
      pctChange: 10.01,
      amount: 800000000,
      industry: "电子",
      limitStreak: 3,
      firstLimitTime: "09:35:00",
    });
    expect(pools.broken).toEqual([]);
    expect(pools.limitDown).toEqual([]);
    expect(pools.yesterdayLimitUp).toEqual([]);
  });

  it("rejects malformed pool payloads instead of accepting an unknown date as zero", async () => {
    const fetcher = async () => new Response(JSON.stringify({ data: null }));
    await expect(fetchHistoricalBoardPools("2026-07-22", fetcher as typeof fetch)).rejects.toThrow("missing pool");
  });

  it("bounds every source request with an abort signal", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      return String(input).includes("sina.com.cn")
        ? new Response(JSON.stringify([{ day: "2026-07-22", close: "3500" }]))
        : new Response(JSON.stringify({ data: { pool: [] } }));
    };

    await fetchRecentTradingDates("2026-07-22", 1, fetcher as typeof fetch);
    await fetchHistoricalBoardPools("2026-07-22", fetcher as typeof fetch);

    expect(signals).toHaveLength(5);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  });
});
