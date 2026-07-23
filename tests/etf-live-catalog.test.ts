import { describe, expect, it } from "vitest";
import type { EtfSnapshot } from "../lib/data/provider";
import {
  createEtfCatalogCache,
  loadEtfCatalogWithFallback,
} from "../lib/etf/live-catalog";

const etf = (symbol: string, updatedAt = "2026-07-23T07:00:00.000Z"): EtfSnapshot => ({
  symbol,
  name: `ETF ${symbol}`,
  category: "宽基指数",
  tags: ["宽基"],
  exchange: symbol.startsWith("5") ? "SH" : "SZ",
  price: 1,
  pctChange: 0,
  amount: 1_000_000,
  averageAmount20: null,
  scale: null,
  turnoverRate: null,
  status: "active",
  updatedAt,
});

describe("ETF live catalog cache", () => {
  it("reuses a full catalog inside the freshness window", async () => {
    const cache = createEtfCatalogCache<number[]>(1_000);
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return [calls];
    };

    expect(await cache.get(loader, 10_000)).toEqual([1]);
    expect(await cache.get(loader, 10_500)).toEqual([1]);
    expect(calls).toBe(1);
    expect(await cache.get(loader, 11_001)).toEqual([2]);
  });

  it("does not retain a rejected catalog request", async () => {
    const cache = createEtfCatalogCache<number[]>(1_000);
    let calls = 0;
    const loader = async () => {
      calls += 1;
      if (calls === 1) throw new Error("source down");
      return [2];
    };

    await expect(cache.get(loader, 10_000)).rejects.toThrow("source down");
    await expect(cache.get(loader, 10_001)).resolves.toEqual([2]);
  });

  it("returns the same timestamped envelope inside the one-minute cache", async () => {
    const cache = createEtfCatalogCache<{ items: number[]; receivedAt: string }>(60_000);
    let calls = 0;
    const loader = async () => ({ items: [++calls], receivedAt: new Date(10_000).toISOString() });

    expect(await cache.get(loader, 10_000)).toEqual(await cache.get(loader, 69_999));
    expect(calls).toBe(1);
    expect((await cache.get(loader, 70_001)).items).toEqual([2]);
  });

  it("uses Sina and persists it when Eastmoney fails", async () => {
    const saved: unknown[] = [];

    const result = await loadEtfCatalogWithFallback({
      date: "2026-07-23",
      providers: [
        { source: "东方财富", status: "complete", load: async () => { throw new Error("Eastmoney 520"); } },
        { source: "新浪财经", status: "partial", load: async () => [etf("159995")] },
      ],
      store: {
        save: async (snapshot) => { saved.push(snapshot); },
        loadLatest: async () => null,
      },
      now: new Date("2026-07-23T07:00:00.000Z"),
    });

    expect(result).toMatchObject({
      items: [{ symbol: "159995" }],
      source: "新浪财经",
      status: "partial",
      receivedAt: "2026-07-23T07:00:00.000Z",
      isStale: false,
    });
    expect(saved).toEqual([expect.objectContaining({
      tradeDate: "2026-07-23",
      source: "新浪财经",
      status: "partial",
    })]);
  });

  it("uses the latest D1 snapshot instead of returning an empty catalog", async () => {
    let saves = 0;
    const result = await loadEtfCatalogWithFallback({
      date: "2026-07-23",
      providers: [
        { source: "东方财富", status: "complete", load: async () => { throw new Error("Eastmoney 520"); } },
        { source: "腾讯财经", status: "partial", load: async () => { throw new Error("Tencent 503"); } },
        { source: "新浪财经", status: "partial", load: async () => { throw new Error("Sina 503"); } },
      ],
      store: {
        save: async () => { saves += 1; },
        loadLatest: async () => ({
          tradeDate: "2026-07-22",
          items: [etf("510300", "2026-07-22T07:00:00.000Z")],
          source: "东方财富",
          status: "complete",
          receivedAt: "2026-07-22T07:00:00.000Z",
        }),
      },
      now: new Date("2026-07-23T07:00:00.000Z"),
    });

    expect(result).toMatchObject({
      items: [{ symbol: "510300" }],
      source: "东方财富 · 历史快照",
      status: "partial",
      receivedAt: "2026-07-22T07:00:00.000Z",
      isStale: true,
    });
    expect(saves).toBe(0);
  });

  it("fails only when both live sources and the durable snapshot are unavailable", async () => {
    await expect(loadEtfCatalogWithFallback({
      date: "2026-07-23",
      providers: [
        { source: "东方财富", status: "complete", load: async () => { throw new Error("Eastmoney 520"); } },
        { source: "新浪财经", status: "partial", load: async () => { throw new Error("Sina 503"); } },
      ],
      store: {
        save: async () => undefined,
        loadLatest: async () => null,
      },
      now: new Date("2026-07-23T07:00:00.000Z"),
    })).rejects.toThrow("ETF live sources unavailable");
  });
});
