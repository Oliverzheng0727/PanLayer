import { describe, expect, it } from "vitest";
import {
  executeRemoteSchedulerTick,
  isValidSchedulerAuthorization,
  normalizeSchedulerProvider,
  planRemoteSchedulerJobs,
  recordSchedulerHeartbeat,
} from "../lib/jobs/remote-scheduler";
import type { DailyJobKey, JobCheckpoint } from "../lib/jobs/checkpoints";

const checkpoint = (
  key: DailyJobKey,
  expectedAt: string,
): JobCheckpoint => ({
  tradeDate: "2026-07-24",
  key,
  stage: "main",
  status: "partial",
  attempt: 1,
  expectedAt,
  startedAt: "2026-07-24T08:10:00.000Z",
  finishedAt: "2026-07-24T08:11:00.000Z",
  nextRetryAt: null,
  message: "incomplete",
  resultJson: "{}",
});

const completedCheckpoint = (
  key: DailyJobKey,
  expectedAt: string,
): JobCheckpoint => ({
  ...checkpoint(key, expectedAt),
  status: "complete",
  nextRetryAt: null,
});

describe("remote scheduler", () => {
  it("accepts only the configured bearer secret", () => {
    expect(isValidSchedulerAuthorization("Bearer scheduler-secret", "scheduler-secret")).toBe(true);
    expect(isValidSchedulerAuthorization("Bearer wrong-secret", "scheduler-secret")).toBe(false);
    expect(isValidSchedulerAuthorization(null, "scheduler-secret")).toBe(false);
    expect(isValidSchedulerAuthorization("Bearer scheduler-secret", "")).toBe(false);
  });

  it("keeps known scheduler providers and labels legacy authenticated callers as workers", () => {
    expect(normalizeSchedulerProvider("cloudflare")).toBe("cloudflare");
    expect(normalizeSchedulerProvider("github")).toBe("github");
    expect(normalizeSchedulerProvider("worker")).toBe("worker");
    expect(normalizeSchedulerProvider("unknown")).toBe("worker");
    expect(normalizeSchedulerProvider(null)).toBe("worker");
  });

  it("plans the exact evening history-contribution batch", () => {
    const jobs = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T13:15:00.000Z"),
      checkpoints: [],
    });

    expect(jobs.some((job) => job.type === "history-contribution-bootstrap")).toBe(true);
    expect(jobs.length).toBeLessThanOrEqual(2);
  });

  it("treats the hourly :17 recovery call as a recovery tick instead of rounding it to :15", () => {
    const jobs = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T13:17:00.000Z"),
      checkpoints: [],
    });

    expect(jobs).toContainEqual({ type: "daily-new-high-refresh" });
    expect(jobs).not.toContainEqual({ type: "history-contribution-bootstrap" });
  });

  it("alternates new-high and history contributions instead of running them together", () => {
    const newHigh = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T10:30:00.000Z"),
      checkpoints: [],
    });
    const contributions = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T10:45:00.000Z"),
      checkpoints: [],
    });

    expect(newHigh).toContainEqual({ type: "new-high-bootstrap" });
    expect(newHigh).not.toContainEqual({ type: "history-contribution-bootstrap" });
    expect(contributions).toContainEqual({ type: "history-contribution-bootstrap" });
    expect(contributions).not.toContainEqual({ type: "new-high-bootstrap" });
  });

  it("does not rerun an exact-time batch after its checkpoint completed", () => {
    const completed = (
      key: DailyJobKey,
      expectedAt: string,
    ): JobCheckpoint => ({
      ...checkpoint(key, expectedAt),
      status: "complete",
      nextRetryAt: null,
    });

    const jobs = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T15:30:00.000Z"),
      checkpoints: [
        completed("new-high-bootstrap", "2026-07-24T08:30:00+08:00"),
        completed("etf-metrics-refresh", "2026-07-24T15:30:00+08:00"),
        completed("close-review", "2026-07-24T16:10:00+08:00"),
      ],
    });

    expect(jobs.some((job) => job.type === "new-high-bootstrap")).toBe(false);
  });

  it("retries the 09:25 capture on the following minute when the first attempt failed", () => {
    const failed = checkpoint("breadth-09:25", "2026-07-24T09:25:00+08:00");
    const jobs = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T01:26:00.000Z"),
      checkpoints: [{
        ...failed,
        status: "failed",
        nextRetryAt: "2026-07-24T01:25:40.000Z",
      }],
    });

    expect(jobs).toContainEqual({ type: "breadth", time: "09:25" });
  });

  it("runs the 16:15 daily refresh then alternates it with baseline rebuild batches", () => {
    const exact = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T08:15:00.000Z"),
      checkpoints: [],
    });
    expect(exact).toContainEqual({ type: "daily-new-high-refresh" });

    const partialRefresh: JobCheckpoint = {
      ...checkpoint("daily-new-high-refresh", "2026-07-24T16:15:00+08:00"),
      nextRetryAt: "2026-07-24T08:20:00.000Z",
    };
    const rebuildTick = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T08:20:00.000Z"),
      checkpoints: [
        partialRefresh,
        checkpoint("new-high-bootstrap", "2026-07-24T08:30:00+08:00"),
        checkpoint("history-contribution-bootstrap", "2026-07-24T02:00:00+08:00"),
      ],
    });
    const refreshTick = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T08:25:00.000Z"),
      checkpoints: [
        partialRefresh,
        checkpoint("new-high-bootstrap", "2026-07-24T08:30:00+08:00"),
        checkpoint("history-contribution-bootstrap", "2026-07-24T02:00:00+08:00"),
      ],
    });

    expect(rebuildTick).toContainEqual({ type: "new-high-bootstrap" });
    expect(rebuildTick).not.toContainEqual({ type: "daily-new-high-refresh" });
    expect(refreshTick).toContainEqual({ type: "daily-new-high-refresh" });
    expect(refreshTick).not.toContainEqual({ type: "new-high-bootstrap" });
  });

  it("rotates continuous background work while a close retry remains due", () => {
    const checkpoints = [
      checkpoint("close-review", "2026-07-24T16:10:00+08:00"),
      completedCheckpoint("daily-new-high-refresh", "2026-07-24T16:15:00+08:00"),
      checkpoint("etf-metrics-refresh", "2026-07-24T15:30:00+08:00"),
      checkpoint("new-high-bootstrap", "2026-07-24T08:30:00+08:00"),
      checkpoint("history-contribution-bootstrap", "2026-07-24T02:00:00+08:00"),
    ];

    const first = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T08:20:00.000Z"),
      checkpoints,
    });
    const second = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T08:25:00.000Z"),
      checkpoints,
    });
    const third = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T08:30:00.000Z"),
      checkpoints,
    });

    expect(first.some((job) => job.type === "close-review")).toBe(true);
    expect(second.some((job) => job.type === "close-review")).toBe(true);
    expect(third.some((job) => job.type === "close-review")).toBe(true);
    expect(new Set([
      ...first.map((job) => job.type),
      ...second.map((job) => job.type),
      ...third.map((job) => job.type),
    ])).toEqual(new Set([
      "close-review",
      "etf-metrics-refresh",
      "new-high-bootstrap",
      "history-contribution-bootstrap",
    ]));
  });

  it("fairly rotates three due background jobs when no critical job is due", () => {
    const completed = (key: DailyJobKey, expectedAt: string): JobCheckpoint => ({
      ...checkpoint(key, expectedAt),
      status: "complete",
    });
    const checkpoints = [
      checkpoint("etf-metrics-refresh", "2026-07-24T15:30:00+08:00"),
      checkpoint("new-high-bootstrap", "2026-07-24T08:30:00+08:00"),
      checkpoint("history-contribution-bootstrap", "2026-07-24T02:00:00+08:00"),
      completed("tier1-rss-prefetch", "2026-07-24T06:50:00+08:00"),
      completed("tier2-news-prefetch", "2026-07-24T06:55:00+08:00"),
      completed("morning-brief", "2026-07-24T07:15:00+08:00"),
      completed("breadth-09:25", "2026-07-24T09:25:00+08:00"),
      completed("breadth-10:00", "2026-07-24T10:00:00+08:00"),
      completed("breadth-11:00", "2026-07-24T11:00:00+08:00"),
      completed("breadth-13:00", "2026-07-24T13:00:00+08:00"),
      completed("breadth-14:00", "2026-07-24T14:00:00+08:00"),
      completed("breadth-15:00", "2026-07-24T15:00:00+08:00"),
      completed("close-review", "2026-07-24T16:10:00+08:00"),
      completed("daily-new-high-refresh", "2026-07-24T16:15:00+08:00"),
    ];
    const selected = [20, 25, 30].map((minute) => planRemoteSchedulerJobs({
      now: new Date(`2026-07-24T08:${minute}:00.000Z`),
      checkpoints,
    }).at(0)?.type);

    expect(new Set(selected)).toEqual(new Set([
      "etf-metrics-refresh",
      "new-high-bootstrap",
      "history-contribution-bootstrap",
    ]));
  });

  it("continues ETF history metrics after the daily ETF snapshot is complete", () => {
    const main: JobCheckpoint = {
      ...checkpoint("etf-metrics-refresh", "2026-07-24T15:30:00+08:00"),
      status: "complete",
    };
    const historyMetrics: JobCheckpoint = {
      ...main,
      stage: "history-metrics",
      status: "partial",
      nextRetryAt: "2026-07-24T08:15:00.000Z",
    };
    const newHighComplete: JobCheckpoint = {
      ...checkpoint("new-high-bootstrap", "2026-07-24T08:30:00+08:00"),
      status: "complete",
    };
    const contributionComplete: JobCheckpoint = {
      ...checkpoint("history-contribution-bootstrap", "2026-07-24T02:00:00+08:00"),
      status: "complete",
    };
    const jobs = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T08:17:00.000Z"),
      checkpoints: [
        main,
        historyMetrics,
        newHighComplete,
        contributionComplete,
        completedCheckpoint("daily-new-high-refresh", "2026-07-24T16:15:00+08:00"),
      ],
    });

    expect(jobs).toContainEqual({ type: "etf-metrics-refresh" });
  });

  it("persists the scheduler heartbeat independently of job completion", async () => {
    const writes: unknown[][] = [];
    const db = {
      prepare(sql: string) {
        expect(sql).toContain("bootstrap_state");
        return {
          bind(...values: unknown[]) {
            writes.push(values);
            return this;
          },
          async run() { return {}; },
        };
      },
    } as unknown as D1Database;

    await recordSchedulerHeartbeat(db, {
      receivedAt: "2026-07-24T08:20:00.000Z",
      status: "complete",
      message: "close-review,new-high-bootstrap",
    });

    expect(writes).toEqual([[
      "scheduler-heartbeat",
      JSON.stringify({
        receivedAt: "2026-07-24T08:20:00.000Z",
        status: "complete",
        message: "close-review,new-high-bootstrap",
      }),
      "2026-07-24T08:20:00.000Z",
    ]]);
  });

  it("runs the due morning brief and one background batch on weekends without market-session jobs", () => {
    const jobs = planRemoteSchedulerJobs({
      now: new Date("2026-07-25T00:17:00.000Z"),
      checkpoints: [],
    });

    expect(jobs).toEqual([
      { type: "morning-brief" },
      { type: "history-contribution-bootstrap" },
    ]);
    expect(jobs.some((job) => (
      job.type === "breadth"
      || job.type === "etf-metrics-refresh"
      || job.type === "close-review"
    ))).toBe(false);
  });

  it("keeps exact background slots on weekends while suppressing market-session jobs", () => {
    const saturdayNewHigh = planRemoteSchedulerJobs({
      now: new Date("2026-07-25T10:00:00.000Z"),
      checkpoints: [],
    });
    const saturdayContribution = planRemoteSchedulerJobs({
      now: new Date("2026-07-25T10:15:00.000Z"),
      checkpoints: [],
    });
    const saturdayBreadth = planRemoteSchedulerJobs({
      now: new Date("2026-07-25T01:25:00.000Z"),
      checkpoints: [],
    });

    expect(saturdayNewHigh).toContainEqual({ type: "new-high-bootstrap" });
    expect(saturdayContribution).toContainEqual({ type: "history-contribution-bootstrap" });
    expect(saturdayBreadth).not.toContainEqual({ type: "breadth", time: "09:25" });
  });

  it("can recover a missing morning brief later the same trading day", () => {
    const jobs = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T07:25:00.000Z"),
      checkpoints: [],
    });

    expect(jobs.some((job) => job.type === "morning-brief")).toBe(true);
  });

  it("executes the same fair queue for a native Worker cron and records its heartbeat", async () => {
    const writes: unknown[][] = [];
    const executed: string[] = [];
    const db = {
      prepare() {
        return {
          bind(...values: unknown[]) {
            writes.push(values);
            return this;
          },
          async run() { return {}; },
        };
      },
    } as unknown as D1Database;

    const result = await executeRemoteSchedulerTick({
      db,
      now: new Date("2026-07-25T00:17:00.000Z"),
      loadCheckpoints: async () => [],
      runJob: async (job) => {
        executed.push(job.type);
        return { ok: true, message: "advanced" };
      },
    });

    expect(executed).toEqual(["morning-brief", "history-contribution-bootstrap"]);
    expect(result.jobs).toEqual([
      {
        job: "morning-brief",
        trigger: "reconcile",
        ok: true,
        status: "complete",
        critical: true,
        message: "advanced",
      },
      {
        job: "history-contribution-bootstrap",
        trigger: "reconcile",
        ok: true,
        status: "complete",
        critical: false,
        message: "advanced",
      },
    ]);
    expect(writes.some((values) => String(values[1]).includes("scheduler tick started"))).toBe(true);
    expect(writes.some((values) => String(values[1]).includes("history-contribution-bootstrap:complete"))).toBe(true);
  });

  it("marks an on-slot scheduled job as cron and passes its planned time", async () => {
    const contexts: Array<{ trigger: string; scheduledAt: string }> = [];
    const db = {
      prepare() {
        return {
          bind() { return this; },
          async run() { return {}; },
        };
      },
    } as unknown as D1Database;

    const result = await executeRemoteSchedulerTick({
      db,
      now: new Date("2026-07-23T22:50:00.000Z"),
      loadCheckpoints: async () => [],
      runJob: async (_job, context) => {
        contexts.push(context);
        return { ok: true, message: "done" };
      },
    });

    expect(result.jobs[0]).toMatchObject({
      job: "tier1-rss-prefetch",
      trigger: "cron",
    });
    expect(contexts[0]).toEqual({
      trigger: "cron",
      scheduledAt: "2026-07-24T06:50:00+08:00",
    });
  });
});
