import { describe, expect, it } from "vitest";
import { delayMinutes, formatBeijingClock, nextRefreshSeconds } from "../lib/live/market-clock";

describe("global market clock", () => {
  it("formats the current time in Beijing", () => {
    expect(formatBeijingClock(new Date("2026-07-23T02:36:25Z"))).toBe("10:36:25");
  });

  it("calculates whole delayed minutes", () => {
    expect(delayMinutes("2026-07-23T02:29:12Z", new Date("2026-07-23T02:36:25Z"))).toBe(7);
    expect(delayMinutes(null, new Date())).toBeNull();
  });

  it("counts down to the next three-minute refresh", () => {
    expect(nextRefreshSeconds("2026-07-23T02:35:00Z", new Date("2026-07-23T02:36:00Z"))).toBe(120);
    expect(nextRefreshSeconds("2026-07-23T02:30:00Z", new Date("2026-07-23T02:36:00Z"))).toBe(0);
  });
});
