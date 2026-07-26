import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import { DailyJobHealthPanel } from "../app/components/data/DailyJobHealth";

describe("daily job health panel", () => {
  it("shows exact breadth coverage, close stage, new-high progress and morning timing", () => {
    const html = renderToStaticMarkup(React.createElement(DailyJobHealthPanel, {
      health: {
        tradeDate: "2026-07-24",
        generatedAt: "2026-07-24T02:12:00Z",
        jobs: {
          "morning-brief": {
            status: "complete", expectedAt: "2026-07-24T07:15:00+08:00",
            finishedAt: "2026-07-24T00:22:00Z", nextRetryAt: null, message: "", attempt: 1, overdue: false,
          },
          "breadth-09:25": {
            status: "complete", expectedAt: "2026-07-24T09:25:00+08:00",
            finishedAt: "2026-07-24T01:26:00Z", nextRetryAt: null, message: "", attempt: 1, overdue: false,
          },
          "breadth-10:00": {
            status: "failed", expectedAt: "2026-07-24T10:00:00+08:00",
            finishedAt: null, nextRetryAt: "2026-07-24T02:15:00Z", message: "timeout", attempt: 2, overdue: true,
          },
          "close-review": {
            status: "pending", expectedAt: "2026-07-24T16:10:00+08:00",
            finishedAt: null, nextRetryAt: null, message: "等待计划时间", attempt: 0, overdue: false,
          },
          "new-high-bootstrap": {
            status: "partial", expectedAt: "2026-07-24T02:00:00+08:00",
            finishedAt: "2026-07-24T02:05:00Z", nextRetryAt: "2026-07-24T02:20:00Z", message: "124/5317", attempt: 4, overdue: true,
          },
        },
      },
      newHighProgress: { targetDate: "2026-07-23", completed: 124, target: 5317, failed: 26, remaining: 5193, coveragePct: 2.33, minimumTarget: 5000, universeComplete: true, ready: false, complete: false, updatedAt: null },
    }));

    expect(html).toContain(">盘中快照<");
    expect(html).toContain(">1/6<");
    expect(html).toContain("收盘复盘");
    expect(html).toContain("124/5317");
    expect(html).toContain("早参");
  });

  it("labels a late forced rerun as regenerated instead of a scheduler delay", () => {
    const html = renderToStaticMarkup(React.createElement(DailyJobHealthPanel, {
      health: {
        tradeDate: "2026-07-26",
        generatedAt: "2026-07-26T08:30:00Z",
        marketSession: false,
        jobs: {
          "morning-brief": {
            status: "complete", expectedAt: "2026-07-26T07:15:00+08:00",
            finishedAt: "2026-07-26T08:19:00Z", nextRetryAt: null,
            message: "早参已重新生成", attempt: 2, overdue: false,
          },
        },
      },
      newHighProgress: { targetDate: "2026-07-24", completed: 2560, target: 5317, failed: 0, remaining: 2757, coveragePct: 48.15, minimumTarget: 5000, universeComplete: true, ready: false, complete: false, updatedAt: null },
    }));

    expect(html).toContain("重新生成");
    expect(html).not.toContain("· 延迟");
    expect(html).toContain("非交易日");
  });
});
