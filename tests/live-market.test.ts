import { describe, expect, it } from "vitest";
import { createLiveMarketCache } from "../lib/live/live-market";

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
});
