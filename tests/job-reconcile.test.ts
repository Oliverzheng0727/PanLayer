import { describe, expect, it } from "vitest";
import { planCatchUpJobs } from "../lib/jobs/reconcile";

describe("daily job reconciliation", () => {
  it("catches a missed 10:00 breadth job during its observation window", () => {
    const jobs = planCatchUpJobs({
      tradeDate: "2026-07-24",
      now: new Date("2026-07-24T02:12:00Z"),
      checkpoints: [],
    });

    expect(jobs).toContainEqual({ type: "breadth", time: "10:00" });
  });

  it("does not fabricate a missed intraday snapshot after its observation window", () => {
    const jobs = planCatchUpJobs({
      tradeDate: "2026-07-24",
      now: new Date("2026-07-24T07:30:00Z"),
      checkpoints: [],
    });

    expect(jobs).not.toContainEqual({ type: "breadth", time: "10:00" });
  });

  it("keeps 09:25 recoverable from the official opening price during the same session", () => {
    const jobs = planCatchUpJobs({
      tradeDate: "2026-07-24",
      now: new Date("2026-07-24T04:17:00Z"),
      checkpoints: [],
      limit: 20,
    });

    expect(jobs).toContainEqual({ type: "breadth", time: "09:25" });
  });

  it("retries an incomplete close review until 18:00 Beijing", () => {
    const jobs = planCatchUpJobs({
      tradeDate: "2026-07-24",
      now: new Date("2026-07-24T09:00:00Z"),
      checkpoints: [],
    });

    expect(jobs).toContainEqual({ type: "close-review" });
  });

  it("can still rebuild close and ETF data later in the evening", () => {
    const jobs = planCatchUpJobs({
      tradeDate: "2026-07-24",
      now: new Date("2026-07-24T13:00:00Z"),
      checkpoints: [],
      limit: 4,
    });

    expect(jobs).toContainEqual({ type: "close-review" });
    expect(jobs).toContainEqual({ type: "etf-metrics-refresh" });
  });

  it("lets the hourly fallback recover a missed 01:30 history batch at 02:17", () => {
    const jobs = planCatchUpJobs({
      tradeDate: "2026-07-24",
      now: new Date("2026-07-23T18:17:00Z"),
      checkpoints: [],
      limit: 20,
    });

    expect(jobs).toContainEqual({ type: "history-backfill", days: 120 });
  });

  it("does not schedule completed work again", () => {
    const jobs = planCatchUpJobs({
      tradeDate: "2026-07-24",
      now: new Date("2026-07-24T02:12:00Z"),
      checkpoints: [{
        tradeDate: "2026-07-24",
        key: "breadth-10:00",
        stage: "main",
        status: "complete",
        attempt: 1,
        expectedAt: "2026-07-24T10:00:00+08:00",
        startedAt: "2026-07-24T02:00:00Z",
        finishedAt: "2026-07-24T02:01:00Z",
        nextRetryAt: null,
        message: "",
        resultJson: "{}",
      }],
    });

    expect(jobs).not.toContainEqual({ type: "breadth", time: "10:00" });
  });
});
