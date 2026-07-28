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

  it("counts a persisted partial-quality breadth snapshot as captured", () => {
    const health: DailyJobHealth = {
      tradeDate: "2026-07-24",
      generatedAt: "2026-07-24T02:05:00Z",
      jobs: {
        "breadth-09:25": job("partial", "2026-07-24T09:25:00+08:00", "数据质量 partial"),
        "breadth-10:00": job("partial", "2026-07-24T10:00:00+08:00", "数据质量 partial"),
        "breadth-11:00": job("pending", "2026-07-24T11:00:00+08:00"),
      },
    };

    const result = buildSidebarProgress(health, progress, "partial");
    expect(result.breadthCompleted).toBe(2);
    expect(result.tasks.find((item) => item.key === "breadth")?.detail).toContain("已采集 2/6");
    expect(result.tasks.find((item) => item.key === "breadth")?.detail).toContain("待采集");
  });

  it("marks market-session tasks as closed on weekends instead of showing zero snapshots", () => {
    const health: DailyJobHealth = {
      tradeDate: "2026-07-25",
      generatedAt: "2026-07-25T02:00:00Z",
      marketSession: false,
      jobs: {
        "morning-brief": job("pending", "2026-07-25T07:15:00+08:00"),
      },
    };

    const result = buildSidebarProgress(health, progress, "partial");
    expect(result.marketSession).toBe(false);
    expect(result.tasks.find((item) => item.key === "breadth")).toMatchObject({ status: "closed", value: "非交易日" });
    expect(result.tasks.find((item) => item.key === "close-review")).toMatchObject({ status: "closed", value: "不适用" });
    expect(result.tasks.find((item) => item.key === "etf")).toMatchObject({ status: "closed", value: "不适用" });
  });

  it("does not inherit Friday's failed review status on a closed weekend", () => {
    const health: DailyJobHealth = {
      tradeDate: "2026-07-26",
      generatedAt: "2026-07-26T06:00:00Z",
      marketSession: false,
      jobs: {
        "morning-brief": job("complete", "2026-07-26T07:15:00+08:00"),
      },
    };

    expect(buildSidebarProgress(health, progress, "failed").overallStatus).not.toBe("failed");
  });

  it("exposes RSS and Firecrawl failures in the expanded task list", () => {
    const health: DailyJobHealth = {
      tradeDate: "2026-07-26",
      generatedAt: "2026-07-26T06:00:00Z",
      marketSession: false,
      jobs: {
        "tier1-rss-prefetch": job("failed", "2026-07-26T06:50:00+08:00", "RSS timeout"),
        "tier2-news-prefetch": job("partial", "2026-07-26T06:55:00+08:00", "Firecrawl 2/3 sources"),
      },
    };

    expect(buildSidebarProgress(health, progress, "complete").tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "tier1-rss", status: "failed", detail: "RSS timeout" }),
      expect.objectContaining({ key: "tier2-firecrawl", status: "partial", detail: "Firecrawl 2/3 sources" }),
    ]));
  });

  it("keeps background new-high initialization from turning completed daily data partial", () => {
    const health: DailyJobHealth = {
      tradeDate: "2026-07-24",
      generatedAt: "2026-07-24T09:00:00Z",
      marketSession: true,
      jobs: {
        "close-review": job("partial", "2026-07-24T16:10:00+08:00", "收盘数据完整，新高初始化中"),
      },
      stages: {
        "close-review:quotes": { status: "complete", finishedAt: null, nextRetryAt: null, message: "" },
        "close-review:board-pools": { status: "complete", finishedAt: null, nextRetryAt: null, message: "" },
        "close-review:signals": { status: "complete", finishedAt: null, nextRetryAt: null, message: "" },
        "close-review:recognition": { status: "complete", finishedAt: null, nextRetryAt: null, message: "" },
        "close-review:aggregate": { status: "complete", finishedAt: null, nextRetryAt: null, message: "" },
        "close-review:indices": { status: "complete", finishedAt: null, nextRetryAt: null, message: "" },
        "close-review:new-highs": { status: "partial", finishedAt: null, nextRetryAt: null, message: "初始化中" },
      },
    };

    const result = buildSidebarProgress(health, progress, "partial");
    expect(result.overallStatus).toBe("complete");
    expect(result.tasks.find((item) => item.key === "close-review")).toMatchObject({
      status: "complete",
      value: "6/6",
    });
  });
});
