import { describe, expect, it } from "vitest";
import { jobForBeijingTime, isChinaTradingWeekday } from "../lib/jobs/schedule";

describe("Beijing market schedule", () => {
  it("maps the planned market times to the correct job", () => {
    expect(jobForBeijingTime("07:15")).toEqual({ type: "morning-brief" });
    expect(jobForBeijingTime("09:25")).toEqual({ type: "breadth", time: "09:25" });
    expect(jobForBeijingTime("15:00")).toEqual({ type: "breadth", time: "15:00" });
    expect(jobForBeijingTime("16:10")).toEqual({ type: "close-review" });
    expect(jobForBeijingTime("12:12")).toBeNull();
  });

  it("skips Saturday and Sunday in Asia/Shanghai", () => {
    expect(isChinaTradingWeekday(new Date("2026-07-24T23:30:00Z"))).toBe(false);
    expect(isChinaTradingWeekday(new Date("2026-07-26T23:00:00Z"))).toBe(true);
  });
});
