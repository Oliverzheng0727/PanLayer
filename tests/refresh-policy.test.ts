import { describe, expect, it } from "vitest";
import {
  BREADTH_REFRESH_MS,
  ETF_REFRESH_MS,
  SERVER_LIVE_CACHE_MS,
  isBeijingMarketSession,
  isStale,
} from "../lib/live/refresh-policy";

describe("live refresh policy", () => {
  it("uses the approved refresh intervals", () => {
    expect(ETF_REFRESH_MS).toBe(60_000);
    expect(BREADTH_REFRESH_MS).toBe(180_000);
    expect(SERVER_LIVE_CACHE_MS).toBe(60_000);
  });

  it("recognizes Beijing A-share sessions", () => {
    expect(isBeijingMarketSession(new Date("2026-07-23T02:00:00Z"))).toBe(true);
    expect(isBeijingMarketSession(new Date("2026-07-23T04:00:00Z"))).toBe(false);
    expect(isBeijingMarketSession(new Date("2026-07-25T02:00:00Z"))).toBe(false);
  });

  it("marks a payload older than five minutes as stale", () => {
    const now = new Date("2026-07-23T02:10:01Z");
    expect(isStale("2026-07-23T02:05:00Z", now)).toBe(true);
    expect(isStale("2026-07-23T02:06:00Z", now)).toBe(false);
    expect(isStale(null, now)).toBe(true);
  });
});
