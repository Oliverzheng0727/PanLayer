import { describe, expect, it } from "vitest";
import {
  executeRemoteSchedulerTick,
  isValidSchedulerAuthorization,
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

describe("remote scheduler", () => {
  it("accepts only the configured bearer secret", () => {
    expect(isValidSchedulerAuthorization("Bearer scheduler-secret", "scheduler-secret")).toBe(true);
    expect(isValidSchedulerAuthorization("Bearer wrong-secret", "scheduler-secret")).toBe(false);
    expect(isValidSchedulerAuthorization(null, "scheduler-secret")).toBe(false);
    expect(isValidSchedulerAuthorization("Bearer scheduler-secret", "")).toBe(false);
  });

  it("plans the evening new-high batch and outstanding catch-up work", () => {
    const jobs = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T13:15:00.000Z"),
      checkpoints: [],
    });

    expect(jobs.some((job) => job.type === "new-high-bootstrap")).toBe(true);
    expect(jobs.length).toBeLessThanOrEqual(2);
  });

  it("still plans the intended batch when GitHub starts a few minutes late", () => {
    const jobs = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T13:17:00.000Z"),
      checkpoints: [],
    });

    expect(jobs.some((job) => job.type === "new-high-bootstrap")).toBe(true);
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

  it("rotates continuous ETF and new-high work while a close retry remains due", () => {
    const checkpoints = [
      checkpoint("close-review", "2026-07-24T16:10:00+08:00"),
      checkpoint("etf-metrics-refresh", "2026-07-24T15:30:00+08:00"),
      checkpoint("new-high-bootstrap", "2026-07-24T02:00:00+08:00"),
    ];

    const first = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T08:20:00.000Z"),
      checkpoints,
    });
    const second = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T08:25:00.000Z"),
      checkpoints,
    });

    expect(first.some((job) => job.type === "close-review")).toBe(true);
    expect(second.some((job) => job.type === "close-review")).toBe(true);
    expect(new Set([
      ...first.map((job) => job.type),
      ...second.map((job) => job.type),
    ])).toEqual(new Set([
      "close-review",
      "etf-metrics-refresh",
      "new-high-bootstrap",
    ]));
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
      { type: "new-high-bootstrap" },
    ]);
    expect(jobs.some((job) => (
      job.type === "breadth"
      || job.type === "etf-metrics-refresh"
      || job.type === "close-review"
    ))).toBe(false);
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

    expect(executed).toEqual(["morning-brief", "new-high-bootstrap"]);
    expect(result.jobs).toEqual([
      {
        job: "morning-brief",
        ok: true,
        message: "advanced",
      },
      {
        job: "new-high-bootstrap",
        ok: true,
        message: "advanced",
      },
    ]);
    expect(writes.some((values) => String(values[1]).includes("scheduler tick started"))).toBe(true);
    expect(writes.some((values) => String(values[1]).includes("new-high-bootstrap:ok"))).toBe(true);
  });
});
