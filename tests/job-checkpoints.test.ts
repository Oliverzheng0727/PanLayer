import { describe, expect, it } from "vitest";
import {
  buildJobExecutionMetadata,
  expectedDailyJobs,
  isCheckpointRetryable,
  nextRetryAtForCheckpoint,
  readJobExecutionMetadata,
  recordJobCheckpoint,
  reopenDailyNewHighRefreshCheckpoint,
  reopenNewHighBootstrapCheckpoint,
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
      "daily-new-high-refresh",
      "new-high-bootstrap",
      "history-contribution-bootstrap",
    ]));
    expect(expectedDailyJobs("2026-07-24")).toEqual(expect.arrayContaining([
      { key: "new-high-bootstrap", expectedAt: "2026-07-24T08:30:00+08:00" },
      { key: "daily-new-high-refresh", expectedAt: "2026-07-24T16:15:00+08:00" },
      { key: "history-contribution-bootstrap", expectedAt: "2026-07-24T02:00:00+08:00" },
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

  it("keeps healthy continuous partial jobs on a five-minute cadence", () => {
    const now = new Date("2026-07-24T08:00:00.000Z");
    expect(nextRetryAtForCheckpoint(
      "daily-new-high-refresh",
      "partial",
      now,
      20,
    )).toBe("2026-07-24T08:05:00.000Z");
    expect(nextRetryAtForCheckpoint(
      "new-high-bootstrap",
      "partial",
      now,
      20,
    )).toBe("2026-07-24T08:05:00.000Z");
    expect(nextRetryAtForCheckpoint(
      "etf-metrics-refresh",
      "partial",
      now,
      20,
    )).toBe("2026-07-24T08:05:00.000Z");
    expect(nextRetryAtForCheckpoint(
      "history-contribution-bootstrap",
      "partial",
      now,
      20,
    )).toBe("2026-07-24T08:05:00.000Z");
    expect(nextRetryAtForCheckpoint(
      "close-review",
      "failed",
      now,
      3,
    )).toBe("2026-07-24T08:30:00.000Z");
    expect(nextRetryAtForCheckpoint(
      "morning-brief",
      "partial",
      now,
      3,
    )).toBe("2026-07-24T08:05:00.000Z");
  });

  it("aligns background retries to deployed Cloudflare cron ticks", () => {
    expect(nextRetryAtForCheckpoint(
      "daily-new-high-refresh",
      "partial",
      new Date("2026-07-24T11:16:21.000Z"), // 19:16:21 Beijing
      1,
    )).toBe("2026-07-24T11:30:00.000Z"); // 19:30 Beijing

    expect(nextRetryAtForCheckpoint(
      "new-high-bootstrap",
      "partial",
      new Date("2026-07-24T09:05:00.000Z"), // 17:05 Beijing
      1,
    )).toBe("2026-07-24T09:17:00.000Z"); // hourly recovery tick

    expect(nextRetryAtForCheckpoint(
      "daily-new-high-refresh",
      "failed",
      new Date("2026-07-24T11:16:21.000Z"),
      2,
    )).toBe("2026-07-24T11:45:00.000Z");
  });

  it("retries failed breadth captures within the following minute", () => {
    const now = new Date("2026-07-24T01:25:10.000Z");
    expect(nextRetryAtForCheckpoint(
      "breadth-09:25",
      "failed",
      now,
      1,
    )).toBe("2026-07-24T01:25:40.000Z");
    expect(nextRetryAtForCheckpoint(
      "breadth-09:25",
      "failed",
      now,
      2,
    )).toBe("2026-07-24T01:26:10.000Z");
  });

  it("never downgrades an already complete stage during a later partial retry", async () => {
    let sql = "";
    const db = {
      prepare(statement: string) {
        sql = statement;
        return {
          bind() { return this; },
          async run() { return {}; },
        };
      },
    } as unknown as D1Database;

    await recordJobCheckpoint(db, {
      tradeDate: "2026-07-24",
      key: "close-review",
      stage: "indices",
      status: "partial",
      attempt: 2,
      expectedAt: "2026-07-24T16:10:00+08:00",
      startedAt: "2026-07-24T08:10:00.000Z",
      finishedAt: "2026-07-24T08:11:00.000Z",
      nextRetryAt: "2026-07-24T08:16:00.000Z",
      message: "one source timed out",
      resultJson: "{}",
    });

    expect(sql).toContain("job_checkpoints.status = 'complete'");
    expect(sql).toContain("excluded.status <> 'complete'");
  });

  it("explicitly reopens a completed new-high bootstrap when daily refresh queues rebuilds", async () => {
    const row = {
      tradeDate: "2026-07-24",
      key: "new-high-bootstrap",
      stage: "main",
      status: "complete",
      nextRetryAt: null as string | null,
      message: "baseline complete",
    };
    let sql = "";
    const db = {
      prepare(statement: string) {
        sql = statement;
        return {
          values: [] as unknown[],
          bind(...values: unknown[]) {
            this.values = values;
            return this;
          },
          async run() {
            const [nextRetryAt, message, , tradeDate] = this.values as string[];
            if (
              row.tradeDate === tradeDate
              && row.key === "new-high-bootstrap"
              && row.stage === "main"
              && row.status === "complete"
            ) {
              row.status = "partial";
              row.nextRetryAt = nextRetryAt;
              row.message = message;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          },
        };
      },
    } as unknown as D1Database;

    const reopened = await reopenNewHighBootstrapCheckpoint(db, {
      tradeDate: "2026-07-24",
      nextRetryAt: "2026-07-24T08:20:00.000Z",
      message: "daily refresh queued 200 states for baseline rebuild",
    });

    expect(reopened).toBe(true);
    expect(row.status).toBe("partial");
    expect(row.nextRetryAt).toBe("2026-07-24T08:20:00.000Z");
    expect(row.message).toContain("200 states");
    expect(sql).toContain("job_key = 'new-high-bootstrap'");
    expect(sql).toContain("stage = 'main'");
    expect(sql).toContain("status = 'complete'");
  });

  it("reopens a completed daily refresh after the close target advances", async () => {
    const row = {
      tradeDate: "2026-07-24",
      key: "daily-new-high-refresh",
      stage: "main",
      status: "complete",
      nextRetryAt: null as string | null,
      message: "yesterday complete",
    };
    const db = {
      prepare() {
        return {
          values: [] as unknown[],
          bind(...values: unknown[]) {
            this.values = values;
            return this;
          },
          async run() {
            const [nextRetryAt, message, , tradeDate] = this.values as string[];
            if (row.tradeDate === tradeDate && row.status === "complete") {
              row.status = "partial";
              row.nextRetryAt = nextRetryAt;
              row.message = message;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          },
        };
      },
    } as unknown as D1Database;

    await expect(reopenDailyNewHighRefreshCheckpoint(db, {
      tradeDate: row.tradeDate,
      nextRetryAt: "2026-07-24T08:25:00.000Z",
      message: "daily refresh 200/5326",
    })).resolves.toBe(true);
    expect(row.status).toBe("partial");
    expect(row.nextRetryAt).toBe("2026-07-24T08:25:00.000Z");
    expect(row.message).toContain("200/5326");
  });

  it("keeps automatic completion separate from later manual reruns", () => {
    const automatic = buildJobExecutionMetadata({
      trigger: "cron",
      scheduledAt: "2026-07-24T07:15:00+08:00",
      startedAt: "2026-07-23T23:15:00.000Z",
      finishedAt: "2026-07-23T23:16:00.000Z",
      completed: true,
    });
    const manual = buildJobExecutionMetadata({
      previous: automatic,
      trigger: "manual",
      scheduledAt: "2026-07-24T07:15:00+08:00",
      startedAt: "2026-07-24T10:19:00.000Z",
      finishedAt: "2026-07-24T10:20:00.000Z",
      completed: false,
    });

    expect(manual.firstAutomaticCompletedAt).toBe("2026-07-23T23:16:00.000Z");
    expect(manual.lastAutomaticCompletedAt).toBe("2026-07-23T23:16:00.000Z");
    expect(manual.lastManualCompletedAt).toBe("2026-07-24T10:20:00.000Z");
    expect(readJobExecutionMetadata(JSON.stringify({ execution: manual }))).toEqual(manual);
  });
});
