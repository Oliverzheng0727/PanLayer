import { describe, expect, it } from "vitest";
import {
  briefFetchRuns,
  briefItems,
  briefSources,
  globalMarketSnapshots,
  marketSourceAudits,
  morningBriefSections,
} from "../db/schema";
import { summarizeDataHealth } from "../lib/data/repository";
import { buildDailyJobHealth } from "../lib/data/repository";
import { buildDailyFieldHealth, buildSchedulerHeartbeat, SCHEDULER_HEARTBEAT_STALE_MS } from "../lib/data/repository";
import { demoReview } from "../lib/data/demo";

describe("persisted data health", () => {
  it("exports source-audit, global-snapshot, and brief-section tables", () => {
    expect(marketSourceAudits).toBeDefined();
    expect(globalMarketSnapshots).toBeDefined();
    expect(morningBriefSections).toBeDefined();
    expect(briefSources).toBeDefined();
    expect(briefItems).toBeDefined();
    expect(briefFetchRuns).toBeDefined();
  });

  it("reports domestic, global, macro and AI health independently", () => {
    const result = summarizeDataHealth({
      jobs: [{ job: "morning-brief", status: "complete", trade_date: "2026-07-23", message: "", started_at: "a", finished_at: "b" }],
      audits: [{ source: "东方财富", status: "complete", received_at: "2026-07-23T07:00:00Z", message: "双源一致" }],
      globalPoints: [
        { provider: "Twelve Data", status: "ok", received_at: "2026-07-23T00:00:00Z", message: "" },
        { provider: "FRED", status: "unconfigured", received_at: "2026-07-23T00:00:00Z", message: "未配置 FRED" },
      ],
    });
    expect(result.status).toBe("partial");
    expect(result.domestic.status).toBe("complete");
    expect(result.global.status).toBe("complete");
    expect(result.macro.status).toBe("partial");
    expect(result.ai.status).toBe("complete");
  });

  it("reports tier-1 and tier-2 collection health independently", () => {
    const result = summarizeDataHealth({
      jobs: [],
      audits: [],
      globalPoints: [],
      newsRuns: [
        {
          run_id: "tier2", fetch_date: "2026-07-24", source_tier: 2, transport: "firecrawl",
          status: "complete", source_total: 3, source_success: 3, kept_item_count: 4,
          filtered_item_count: 0, started_at: "2026-07-24T06:55:00+08:00", finished_at: "2026-07-24T06:55:10+08:00",
          error_summary_json: "[]",
        },
        {
          run_id: "tier1", fetch_date: "2026-07-24", source_tier: 1, transport: "rss",
          status: "partial", source_total: 108, source_success: 100, kept_item_count: 300,
          filtered_item_count: 2, started_at: "2026-07-24T06:50:00+08:00", finished_at: "2026-07-24T06:52:00+08:00",
          error_summary_json: "[\"8 sources failed\"]",
        },
      ],
    });

    expect(result.newsCollection).toMatchObject({
      tier1: { status: "partial", fetchDate: "2026-07-24", sourceSuccess: 100, sourceTotal: 108 },
      tier2: { status: "complete", fetchDate: "2026-07-24", sourceSuccess: 3, sourceTotal: 3 },
    });
  });

  it("reports every expected daily job instead of one overall partial badge", () => {
    const result = buildDailyJobHealth({
      tradeDate: "2026-07-24",
      now: new Date("2026-07-24T02:12:00Z"),
      checkpoints: [{
        tradeDate: "2026-07-24",
        key: "breadth-09:25",
        stage: "main",
        status: "complete",
        attempt: 1,
        expectedAt: "2026-07-24T09:25:00+08:00",
        startedAt: "2026-07-24T01:25:00Z",
        finishedAt: "2026-07-24T01:26:00Z",
        nextRetryAt: null,
        message: "captured",
        resultJson: "{}",
      }],
    });

    expect(result.jobs["breadth-09:25"].status).toBe("complete");
    expect(result.jobs["breadth-10:00"].status).toBe("pending");
    expect(result.jobs["close-review"].status).toBe("pending");
  });

  it("uses a validated persisted morning brief when its checkpoint is missing", () => {
    const result = buildDailyJobHealth({
      tradeDate: "2026-07-24",
      now: new Date("2026-07-24T15:20:00Z"),
      checkpoints: [],
      artifacts: {
        morningBrief: {
          valid: true,
          updatedAt: "2026-07-24T06:53:00Z",
        },
      },
    });

    expect(result.jobs["morning-brief"]).toMatchObject({
      status: "complete",
      finishedAt: "2026-07-24T06:53:00Z",
      message: "早参已生成并通过结构校验",
      overdue: false,
    });
  });

  it("does not mark market-session jobs due on weekends while keeping the morning brief due", () => {
    const result = buildDailyJobHealth({
      tradeDate: "2026-07-25",
      now: new Date("2026-07-25T02:00:00Z"),
      checkpoints: [],
    });

    expect(result.jobs["morning-brief"]).toMatchObject({
      status: "pending",
      overdue: true,
    });
    expect(result.jobs["breadth-09:25"]).toBeUndefined();
    expect(result.jobs["etf-metrics-refresh"]).toBeUndefined();
    expect(result.jobs["close-review"]).toBeUndefined();
  });

  it("distinguishes initializing new highs from failed close fields", () => {
    const review = structuredClone(demoReview);
    review.metrics.high20 = null;
    review.metrics.high120 = null;
    review.metrics.allTimeHigh = null;
    review.comparison = {
      brokenCount: null, largeDownCount: null, sealRate: null, yesterdaySuccessRate: null,
      yesterdaySuccessSampleSize: 0, continuation: null, marketAmount: null,
      marketCoveragePct: null, maxBoard: null,
      brokenBoard: { count: null, rate: null, sampleSize: 0, stocks: [] },
      mainSectors: [], cycleLeader: null, recognition: [], indices: [], evidence: {},
    };

    const fields = buildDailyFieldHealth(review, {
      targetDate: review.date,
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
    });

    expect(fields.high120.status).toBe("initializing");
    expect(fields.marketAmount.status).toBe("missing");
  });

  it("keeps the hourly scheduler heartbeat healthy between reconciliation ticks", () => {
    const current = buildSchedulerHeartbeat(
      JSON.stringify({
        receivedAt: "2026-07-24T08:20:00.000Z",
        status: "complete",
        message: "idle",
      }),
      new Date("2026-07-24T08:25:00.000Z"),
    );
    const stale = buildSchedulerHeartbeat(
      JSON.stringify({
        receivedAt: "2026-07-24T08:20:00.000Z",
        status: "complete",
        message: "idle",
      }),
      new Date(new Date("2026-07-24T08:20:00.000Z").getTime() + SCHEDULER_HEARTBEAT_STALE_MS + 1),
    );

    expect(current).toMatchObject({ status: "complete", stale: false });
    expect(stale).toMatchObject({ status: "failed", stale: true });
  });
});
