import { describe, expect, it } from "vitest";
import { shouldPoll } from "../lib/live/polling";

describe("visibility-aware polling", () => {
  it("polls ETFs whenever the page is visible", () => {
    expect(shouldPoll({ visible: true, kind: "etf", now: new Date("2026-07-25T02:00:00Z") })).toBe(true);
    expect(shouldPoll({ visible: false, kind: "etf", now: new Date("2026-07-23T02:00:00Z") })).toBe(false);
  });

  it("polls breadth only in a Beijing trading session", () => {
    expect(shouldPoll({ visible: true, kind: "breadth", now: new Date("2026-07-23T02:00:00Z") })).toBe(true);
    expect(shouldPoll({ visible: true, kind: "breadth", now: new Date("2026-07-23T04:00:00Z") })).toBe(false);
  });
});
