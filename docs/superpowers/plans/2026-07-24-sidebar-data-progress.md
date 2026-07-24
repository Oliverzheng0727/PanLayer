# Sidebar Data Progress Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the PanLayer sidebar data-status card into a compact progress overview that expands to show truthful per-task details.

**Architecture:** Add one pure presentation-model builder that derives due-task totals and grouped task details from `DailyJobHealth` plus `NewHighProgress`. Render that model in a client component with local expand/collapse state, then replace the existing static sidebar card without changing the dashboard layout or data APIs.

**Tech Stack:** React 19 client components, TypeScript, Tailwind CSS, Vitest, React server rendering, Vinext/Sites.

## Global Constraints

- Preserve the existing dark sidebar structure and width.
- Use only `DailyJobHealth`, `NewHighProgress`, the persisted review status, source and timestamp; never invent progress.
- Exclude the continuous `new-high-bootstrap` and `history-backfill` jobs from the daily completion denominator.
- Count only one-shot jobs whose `expectedAt` is at or before `health.generatedAt`.
- Keep new-high initialization as a separate stock-count progress indicator.
- Default to a compact card; expose full details through an accessible expand/collapse button.
- Keep the expanded task area height-bounded and internally scrollable.
- Preserve the account and sign-out controls below the card.

---

## File Structure

- Create `lib/jobs/sidebar-progress.ts`: pure conversion from backend health data to the sidebar view model.
- Create `app/components/data/SidebarDataProgressCard.tsx`: compact and expandable sidebar card.
- Modify `app/components/Dashboard.tsx`: replace the existing static data-status markup with the new component.
- Create `tests/sidebar-progress.test.ts`: calculation and status precedence tests.
- Create `tests/sidebar-data-progress-card.test.ts`: rendered contract and accessibility tests.
- Modify `tests/rendered-html.test.mjs`: verify the dashboard contains the new compact status entry.

### Task 1: Build the sidebar progress presentation model

**Files:**
- Create: `lib/jobs/sidebar-progress.ts`
- Create: `tests/sidebar-progress.test.ts`

**Interfaces:**
- Consumes: `DailyJobHealth`, `NewHighProgress`, and `DailyReview["status"]`.
- Produces:

```ts
export type SidebarProgressStatus =
  | "pending"
  | "running"
  | "partial"
  | "complete"
  | "failed";

export interface SidebarProgressTask {
  key: "breadth" | "close-review" | "new-high" | "morning-brief" | "etf";
  label: string;
  status: SidebarProgressStatus;
  value: string;
  detail: string;
  updatedAt: string | null;
}

export interface SidebarProgressModel {
  completedDue: number;
  dueTotal: number;
  percentage: number;
  overallStatus: SidebarProgressStatus;
  breadthCompleted: number;
  breadthExpected: 6;
  newHighCompleted: number;
  newHighTarget: number;
  newHighCoveragePct: number;
  tasks: SidebarProgressTask[];
}

export function buildSidebarProgress(
  health: DailyJobHealth,
  newHighProgress: NewHighProgress,
  reviewStatus: DailyReview["status"],
): SidebarProgressModel;
```

- [ ] **Step 1: Write failing calculation tests**

Create `tests/sidebar-progress.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSidebarProgress } from "../lib/jobs/sidebar-progress";
import type { DailyJobHealth } from "../lib/data/repository";

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
    const result = buildSidebarProgress(health, {
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
    }, "partial");

    expect(result.completedDue).toBe(2);
    expect(result.dueTotal).toBe(3);
    expect(result.percentage).toBe(67);
    expect(result.breadthCompleted).toBe(1);
    expect(result.newHighCoveragePct).toBe(2.33);
  });

  it("gives failure and running states precedence over partial review status", () => {
    const base: DailyJobHealth = {
      tradeDate: "2026-07-24",
      generatedAt: "2026-07-24T08:30:00Z",
      jobs: {
        "close-review": job("running", "2026-07-24T16:10:00+08:00"),
      },
    };
    expect(buildSidebarProgress(base, {
      targetDate: "2026-07-23", completed: 5317, target: 5317, failed: 0,
      remaining: 0, coveragePct: 100, minimumTarget: 5000,
      universeComplete: true, ready: true, complete: true, updatedAt: null,
    }, "partial").overallStatus).toBe("running");

    base.jobs["close-review"] = job("failed", "2026-07-24T16:10:00+08:00", "provider timeout");
    expect(buildSidebarProgress(base, {
      targetDate: "2026-07-23", completed: 5317, target: 5317, failed: 0,
      remaining: 0, coveragePct: 100, minimumTarget: 5000,
      universeComplete: true, ready: true, complete: true, updatedAt: null,
    }, "partial").overallStatus).toBe("failed");
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npx vitest run tests/sidebar-progress.test.ts
```

