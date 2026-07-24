import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidebarDataProgressCard } from "../app/components/data/SidebarDataProgressCard";

describe("sidebar data progress card", () => {
  it("renders a compact overview and accessible expandable details", () => {
    const html = renderToStaticMarkup(React.createElement(SidebarDataProgressCard, {
      health: {
        tradeDate: "2026-07-24",
        generatedAt: "2026-07-24T02:12:00Z",
        heartbeat: {
          receivedAt: "2026-07-24T02:10:00Z",
          status: "complete",
          message: "idle",
          stale: false,
        },
        jobs: {
          "morning-brief": {
            status: "complete",
            expectedAt: "2026-07-24T07:15:00+08:00",
            finishedAt: "2026-07-24T00:22:00Z",
            nextRetryAt: null,
            message: "",
            attempt: 1,
            overdue: false,
          },
          "breadth-09:25": {
            status: "complete",
            expectedAt: "2026-07-24T09:25:00+08:00",
            finishedAt: "2026-07-24T01:26:00Z",
            nextRetryAt: null,
            message: "",
            attempt: 1,
            overdue: false,
          },
          "close-review": {
            status: "pending",
            expectedAt: "2026-07-24T16:10:00+08:00",
            finishedAt: null,
            nextRetryAt: null,
            message: "等待计划时间",
            attempt: 0,
            overdue: false,
          },
        },
      },
      newHighProgress: {
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
      },
      reviewStatus: "partial",
      source: "东方财富 / 新浪备用",
      updatedAt: "2026-07-24T00:56:31Z",
    }));

    expect(html).toContain("数据状态");
    expect(html).toContain("任务进度");
    expect(html).toContain("盘中 1/6");
    expect(html).toContain("新高 124/5317");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="sidebar-data-progress-details"');
    expect(html).toContain("收盘复盘");
    expect(html).toContain("ETF 指标");
    expect(html).toContain("调度心跳");
    expect(html).toContain("正常");
  });
});
