import { describe, expect, it } from "vitest";
import { fetchSinaEtfs } from "../lib/data/sina-etfs";

describe("Sina ETF fallback catalog", () => {
  it("loads every page and maps valid ETF quotes", async () => {
    const requestedPages: number[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("Market_Center.getHQNodeStockCount")) {
        return Response.json("201");
      }
      const page = Number(url.searchParams.get("page"));
      requestedPages.push(page);
      return Response.json(page === 1 ? [
        {
          symbol: "sh588000",
          code: "588000",
          name: "科创50ETF华夏",
          trade: "1.888",
          changepercent: "-3.427",
          amount: "10026719748",
          nmc: "8375294.15616",
          turnoverratio: "11.85163",
        },
      ] : page === 2 ? [
        {
          symbol: "sz159995",
          code: "159995",
          name: "芯片ETF",
          trade: "1.290",
          changepercent: "2.180",
          amount: "2860000000",
          nmc: "2200000",
          turnoverratio: "8.2",
        },
      ] : [
        {
          symbol: "sz159995",
          code: "159995",
          name: "重复芯片ETF",
          trade: "1.291",
          changepercent: "2.190",
          amount: "2860000001",
        },
        {
          symbol: "sh000000",
          code: "000000",
          name: "无效ETF",
          trade: "0",
          changepercent: "0",
          amount: "0",
        },
      ]);
    };

    const items = await fetchSinaEtfs(fetcher, {
      now: new Date("2026-07-23T07:00:00.000Z"),
      concurrency: 2,
    });

    expect(requestedPages.sort()).toEqual([1, 2, 3]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      symbol: "588000",
      exchange: "SH",
      name: "科创50ETF华夏",
      price: 1.888,
      pctChange: -3.427,
      amount: 10_026_719_748,
      turnoverRate: 11.85163,
      updatedAt: "2026-07-23T07:00:00.000Z",
    });
    expect(items[0].scale).toBeCloseTo(83_752_941_561.6);
    expect(items[1]).toMatchObject({
      symbol: "159995",
      exchange: "SZ",
      category: "半导体存储",
    });
  });

  it("rejects an empty catalog so the caller can use the persisted snapshot", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("Market_Center.getHQNodeStockCount")
        ? Response.json("1")
        : Response.json([]);
    };

    await expect(fetchSinaEtfs(fetcher)).rejects.toThrow("Sina ETF catalog is empty");
  });
});
