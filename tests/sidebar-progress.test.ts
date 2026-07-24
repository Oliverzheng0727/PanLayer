import { describe, expect, it } from "vitest";
import type { DailyJobHealth } from "../lib/data/repository";
import { buildSidebarProgress } from "../lib/jobs/sidebar-progress";

const job = (
  status: "pending" | "running" | "partial" | "complete" | "failed",
  expectedAt: string,
  message = "",
) => ({
  status,
  expectedAt,
  finishedAt: status === "complete" ? "2026-07-24T02:00:00Z" : null,
  nextRetryAt: null,
  message,
  attempt: status === "pending" ? 0 : 1,
  overdue: status === "failed",
});

const progress = {
  targetDate: "2026-07-23",
  completed: 124,
  target: 5317,
  failed: 26,
  remaining: 5193,
  coveragePct: 2.33,
  minimumTarget: 5000,
  universeComplete: true,
  ready: false,
  complete: false,
  updatedAt: null,
};

describe("sidebar progress model", () => {
  it("counts only due one-shot jobs and excludes continuous initialization", () => {
    const health: DailyJobHealth = {
      tradeDate: "2026-07-24",
      generatedAt: "2026-07-24T02:12:00Z",
      jobs: {
        "morning-brief": job("complete", "2026-07-24T07:15:00+08:00"),
        "breadth-09:25": job("complete", "2026-07-24T09:25:00+08:00"),
        "breadth-10:00": job("failed", "2026-07-24T10:00:00+08:00", "timeout"),
        "breadth-11:00": job("pending", "2026-07-24T11:00:00+08:00"),
        "new-high-bootstrap": job("partial", "2026-07-24T02:00:00+08:00"),
        "history-backfill": job("partial", "2026-07-24T01:30:00+08:00"),
        "close-review": job("pending", "2026-07-24T16:10:00+08:00"),
      },
    };

    const result = buildSidebarProgress(health, progress, "partial");

    expect(result.completedDue).toBe(2);
    expect(result.dueTotal).toBe(3);
    expect(result.percentage).toBe(67);
    expect(result.breadthCompleted).toBe(1);
    expect(result.newHighCoveragePct).toBe(2.33);
  });

  it("gives failed and running due jobs precedence over partial review status", () => {
    const health: DailyJobHealth = {
      tradeDate: "2026-07-24",
      generatedAt: "2026-07-24T08:30:00Z",
      jobs: {
        "close-review": job("running", "2026-07-24T16:10:00+08:00"),
      },
    };

    expect(buildSidebarProgress(health, progress, "partial").overallStatus).toBe("running");

    health.jobs["close-review"] = job("failed", "2026-07-24T16:10:00+08:00", "provider timeout");
    expect(buildSidebarProgress(health, progress, "partial").overallStatus).toBe("failed");
  });

  it("marks breadth as waiting when no snapshot is due yet", () => {
    const health: DailyJobHealth = {
      tradeDate: "2026-07-24",
      generatedAt: "2026-07-24T00:00:00Z",
      jobs: {
        "breadth-09:25": job("pending", "2026-07-24T09:25:00+08:00"),
        "breadth-10:00": job("pending", "2026-07-24T10:00:00+08:00"),
      },
    };

    const result = buildSidebarProgress(health, progress, "complete");
    expect(result.tasks.find((item) => item.key === "breadth")?.status).toBe("pending");
  });
});