Expected: FAIL because `lib/jobs/sidebar-progress.ts` does not exist.

- [ ] **Step 3: Implement the pure model builder**

Create `lib/jobs/sidebar-progress.ts` with:

```ts
import type { DailyJobHealth } from "../data/repository";
import type { DailyReview } from "../domain/types";
import type { NewHighProgress } from "../history/new-high-progress";

export type SidebarProgressStatus = "pending" | "running" | "partial" | "complete" | "failed";

export interface SidebarProgressTask {
  key: "breadth" | "close-review" | "new-high" | "morning-brief" | "etf";
  label: string;
  status: SidebarProgressStatus;
  value: string;
  detail: string;
  updatedAt: string | null;
}

export interface SidebarProgressModel {
  completedDue: number;
  dueTotal: number;
  percentage: number;
  overallStatus: SidebarProgressStatus;
  breadthCompleted: number;
  breadthExpected: 6;
  newHighCompleted: number;
  newHighTarget: number;
  newHighCoveragePct: number;
  tasks: SidebarProgressTask[];
}

const CONTINUOUS_KEYS = new Set(["new-high-bootstrap", "history-backfill"]);

function displayStatus(status: string | undefined): SidebarProgressStatus {
  return status === "running" || status === "partial" || status === "complete" || status === "failed"
    ? status
    : "pending";
}

export function buildSidebarProgress(
  health: DailyJobHealth,
  newHighProgress: NewHighProgress,
  reviewStatus: DailyReview["status"],
): SidebarProgressModel {
  const now = new Date(health.generatedAt).getTime();
  const dueJobs = Object.entries(health.jobs).filter(([key, item]) =>
    !CONTINUOUS_KEYS.has(key) && new Date(item.expectedAt).getTime() <= now
  );
  const completedDue = dueJobs.filter(([, item]) => item.status === "complete").length;
  const breadth = Object.entries(health.jobs).filter(([key]) => key.startsWith("breadth-"));
  const breadthCompleted = breadth.filter(([, item]) => item.status === "complete").length;
  const failed = dueJobs.some(([, item]) => item.status === "failed");
  const running = dueJobs.some(([, item]) => item.status === "running");
  const partial = dueJobs.some(([, item]) => item.status === "partial" || item.overdue);
  const overallStatus: SidebarProgressStatus = failed || reviewStatus === "failed"
    ? "failed"
    : running
      ? "running"
      : partial || reviewStatus === "partial" || reviewStatus === "demo"
        ? "partial"
        : dueJobs.length > 0 && completedDue === dueJobs.length
          ? "complete"
          : "pending";
  const close = health.jobs["close-review"];
  const closeStages = Object.entries(health.stages ?? {}).filter(([key]) => key.startsWith("close-review:"));
  const closeStagesComplete = closeStages.filter(([, item]) => item.status === "complete").length;
  const brief = health.jobs["morning-brief"];
  const etf = health.jobs["etf-metrics-refresh"];

  return {
    completedDue,
    dueTotal: dueJobs.length,
    percentage: dueJobs.length === 0 ? 0 : Math.round(completedDue / dueJobs.length * 100),
    overallStatus,
    breadthCompleted,
    breadthExpected: 6,
    newHighCompleted: newHighProgress.completed,
    newHighTarget: newHighProgress.target,
    newHighCoveragePct: newHighProgress.coveragePct,
    tasks: [
      {
        key: "breadth", label: "盘中快照",
        status: breadthCompleted === 6 ? "complete" : breadth.some(([, item]) => item.status === "failed") ? "failed" : "partial",
        value: `${breadthCompleted}/6`,
        detail: breadthCompleted === 6 ? "六个节点完整" : "缺失节点将按有效窗口补跑",
        updatedAt: breadth.map(([, item]) => item.finishedAt).filter(Boolean).sort().at(-1) ?? null,
      },
      {
        key: "close-review", label: "收盘复盘", status: displayStatus(close?.status),
        value: closeStages.length ? `${closeStagesComplete}/${closeStages.length}` : "—",
        detail: close?.message || "等待 16:10",
        updatedAt: close?.finishedAt ?? null,
      },
      {
        key: "new-high", label: "新高初始化",
        status: newHighProgress.complete ? "complete" : newHighProgress.failed ? "partial" : "running",
        value: `${newHighProgress.completed}/${newHighProgress.target}`,
        detail: `覆盖 ${newHighProgress.coveragePct.toFixed(2)}%${newHighProgress.failed ? ` · 失败 ${newHighProgress.failed}` : ""}`,
        updatedAt: newHighProgress.updatedAt,
      },
      {
        key: "morning-brief", label: "盘前早参", status: displayStatus(brief?.status),
        value: brief?.status === "complete" ? "完成" : brief?.status === "failed" ? "失败" : "等待",
        detail: brief?.message || "等待 07:15",
        updatedAt: brief?.finishedAt ?? null,
      },
      {
        key: "etf", label: "ETF 指标", status: displayStatus(etf?.status),
        value: etf?.status === "complete" ? "完成" : etf?.status === "failed" ? "失败" : "等待",
        detail: etf?.message || "等待 15:30",
        updatedAt: etf?.finishedAt ?? null,
      },
    ],
  };
}
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run:

```bash
npx vitest run tests/sidebar-progress.test.ts
```

Expected: `2 passed`.

- [ ] **Step 5: Commit Task 1**

```bash
git add lib/jobs/sidebar-progress.ts tests/sidebar-progress.test.ts
git commit -m "feat: derive sidebar data progress"
```

### Task 2: Build the compact expandable card

**Files:**
- Create: `app/components/data/SidebarDataProgressCard.tsx`
- Create: `tests/sidebar-data-progress-card.test.ts`

**Interfaces:**
- Consumes:

```ts
interface SidebarDataProgressCardProps {
  health: DailyJobHealth;
  newHighProgress: NewHighProgress;
  reviewStatus: DailyReview["status"];
  source: string;
  updatedAt: string;
}
```

- Produces: an accessible client component named `SidebarDataProgressCard`.

- [ ] **Step 1: Write the failing rendered-contract test**

Create `tests/sidebar-data-progress-card.test.ts`:

```ts
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
        jobs: {
          "morning-brief": {
            status: "complete", expectedAt: "2026-07-24T07:15:00+08:00",
            finishedAt: "2026-07-24T00:22:00Z", nextRetryAt: null,
            message: "", attempt: 1, overdue: false,
          },
          "breadth-09:25": {
            status: "complete", expectedAt: "2026-07-24T09:25:00+08:00",
            finishedAt: "2026-07-24T01:26:00Z", nextRetryAt: null,
            message: "", attempt: 1, overdue: false,
          },
          "close-review": {
            status: "pending", expectedAt: "2026-07-24T16:10:00+08:00",
            finishedAt: null, nextRetryAt: null,
            message: "等待计划时间", attempt: 0, overdue: false,
          },
        },
      },
      newHighProgress: {
        targetDate: "2026-07-23", completed: 124, target: 5317, failed: 26,
        remaining: 5193, coveragePct: 2.33, minimumTarget: 5000,
        universeComplete: true, ready: false, complete: false, updatedAt: null,
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
    expect(html).toContain("收盘复盘");
    expect(html).toContain("ETF 指标");
  });
});
```

- [ ] **Step 2: Run the component test and verify RED**

Run:

```bash
npx vitest run tests/sidebar-data-progress-card.test.ts
```

Expected: FAIL because `SidebarDataProgressCard` does not exist.

- [ ] **Step 3: Implement the client component**

Create `app/components/data/SidebarDataProgressCard.tsx`:

```tsx
"use client";

