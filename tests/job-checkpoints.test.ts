import { describe, expect, it } from "vitest";
import {
  expectedDailyJobs,
  isCheckpointRetryable,
  type JobCheckpoint,
} from "../lib/jobs/checkpoints";

describe("daily job checkpoints", () => {
  it("declares all daily update checkpoints", () => {
    const keys = expectedDailyJobs("2026-07-24").map((item) => item.key);

    expect(keys).toEqual(expect.arrayContaining([
      "tier1-rss-prefetch",
      "tier2-news-prefetch",
      "morning-brief",
      "breadth-09:25",
      "breadth-10:00",
      "breadth-11:00",
      "breadth-13:00",
      "breadth-14:00",
      "breadth-15:00",
      "etf-metrics-refresh",
      "close-review",
      "new-high-bootstrap",
    ]));
  });

  it("retries failed and stale-running checkpoints but not complete ones", () => {
    const failed: JobCheckpoint = {
      tradeDate: "2026-07-24",
      key: "breadth-10:00",
      stage: "main",
      status: "failed",
      attempt: 2,
      expectedAt: "2026-07-24T10:00:00+08:00",
      startedAt: "2026-07-24T10:00:00+08:00",
      finishedAt: "2026-07-24T10:00:10+08:00",
      nextRetryAt: "2026-07-24T10:05:00+08:00",
      message: "source timeout",
      resultJson: "{}",
    };

    expect(isCheckpointRetryable(failed, new Date("2026-07-24T02:06:00Z"))).toBe(true);
    expect(isCheckpointRetryable({ ...failed, status: "complete" }, new Date("2026-07-24T02:06:00Z"))).toBe(false);
    expect(isCheckpointRetryable({
      ...failed,
      status: "running",
      startedAt: "2026-07-24T02:00:00Z",
      nextRetryAt: null,
    }, new Date("2026-07-24T02:04:00Z"))).toBe(true);
  });
});
