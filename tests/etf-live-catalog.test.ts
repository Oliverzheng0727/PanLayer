import { describe, expect, it } from "vitest";
import { createEtfCatalogCache } from "../lib/etf/live-catalog";

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
});
