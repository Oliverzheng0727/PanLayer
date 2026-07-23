import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createLiveMarketCache } from "../lib/live/live-market";
import * as marketClock from "../lib/live/market-clock";
import * as metrics from "../lib/domain/metrics";

describe("live market snapshot", () => {
  it("deduplicates requests inside one minute", async () => {
    const cache = createLiveMarketCache<number>(60_000);
    let calls = 0;
    expect(await cache.get(async () => ++calls, 1_000)).toBe(1);
    expect(await cache.get(async () => ++calls, 60_999)).toBe(1);
    expect(await cache.get(async () => ++calls, 61_001)).toBe(2);
  });

  it("does not retain a failed request as current data", async () => {
    const cache = createLiveMarketCache<number>(60_000);
    await expect(cache.get(async () => { throw new Error("down"); }, 1_000)).rejects.toThrow("down");
    await expect(cache.get(async () => 2, 1_001)).resolves.toBe(2);
  });

  it("formats API timestamps for a Chinese reader in Beijing time", () => {
    const format = (marketClock as unknown as { formatBeijingDateTime?: (value: string | null) => string }).formatBeijingDateTime;
    expect(format).toBeTypeOf("function");
    expect(format?.("2026-07-23T03:08:14.541Z")).toBe("2026-07-23 11:08:14");
    expect(format?.(null)).toBe("时间暂缺");
  });

  it("does not turn zero-down breadth into Infinity", () => {
    const format = (metrics as unknown as { formatBreadthRatio?: (rising: number, falling: number) => string }).formatBreadthRatio;
    expect(format).toBeTypeOf("function");
    expect(format?.(93, 0)).toBe("暂缺");
    expect(format?.(1200, 800)).toBe("1.50");
  });

  it("exposes universe coverage separately from cross-source agreement", async () => {
    const liveMarket = await readFile(new URL("../lib/live/live-market.ts", import.meta.url), "utf8");
    expect(liveMarket).toMatch(/universeSize/);
    expect(liveMarket).toMatch(/coveragePct/);
    expect(liveMarket).toMatch(/MINIMUM_ALL_A_UNIVERSE = 5_000/);
  });
});
