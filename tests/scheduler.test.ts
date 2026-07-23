import { describe, expect, it } from "vitest";
import { canRunCloseReview, jobForBeijingTime, isChinaTradingWeekday, latestCompletedReviewDate } from "../lib/jobs/schedule";

describe("Beijing market schedule", () => {
  it("maps the planned market times to the correct job", () => {
    expect(jobForBeijingTime("07:15")).toEqual({ type: "morning-brief" });
    expect(jobForBeijingTime("08:30")).toEqual({ type: "new-high-bootstrap" });
    expect(jobForBeijingTime("02:00")).toEqual({ type: "new-high-bootstrap" });
    expect(jobForBeijingTime("04:35")).toEqual({ type: "new-high-bootstrap" });
    expect(jobForBeijingTime("06:55")).toEqual({ type: "new-high-bootstrap" });
    expect(jobForBeijingTime("04:36")).toBeNull();
    expect(jobForBeijingTime("07:00")).toBeNull();
    expect(jobForBeijingTime("09:25")).toEqual({ type: "breadth", time: "09:25" });
    expect(jobForBeijingTime("15:00")).toEqual({ type: "breadth", time: "15:00" });
    expect(jobForBeijingTime("16:10")).toEqual({ type: "close-review" });
    expect(jobForBeijingTime("12:12")).toBeNull();
  });

  it("skips Saturday and Sunday in Asia/Shanghai", () => {
    expect(isChinaTradingWeekday(new Date("2026-07-24T23:30:00Z"))).toBe(false);
    expect(isChinaTradingWeekday(new Date("2026-07-26T23:00:00Z"))).toBe(true);
  });

  it("keeps the previous completed trading snapshot before the 16:10 close job", () => {
    const beforeOpen = new Date("2026-07-23T16:56:31Z");
    expect(canRunCloseReview(beforeOpen)).toBe(false);
    expect(latestCompletedReviewDate(beforeOpen)).toBe("2026-07-23");
  });

  it("allows the current trading-day review from 16:10 Beijing time", () => {
    const closeTime = new Date("2026-07-24T08:10:00Z");
    expect(canRunCloseReview(closeTime)).toBe(true);
    expect(latestCompletedReviewDate(closeTime)).toBe("2026-07-24");
    expect(canRunCloseReview(new Date("2026-07-25T08:10:00Z"))).toBe(false);
  });
});