import { ChevronDown, Database } from "lucide-react";
import { useMemo, useState } from "react";
import type { DailyJobHealth } from "../../../lib/data/repository";
import type { DailyReview } from "../../../lib/domain/types";
import type { NewHighProgress } from "../../../lib/history/new-high-progress";
import { buildSidebarProgress, type SidebarProgressStatus } from "../../../lib/jobs/sidebar-progress";
import { formatBeijingDateTime } from "../../../lib/live/market-clock";

const views: Record<SidebarProgressStatus, { label: string; dot: string; text: string }> = {
  pending: { label: "等待", dot: "bg-white/35", text: "text-white/45" },
  running: { label: "更新中", dot: "bg-sky-400 animate-pulse", text: "text-sky-300" },
  partial: { label: "部分", dot: "bg-amber-400", text: "text-amber-300" },
  complete: { label: "完整", dot: "bg-emerald-400", text: "text-emerald-300" },
  failed: { label: "失败", dot: "bg-red-400", text: "text-red-300" },
};

export function SidebarDataProgressCard(props: {
  health: DailyJobHealth;
  newHighProgress: NewHighProgress;
  reviewStatus: DailyReview["status"];
  source: string;
  updatedAt: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const model = useMemo(
    () => buildSidebarProgress(props.health, props.newHighProgress, props.reviewStatus),
    [props.health, props.newHighProgress, props.reviewStatus],
  );
  const current = views[model.overallStatus];

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-4">
      <button
        type="button"
        className="w-full text-left"
        aria-expanded={expanded}
        aria-controls="sidebar-data-progress-details"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-xs text-white/45">
            <Database size={14} /> 数据状态
          </span>
          <ChevronDown size={14} className={`text-white/35 transition ${expanded ? "rotate-180" : ""}`} />
        </span>
        <span className="mt-2 flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-2">
            <span className={`size-1.5 rounded-full ${current.dot}`} />
            <strong className={current.text}>{current.label}</strong>
          </span>
          <span className="text-white/50">任务进度 {model.completedDue}/{model.dueTotal}</span>
        </span>
        <span className="mt-2 block h-1 overflow-hidden rounded-full bg-white/[0.07]">
          <span className="block h-full rounded-full bg-[#e8702a] transition-all" style={{ width: `${model.percentage}%` }} />
        </span>
        <span className="mt-2 flex items-center justify-between text-[10px] text-white/35">
          <span>盘中 {model.breadthCompleted}/{model.breadthExpected}</span>
          <span>新高 {model.newHighCompleted}/{model.newHighTarget}</span>
        </span>
      </button>

      <div
        id="sidebar-data-progress-details"
        aria-hidden={!expanded}
        className={`grid transition-all ${expanded ? "mt-3 grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden">
          <div className="max-h-52 space-y-2 overflow-y-auto border-t border-white/[0.06] pt-3">
            {model.tasks.map((task) => {
              const view = views[task.status];
              return (
                <div key={task.key} className="rounded-xl bg-black/20 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="flex items-center gap-1.5 text-white/45">
                      <span className={`size-1 rounded-full ${view.dot}`} />
                      {task.label}
                    </span>
                    <strong className={view.text}>{task.value}</strong>
                  </div>
                  <p className="mt-1 truncate text-[9px] text-white/25" title={task.detail}>{task.detail}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-2 text-[10px] leading-5 text-white/35">数据来源：{props.source}</p>
      <p className="text-[10px] leading-5 text-white/25">更新时间：{formatBeijingDateTime(props.updatedAt)}</p>
    </section>
  );
}
```

- [ ] **Step 4: Run the component test and verify GREEN**

Run:

```bash
npx vitest run tests/sidebar-data-progress-card.test.ts tests/sidebar-progress.test.ts
```

Expected: `2 test files passed`.

- [ ] **Step 5: Commit Task 2**

```bash
git add app/components/data/SidebarDataProgressCard.tsx tests/sidebar-data-progress-card.test.ts
git commit -m "feat: add expandable sidebar progress card"
```

### Task 3: Integrate the card and verify the production build

**Files:**
- Modify: `app/components/Dashboard.tsx`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: `SidebarDataProgressCard` from Task 2.
- Produces: the dashboard sidebar shows the new card using existing props.

- [ ] **Step 1: Add a failing dashboard contract assertion**

In `tests/rendered-html.test.mjs`, extend the dashboard test:

```js
assert.match(html, /任务进度/);
assert.match(html, /aria-controls="sidebar-data-progress-details"/);
```

- [ ] **Step 2: Run the rendered HTML test and verify RED**

Run:

```bash
npm run test:render
```

Expected: FAIL because the dashboard still renders the old static card.

- [ ] **Step 3: Replace the static sidebar card**

In `app/components/Dashboard.tsx`:

```tsx
import { SidebarDataProgressCard } from "./data/SidebarDataProgressCard";
```

Remove `Database` from the `lucide-react` import, then replace:

```tsx
<div className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-4">
  ...
</div>
```

with:

```tsx
<SidebarDataProgressCard
  health={dataHealth}
  newHighProgress={newHighProgress}
  reviewStatus={effectiveStatus}
  source={activeSource}
  updatedAt={activeReceivedAt}
/>
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx vitest run tests/sidebar-progress.test.ts tests/sidebar-data-progress-card.test.ts tests/daily-job-health.test.ts
npm run test:render
```

Expected: all focused tests and all rendered HTML tests pass.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm test
npm run lint
npm run build
git diff --check
```

Expected:

- Vitest reports zero failures.
- ESLint exits `0`.
- Vinext build exits `0`.
- `git diff --check` produces no output.

- [ ] **Step 6: Commit Task 3**

```bash
git add app/components/Dashboard.tsx tests/rendered-html.test.mjs
git commit -m "feat: surface data update progress in sidebar"
```

- [ ] **Step 7: Push and publish**

Push the current `codex/panlayer` branch, package the exact pushed commit with the Sites packaging helper, save one new site version, deploy that saved version to the existing public PanLayer site, and poll until the deployment reaches `succeeded`.

Expected production URL:

```text
https://panlayer-market-review.lihaozheng567.chatgpt.site
```

