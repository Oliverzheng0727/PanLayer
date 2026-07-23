import { describe, expect, it } from "vitest";
import type { EtfSnapshot } from "../lib/data/provider";
import {
  fetchTencentQuotes,
  mapTencentLine,
  refreshEtfCatalogFromTencent,
  toTencentCode,
} from "../lib/data/tencent";

function tencentLine(prefix: string, code: string, price = 10.1, previousClose = 10): string {
  const fields = Array.from({ length: 39 }, () => "0");
  fields[1] = `${code}示例`;
  fields[2] = code;
  fields[3] = String(price);
  fields[4] = String(previousClose);
  fields[5] = "10.01";
  fields[30] = "20260723150000";
  fields[32] = String(((price / previousClose) - 1) * 100);
  fields[33] = "10.20";
  fields[34] = "9.90";
  fields[37] = "10000";
  return `v_${prefix}${code}="${fields.join("~")}";`;
}

function etf(symbol: string, exchange: "SH" | "SZ"): EtfSnapshot {
  return {
    symbol,
    name: `${symbol} ETF`,
    category: "科技AI",
    tags: ["AI"],
    exchange,
    price: 1,
    pctChange: 0,
    amount: 1,
    averageAmount20: null,
    scale: 10,
    turnoverRate: 1,
    status: "active",
    updatedAt: "2026-07-22T07:00:00.000Z",
  };
}

describe("Tencent quote adapter", () => {
  it("converts standard market symbols", () => {
    expect(toTencentCode("600000.SH")).toBe("sh600000");
    expect(toTencentCode("000001.SZ")).toBe("sz000001");
    expect(toTencentCode("430047.BJ")).toBe("bj430047");
  });

  it("maps a Tencent quote line into the shared quote contract", () => {
    expect(mapTencentLine(tencentLine("sh", "600000"))).toMatchObject({
      symbol: "600000.SH",
      name: "600000示例",
      exchange: "SH",
      board: "MAIN",
      price: 10.1,
      previousClose: 10,
      pctChange: 1,
      amount: 100_000_000,
      limitUpPrice: 11,
      limitDownPrice: 9,
    });
    expect(mapTencentLine("broken")).toBeNull();
  });

  it("batches at sixty symbols and never exceeds four active requests", async () => {
    const symbols = Array.from({ length: 121 }, (_, index) => `${String(600000 + index).padStart(6, "0")}.SH`);
    const batchSizes: number[] = [];
    let active = 0;
    let maximumActive = 0;
    const fetcher = (async (input: string | URL | Request) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const codes = (String(input).split("q=")[1] ?? "").split(",").filter(Boolean);
      batchSizes.push(codes.length);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return new Response(codes.map((value) => tencentLine(value.slice(0, 2), value.slice(2))).join("\n"));
    }) as typeof fetch;

    const result = await fetchTencentQuotes(symbols, fetcher);

    expect(batchSizes).toEqual([60, 60, 1]);
    expect(maximumActive).toBeLessThanOrEqual(4);
    expect(result).toHaveLength(121);
  });

  it("refreshes a persisted ETF universe while preserving its classification", async () => {
    const catalog = [etf("510300", "SH"), etf("588000", "SH"), etf("159995", "SZ")];
    const fetcher = (async (input: string | URL | Request) => {
      const codes = (String(input).split("q=")[1] ?? "").split(",").filter(Boolean);
      return new Response(codes.map((value, index) => tencentLine(value.slice(0, 2), value.slice(2), 1.2 + index / 10, 1)).join("\n"));
    }) as typeof fetch;

    const refreshed = await refreshEtfCatalogFromTencent(catalog, fetcher, {
      now: new Date("2026-07-23T07:00:00.000Z"),
    });

    expect(refreshed).toHaveLength(3);
    expect(refreshed[0]).toMatchObject({
      symbol: "510300",
      category: "科技AI",
      tags: ["AI"],
      price: 1.2,
      pctChange: 20,
      updatedAt: "2026-07-23T07:00:00.000Z",
    });
  });

  it("rejects a Tencent refresh with insufficient universe coverage", async () => {
    const catalog = [etf("510300", "SH"), etf("588000", "SH"), etf("159995", "SZ")];
    const fetcher = (async () => new Response(tencentLine("sh", "510300", 1.2, 1))) as typeof fetch;

    await expect(refreshEtfCatalogFromTencent(catalog, fetcher, {
      minimumCoverage: 0.7,
    })).rejects.toThrow("Tencent ETF coverage");
  });
});
