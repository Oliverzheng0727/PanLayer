# PanLayer Daily Data Reliability Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every scheduled PanLayer market-data and morning-brief update observable, resumable, idempotent, and complete enough that the UI never mistakes a scheduled trigger for a successful update.

**Architecture:** Keep Cloudflare Workers, D1, React, TypeScript, and the existing data-provider adapters. Add a D1-backed job checkpoint layer and a five-minute reconciliation heartbeat, split oversized jobs into resumable stages, and publish field-level freshness/completeness to the existing dashboard. Public data providers remain interchangeable; failed fields stay `null` and are never repaired with stale or AI-generated numbers.

**Tech Stack:** TypeScript 5.9, React 19, Vinext/Next 16, Cloudflare Workers Cron, D1/Drizzle, Vitest, Eastmoney/Tencent/Sina adapters, Qwen + RSS/Firecrawl.

## Global Constraints

- All scheduling, trading dates, market times, and freshness calculations use `Asia/Shanghai`.
- No stock recommendation, trade instruction, position advice, or AI-generated market number.
- Missing or unverified values remain `null` and render as `暂缺`.
- Every write is idempotent on `trade_date + job + stage` or the existing domain key.
- A stale snapshot must be visibly labeled stale and must never be presented as current.
- Existing page layout and navigation remain unchanged; only status, diagnostics, and missing data are repaired.
- Primary source failure retries twice, then uses an existing fallback provider where the field definitions are equivalent.
- Historical data is backfilled only when the underlying historical source can reproduce the stated metric.

---

## File Structure

- Create `lib/jobs/checkpoints.ts`: D1 checkpoint types, expected daily runs, retry eligibility, and freshness calculations.
- Create `lib/jobs/reconcile.ts`: five-minute catch-up planner that decides which missed or partial jobs are safe to rerun.
- Create `lib/jobs/close-review-stages.ts`: independent close-review stages and deterministic merge rules.
- Create `lib/ai/morning-brief-validation.ts`: publication-time source recency and contradiction checks.
- Create `lib/etf/derived-metrics.ts`: 20-day average amount calculation and category normalization.
- Create `app/components/data/DailyJobHealth.tsx`: per-job customer-facing update status.
- Modify `db/schema.ts` and add one generated Drizzle migration for durable checkpoints.
- Modify `lib/jobs/schedule.ts`, `lib/jobs/runner.ts`, `worker/index.ts`, and `vite.config.ts` for reconciliation scheduling.
- Modify `lib/history/new-high-pipeline.ts` and `lib/history/new-high-d1-store.ts` for bounded, retryable symbol batches.
- Modify `lib/data/repository.ts` and `app/api/v1/data-health/route.ts` to return field-level health.
- Modify `lib/etf/live-catalog.ts`, `lib/etf/catalog-repository.ts`, and ETF UI components for derived metrics and provenance.
- Modify `app/components/Dashboard.tsx`, `app/components/history/HistoryTable.tsx`, and `app/components/data/LiveDataStatus.tsx` to expose exact update times and missing stages.

---

### Task 1: Add durable job checkpoints and expected-run definitions

**Files:**
- Modify: `db/schema.ts`
- Create: `lib/jobs/checkpoints.ts`
- Test: `tests/job-checkpoints.test.ts`
- Generate: `drizzle/0008_*.sql`

**Interfaces:**
- Produces: `DailyJobKey`, `JobCheckpoint`, `recordJobCheckpoint()`, `readDailyJobCheckpoints()`, `expectedDailyJobs()`, and `isCheckpointRetryable()`.
- Consumes: `beijingDateParts()` from `lib/jobs/schedule.ts`.

- [ ] **Step 1: Write failing checkpoint tests**

```ts
import { describe, expect, it } from "vitest";
import {
  expectedDailyJobs,
  isCheckpointRetryable,
  type JobCheckpoint,
} from "../lib/jobs/checkpoints";

describe("daily job checkpoints", () => {
  it("declares six breadth nodes and the close and morning jobs", () => {
    const keys = expectedDailyJobs("2026-07-24").map((item) => item.key);
    expect(keys).toEqual(expect.arrayContaining([
      "morning-brief",
      "breadth-09:25",
      "breadth-10:00",
      "breadth-11:00",
      "breadth-13:00",
      "breadth-14:00",
      "breadth-15:00",
      "close-review",
      "new-high-bootstrap",
    ]));
  });

  it("retries failed and stale-running checkpoints but not complete ones", () => {
    const base: JobCheckpoint = {
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
    expect(isCheckpointRetryable(base, new Date("2026-07-24T02:06:00Z"))).toBe(true);
    expect(isCheckpointRetryable({ ...base, status: "complete" }, new Date("2026-07-24T02:06:00Z"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `npx vitest run tests/job-checkpoints.test.ts`

Expected: FAIL because `lib/jobs/checkpoints.ts` does not exist.

- [ ] **Step 3: Add the D1 table**

Add this Drizzle model to `db/schema.ts`:

```ts
export const jobCheckpoints = sqliteTable("job_checkpoints", {
  tradeDate: text("trade_date").notNull(),
  jobKey: text("job_key").notNull(),
  stage: text("stage").notNull().default("main"),
  status: text("status").notNull(),
  attempt: integer("attempt").notNull().default(0),
  expectedAt: text("expected_at").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  nextRetryAt: text("next_retry_at"),
  message: text("message").notNull().default(""),
  resultJson: text("result_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tradeDate, table.jobKey, table.stage] }),
  index("job_checkpoints_due_idx").on(table.tradeDate, table.status, table.nextRetryAt),
]);
```

- [ ] **Step 4: Implement the checkpoint contract**

In `lib/jobs/checkpoints.ts`, define exact status values and Beijing expected times:

```ts
export type DailyJobKey =
  | "tier1-rss-prefetch"
  | "tier2-news-prefetch"
  | "morning-brief"
  | `breadth-${"09:25" | "10:00" | "11:00" | "13:00" | "14:00" | "15:00"}`
  | "close-review"
  | "new-high-bootstrap";

export type CheckpointStatus = "pending" | "running" | "partial" | "complete" | "failed";

export interface JobCheckpoint {
  tradeDate: string;
  key: DailyJobKey;
  stage: string;
  status: CheckpointStatus;
  attempt: number;
  expectedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  nextRetryAt: string | null;
  message: string;
  resultJson: string;
}

const DAILY_TIMES: Array<[DailyJobKey, string]> = [
  ["tier1-rss-prefetch", "06:50"],
  ["tier2-news-prefetch", "06:55"],
  ["morning-brief", "07:15"],
  ["breadth-09:25", "09:25"],
  ["breadth-10:00", "10:00"],
  ["breadth-11:00", "11:00"],
  ["breadth-13:00", "13:00"],
  ["breadth-14:00", "14:00"],
  ["breadth-15:00", "15:00"],
  ["close-review", "16:10"],
];

export function expectedDailyJobs(tradeDate: string) {
  return [
    ...DAILY_TIMES.map(([key, time]) => ({
      key,
      expectedAt: `${tradeDate}T${time}:00+08:00`,
    })),
    { key: "new-high-bootstrap" as const, expectedAt: `${tradeDate}T02:00:00+08:00` },
  ];
}

export function isCheckpointRetryable(checkpoint: JobCheckpoint, now: Date) {
  if (checkpoint.status === "complete") return false;
  if (checkpoint.status === "running" && checkpoint.startedAt) {
    return now.getTime() - new Date(checkpoint.startedAt).getTime() >= 3 * 60_000;
  }
  return !checkpoint.nextRetryAt || new Date(checkpoint.nextRetryAt).getTime() <= now.getTime();
}
```

Implement D1 UPSERTs so status changes update the same checkpoint row rather than append duplicates.

- [ ] **Step 5: Generate the migration and run tests**

Run: `npm run db:generate`

Expected: one new migration containing `CREATE TABLE job_checkpoints`.

Run: `npx vitest run tests/job-checkpoints.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add db/schema.ts drizzle lib/jobs/checkpoints.ts tests/job-checkpoints.test.ts
git commit -m "feat: add durable daily job checkpoints"
```

---

### Task 2: Replace exact-time-only execution with a catch-up reconciler

**Files:**
- Create: `lib/jobs/reconcile.ts`
- Modify: `lib/jobs/schedule.ts`
- Modify: `lib/jobs/runner.ts`
- Modify: `worker/index.ts`
- Modify: `vite.config.ts`
- Test: `tests/job-reconcile.test.ts`
- Test: `tests/scheduler.test.ts`

**Interfaces:**
- Consumes: `expectedDailyJobs()` and checkpoint readers from Task 1.
- Produces: `planCatchUpJobs()` and a new scheduled job `{ type: "daily-reconcile" }`.

- [ ] **Step 1: Write failing reconciliation tests**

```ts
it("catches a missed 10:00 breadth job during its 30-minute window", () => {
  const jobs = planCatchUpJobs({
    tradeDate: "2026-07-24",
    now: new Date("2026-07-24T02:12:00Z"),
    checkpoints: [],
  });
  expect(jobs).toContainEqual({ type: "breadth", time: "10:00" });
});

it("does not fabricate a missed intraday snapshot after its window", () => {
  const jobs = planCatchUpJobs({
    tradeDate: "2026-07-24",
    now: new Date("2026-07-24T07:30:00Z"),
    checkpoints: [],
  });
  expect(jobs).not.toContainEqual({ type: "breadth", time: "10:00" });
});

it("retries an incomplete close review until 18:00 Beijing", () => {
  const jobs = planCatchUpJobs({
    tradeDate: "2026-07-24",
    now: new Date("2026-07-24T09:00:00Z"),
    checkpoints: [],
  });
  expect(jobs).toContainEqual({ type: "close-review" });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/job-reconcile.test.ts tests/scheduler.test.ts`

Expected: FAIL because `planCatchUpJobs()` and `daily-reconcile` do not exist.

- [ ] **Step 3: Implement bounded catch-up windows**

Use these exact windows in `lib/jobs/reconcile.ts`:

```ts
const CATCH_UP_MINUTES: Record<string, number> = {
  "tier1-rss-prefetch": 25,
  "tier2-news-prefetch": 25,
  "morning-brief": 120,
  "breadth-09:25": 20,
  "breadth-10:00": 20,
  "breadth-11:00": 20,
  "breadth-13:00": 20,
  "breadth-14:00": 20,
  "breadth-15:00": 20,
  "close-review": 110,
  "new-high-bootstrap": 24 * 60,
};
```

The reconciler must:

1. Skip weekends and dates not present in the recent trading calendar.
2. Never recreate a missed 10:00 snapshot using 15:00 data.
3. Retry `partial`/`failed` checkpoints with exponential delays of 5, 15, and 30 minutes.
4. Limit one heartbeat to two foreground jobs so Worker runtime remains bounded.
5. Treat new-high bootstrap as continuously resumable rather than all-or-nothing.

- [ ] **Step 4: Add a five-minute heartbeat**

In `vite.config.ts`, add one UTC cron covering the Beijing active window:

```ts
"*/5 22-23,0-10 * * 0-5"
```

In `worker/index.ts`, map that heartbeat to `{ type: "daily-reconcile" }`; the reconciler decides whether a domain job is actually due.

- [ ] **Step 5: Wrap every run with checkpoint transitions**

In `runPanLayerJob()`:

1. UPSERT `running` before data requests.
2. UPSERT `complete` or `partial` with result counts after persistence.
3. UPSERT `failed` with a sanitized error and `next_retry_at`.
4. Preserve the existing `job_runs` history for detailed diagnostics.

- [ ] **Step 6: Run scheduler tests**

Run: `npx vitest run tests/job-reconcile.test.ts tests/scheduler.test.ts tests/runner.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/jobs/reconcile.ts lib/jobs/schedule.ts lib/jobs/runner.ts worker/index.ts vite.config.ts tests/job-reconcile.test.ts tests/scheduler.test.ts tests/runner.test.ts
git commit -m "fix: reconcile missed daily jobs"
```

---

### Task 3: Make new-high initialization make guaranteed forward progress

**Files:**
- Modify: `lib/history/new-high-pipeline.ts`
- Modify: `lib/history/new-high-d1-store.ts`
- Modify: `lib/jobs/runner.ts`
- Test: `tests/new-high-pipeline.test.ts`
- Test: `tests/new-high-d1-store.test.ts`
- Test: `tests/new-high-progress.test.ts`

**Interfaces:**
- Produces: per-symbol bootstrap attempt state and a bounded `runNewHighBootstrapBatch()` result containing `attempted`, `succeeded`, `failed`, `remaining`, and `nextCursor`.
- Consumes: existing `getAdjustedBars(symbol)` provider interface.

- [ ] **Step 1: Add failing progress tests**

```ts
it("does not select a repeatedly failing symbol ahead of untouched symbols", async () => {
  const first = await store.listBootstrapCandidates("2026-07-23", 50);
  await store.recordBootstrapFailure(first[0].symbol, "timeout", "2026-07-24T02:00:00Z");
  const second = await store.listBootstrapCandidates("2026-07-23", 50);
  expect(second.at(-1)?.symbol).toBe(first[0].symbol);
});

it("reports forward progress even when part of a batch fails", async () => {
  const result = await runNewHighBootstrapBatch({
    store,
    provider,
    targetDate: "2026-07-23",
    batchSize: 30,
    concurrency: 3,
  });
  expect(result.attempted).toBe(30);
  expect(result.succeeded).toBeGreaterThan(0);
  expect(result.completed).toBeGreaterThan(124);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/new-high-pipeline.test.ts tests/new-high-d1-store.test.ts`

Expected: FAIL because failure state and `attempted/succeeded` are absent.

- [ ] **Step 3: Persist per-symbol failures**

Add `bootstrap_attempts`, `last_error`, and `next_retry_at` columns to `new_high_states`, or a separate `new_high_bootstrap_failures` table keyed by symbol. Use a separate table so valid high-state rows stay domain-only:

```ts
export const newHighBootstrapFailures = sqliteTable("new_high_bootstrap_failures", {
  symbol: text("symbol").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error").notNull(),
  nextRetryAt: text("next_retry_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
```

On success, delete the failure row. On failure, back off 15 minutes, 1 hour, then 6 hours.

- [ ] **Step 4: Bound each batch**

Change the runtime defaults to:

```ts
batchSize: 40,
concurrency: 3,
retryDelayMs: 300,
```

Stop fetching new symbols after 45 seconds, persist completed symbols immediately, and return a partial result. This prevents a batch of 150 historical K-line requests from exhausting a Worker invocation.

- [ ] **Step 5: Make target-date rollover explicit**

When the target trading date changes:

1. Keep already initialized states.
2. Update states forward using daily quotes when possible.
3. Mark only symbols with missing intermediate bars as `rebuild`.
4. Do not restart all 5,317 symbols.

- [ ] **Step 6: Patch review counts as soon as coverage reaches 95%**

At 95% coverage, compute current-day counts with a `partial` evidence status and the exact coverage. At 100%, mark the fields complete. Do not wait for `remaining === 0` before patching all eligible review dates.

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/new-high-pipeline.test.ts tests/new-high-d1-store.test.ts tests/new-high-progress.test.ts tests/new-high-engine.test.ts`

Expected: PASS, including a simulated batch with intermittent provider failures.

- [ ] **Step 8: Commit**

```bash
git add db/schema.ts drizzle lib/history/new-high-pipeline.ts lib/history/new-high-d1-store.ts lib/jobs/runner.ts tests/new-high-pipeline.test.ts tests/new-high-d1-store.test.ts tests/new-high-progress.test.ts
git commit -m "fix: make new-high bootstrap resumable"
```

---

### Task 4: Guarantee six real intraday breadth snapshots

**Files:**
- Modify: `lib/jobs/runner.ts`
- Modify: `lib/data/repository.ts`
- Modify: `lib/history/overview.ts`
- Modify: `app/components/Dashboard.tsx`
- Test: `tests/breadth-completeness.test.ts`
- Test: `tests/runner.test.ts`

**Interfaces:**
- Produces: `readBreadthCompleteness(date)` returning expected, captured, missing, and late nodes.
- Consumes: existing `breadth_snapshots` rows and source audits.

- [ ] **Step 1: Write failing completeness tests**

```ts
it("reports exact missing breadth nodes", () => {
  expect(breadthCompleteness([
    { time: "09:25", rising: 3000, falling: 2000, flat: 100 },
    { time: "15:00", rising: 3200, falling: 1900, flat: 100 },
  ])).toEqual({
    expected: 6,
    captured: 2,
    missing: ["10:00", "11:00", "13:00", "14:00"],
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/breadth-completeness.test.ts`

Expected: FAIL because the completeness helper does not exist.

- [ ] **Step 3: Persist only observations captured inside the valid window**

For each node, accept market observations from two minutes before through twenty minutes after the scheduled time. Store:

```ts
{
  scheduledTime: "10:00",
  observedMarketTime: "10:07",
  receivedAt: "...",
  lateByMinutes: 7
}
```

Do not insert a synthetic 10:00 row after the window closes.

- [ ] **Step 4: Mark daily breadth completeness in the review**

Extend `DailyReview` with:

```ts
breadthMeta?: {
  expected: number;
  captured: number;
  missing: string[];
  status: "complete" | "partial";
};
```

The close review is breadth-complete only when all six unique nodes exist.

- [ ] **Step 5: Show missing times in the existing market-breadth panel**

Render `已采集 2/6；缺少 10:00、11:00、13:00、14:00` rather than leaving an empty chart with an overall “部分” badge.

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/breadth-completeness.test.ts tests/runner.test.ts tests/history-overview.test.ts tests/dashboard-brief-adapter.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/jobs/runner.ts lib/data/repository.ts lib/history/overview.ts lib/domain/types.ts app/components/Dashboard.tsx tests/breadth-completeness.test.ts tests/runner.test.ts
git commit -m "fix: track all six breadth snapshots"
```

---

### Task 5: Split the 16:10 close review into independently retryable stages

**Files:**
- Create: `lib/jobs/close-review-stages.ts`
- Modify: `lib/jobs/runner.ts`
- Modify: `lib/domain/types.ts`
- Modify: `lib/domain/comparison.ts`
- Test: `tests/close-review-stages.test.ts`
- Test: `tests/comparison-metrics.test.ts`
- Test: `tests/runner.test.ts`

**Interfaces:**
- Produces: `runCloseReviewStage(stage, context)` and `mergeCloseReviewStage(review, result)`.
- Stages: `quotes`, `board-pools`, `aggregate`, `indices`, `new-highs`, `assemble`.

- [ ] **Step 1: Write failing staged-merge tests**

```ts
it("keeps successful board pools when the index stage fails", () => {
  const review = mergeCloseReviewStage(emptyReview("2026-07-24"), {
    stage: "board-pools",
    status: "complete",
    value: poolsFixture,
    source: "东方财富",
    receivedAt: "2026-07-24T08:11:00Z",
  });
  expect(review.metrics.limitUp).toBe(116);
  expect(review.comparison?.indices).toEqual([]);
});

it("a retry fills indices without erasing board-pool metrics", () => {
  const merged = mergeCloseReviewStage(reviewWithPools, indexStageFixture);
  expect(merged.metrics.limitUp).toBe(116);
  expect(merged.comparison?.indices).toHaveLength(5);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/close-review-stages.test.ts`

Expected: FAIL because staged close-review functions do not exist.

- [ ] **Step 3: Implement stage persistence**

Persist each stage result in `job_checkpoints.result_json`. The `assemble` stage reads completed stage payloads and builds one `DailyReview`.

Required stage acceptance:

- `quotes`: at least 5,000 valid securities and at least 95% expected-symbol coverage.
- `board-pools`: limit-up, broken, and limit-down pools received; yesterday pool may be partial but must be stated.
- `aggregate`: all-market amount and large-down count have at least 95% quote coverage.
- `indices`: five named indexes with point, percent, amount, source, market time.
- `new-highs`: state coverage at least 95%; otherwise values remain `null`.

- [ ] **Step 4: Retry only incomplete stages**

At 16:15, 16:30, and 17:00, the reconciler should call only incomplete stages. A successful four-pool result must not be fetched and overwritten merely because indices failed.

- [ ] **Step 5: Calculate close premium from persisted prior-day candidates**

Persist the prior trading day’s second-board-and-above symbols in the review. The next close-review quote stage calculates equal-weight open and close percent only when every effective candidate has valid previous close/open/close data; otherwise return `null` plus sample coverage.

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/close-review-stages.test.ts tests/comparison-metrics.test.ts tests/runner.test.ts tests/market-structure.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/jobs/close-review-stages.ts lib/jobs/runner.ts lib/domain/types.ts lib/domain/comparison.ts tests/close-review-stages.test.ts tests/comparison-metrics.test.ts tests/runner.test.ts
git commit -m "fix: stage and retry close review"
```

---

### Task 6: Make the 07:15 morning brief punctual and internally consistent

**Files:**
- Create: `lib/ai/morning-brief-validation.ts`
- Modify: `lib/ai/morning-brief-assembly.ts`
- Modify: `lib/ai/morning-brief-providers.ts`
- Modify: `lib/jobs/runner.ts`
- Test: `tests/morning-brief-validation.test.ts`
- Test: `tests/morning-brief-runner.test.ts`

**Interfaces:**
- Produces: `validateBriefPublication(brief, sources, generatedAt)`.
- Consumes: existing five-section `MorningBrief` and source metadata.

- [ ] **Step 1: Write failing recency and contradiction tests**

```ts
it("rejects conflicting direction claims for the same index and session", () => {
  const result = validateBriefPublication(conflictingBriefFixture, sources, generatedAt);
  expect(result.status).toBe("failed");
  expect(result.issues[0].code).toBe("direction-conflict");
});

it("marks a brief late when not complete by 07:30 Beijing", () => {
  const result = validateBriefPublication(validBriefFixture, sources, "2026-07-24T00:10:00Z");
  expect(result.timeliness).toBe("late");
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/morning-brief-validation.test.ts`

Expected: FAIL because the validator does not exist.

- [ ] **Step 3: Add deterministic validation rules**

Before publishing:

1. Every important factual paragraph has at least one source ID.
2. Every source URL is HTTP(S), has a title, and has a usable publication/receipt time.
3. News older than 36 hours is excluded unless explicitly labeled background.
4. Directional statements for the same market key and session cannot contain both positive and negative classifications.
5. Numerical market facts present in verified `global_market_snapshots` must match the stored value within rounding tolerance.
6. Failed validation keeps the prior modules unavailable; it does not ask Qwen to invent a correction.

- [ ] **Step 4: Add targeted retries**

At 07:20, 07:30, and 07:45, rerun only missing or failed section keys. The whole brief becomes `complete` only when all five sections pass publication validation.

- [ ] **Step 5: Expose timeliness**

Return:

```ts
{
  expectedAt: "07:15",
  completedAt: "07:22",
  timeliness: "on-time" | "late",
  failedSections: string[],
}
```

The dashboard shows `早参 07:22 完成` or `早参延迟，缺少：国内消息`.

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/morning-brief-validation.test.ts tests/morning-brief-runner.test.ts tests/morning-brief-contract.test.ts tests/brief-ui.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/ai/morning-brief-validation.ts lib/ai/morning-brief-assembly.ts lib/ai/morning-brief-providers.ts lib/jobs/runner.ts tests/morning-brief-validation.test.ts tests/morning-brief-runner.test.ts
git commit -m "fix: validate and retry morning brief"
```

---

### Task 7: Complete ETF provenance, 20-day amount, and category coverage

**Files:**
- Create: `lib/etf/derived-metrics.ts`
- Modify: `lib/etf/live-catalog.ts`
- Modify: `lib/etf/catalog.ts`
- Modify: `lib/etf/catalog-repository.ts`
- Modify: `app/components/etf/EtfWorkspace.tsx`
- Modify: `app/components/etf/EtfTable.tsx`
- Test: `tests/etf-derived-metrics.test.ts`
- Test: `tests/etf-live-catalog.test.ts`
- Test: `tests/etf-catalog.test.ts`

**Interfaces:**
- Produces: `calculateAverageAmount20(bars)` and `normalizeEtfCategory(name, trackingIndex)`.
- Consumes: existing ETF catalog and daily K-line adapters.

- [ ] **Step 1: Write failing derived-metric tests**

```ts
it("calculates the exact 20-session average amount", () => {
  const bars = Array.from({ length: 20 }, (_, index) => ({ time: `${index}`, amount: (index + 1) * 1e8 }));
  expect(calculateAverageAmount20(bars)).toBe(10.5);
});

it("classifies beauty and medical-beauty ETFs", () => {
  expect(normalizeEtfCategory("医美ETF", "中证医美主题指数")).toBe("美容护理");
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/etf-derived-metrics.test.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Compute and persist the 20-day average**

For catalog items missing `averageAmount20`, fetch 20 valid daily bars in bounded background batches and persist the result. Values stay `null` until all 20 sessions are present.

- [ ] **Step 4: Preserve market timestamps**

Parse provider timestamps when available. If Tencent provides quotes but no trustworthy market timestamp, retain `marketTime: null`, show receipt time separately, and keep status `partial`.

- [ ] **Step 5: Expand deterministic categories**

Add exact keyword/index-name rules for:

- 美容护理/医美
- 科技/AI/算力
- 半导体/芯片/存储
- 新能源/电池/光伏/风电
- 汽车/智能汽车
- 医药/医疗/创新药

Do not assign a category using Qwen.

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/etf-derived-metrics.test.ts tests/etf-live-catalog.test.ts tests/etf-catalog.test.ts tests/etf-ui-contract.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/etf/derived-metrics.ts lib/etf/live-catalog.ts lib/etf/catalog.ts lib/etf/catalog-repository.ts app/components/etf/EtfWorkspace.tsx app/components/etf/EtfTable.tsx tests/etf-derived-metrics.test.ts tests/etf-live-catalog.test.ts tests/etf-catalog.test.ts
git commit -m "fix: complete ETF derived data and categories"
```

---

### Task 8: Publish field-level health and honest historical completeness

**Files:**
- Modify: `lib/data/repository.ts`
- Modify: `app/api/v1/data-health/route.ts`
- Create: `app/components/data/DailyJobHealth.tsx`
- Modify: `app/components/data/LiveDataStatus.tsx`
- Modify: `app/components/Dashboard.tsx`
- Modify: `app/components/history/HistoryTable.tsx`
- Test: `tests/repository-health.test.ts`
- Test: `tests/live-data-status.test.ts`
- Test: `tests/history-ui-contract.test.ts`

**Interfaces:**
- Produces: `DailyDataHealth` with per-job and per-field freshness.
- Consumes: checkpoints, audits, reviews, news runs, and new-high progress.

- [ ] **Step 1: Write the failing API-shape test**

```ts
expect(health.daily).toMatchObject({
  tradeDate: "2026-07-24",
  jobs: {
    "breadth-09:25": { status: "complete" },
    "breadth-10:00": { status: "failed" },
    "close-review": { status: "partial" },
  },
  fields: {
    high120: { status: "initializing", value: null },
    marketAmount: { status: "missing", value: null },
  },
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/repository-health.test.ts`

Expected: FAIL because health is currently only grouped as domestic/global/macro/AI.

- [ ] **Step 3: Return exact job health**

Add:

```ts
export interface DailyDataHealth {
  tradeDate: string;
  generatedAt: string;
  jobs: Record<string, {
    status: "pending" | "running" | "partial" | "complete" | "failed";
    expectedAt: string;
    finishedAt: string | null;
    nextRetryAt: string | null;
    message: string;
  }>;
  fields: Record<string, {
    status: "complete" | "partial" | "missing" | "initializing";
    source: string;
    marketTime: string | null;
    receivedAt: string | null;
    message: string;
  }>;
}
```

- [ ] **Step 4: Add one compact dashboard status panel**

Show:

- `盘中快照 4/6`
- `收盘复盘：等待 16:10 / 部分 / 完成`
- `新高初始化 124/5317，下次重试 15:00`
- `早参 07:22 完成（延迟7分钟）`
- `ETF 接收时间 14:54:12，行情时间暂缺`

Do not add another page or change the navigation.

- [ ] **Step 5: Add cell-level historical explanations**

For a missing historical cell, the hover/drawer text must distinguish:

- `当日任务失败，可重跑`
- `历史源不支持全市场回补`
- `新高状态正在初始化`
- `覆盖率不足，未采用`

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/repository-health.test.ts tests/live-data-status.test.ts tests/history-ui-contract.test.ts tests/rendered-html.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/data/repository.ts app/api/v1/data-health/route.ts app/components/data/DailyJobHealth.tsx app/components/data/LiveDataStatus.tsx app/components/Dashboard.tsx app/components/history/HistoryTable.tsx tests/repository-health.test.ts tests/live-data-status.test.ts tests/history-ui-contract.test.ts
git commit -m "feat: expose field-level daily data health"
```

---

### Task 9: Production verification and guarded release

**Files:**
- Modify: `README.md`
- Create: `docs/operations/daily-data-runbook.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: an operator checklist with concrete D1 and API acceptance criteria.

- [ ] **Step 1: Document the operational acceptance checks**

The runbook must require:

1. 07:30 Beijing: five morning sections complete or exact failed keys shown.
2. After every breadth node: the corresponding `breadth_snapshots` row and complete checkpoint exist.
3. 16:30 Beijing: four-pool, aggregate, indices, and assemble stages are complete or retry-scheduled.
4. New-high `completed` increases between consecutive bootstrap runs until at least 95%.
5. No daily-review numeric field is populated from an AI response.

- [ ] **Step 2: Run the complete local verification**

Run:

```bash
npm test
npm run lint
npm run build
npm run test:render
```

Expected: all Vitest suites pass, ESLint exits 0, the production build succeeds, and rendered HTML tests pass.

- [ ] **Step 3: Deploy a saved production version**

Push the exact tested commit, save a Sites version from that commit, then deploy that saved version. Do not deploy an uncommitted working tree.

- [ ] **Step 4: Verify one complete live trading cycle**

Do not call the repair fully accepted until one trading day satisfies:

- Six breadth snapshots captured.
- 16:10 review contains verified board pools, market amount, five indices, leaders, hot sectors, and exact source timestamps.
- New-high coverage reaches at least 95% or the UI clearly reports ongoing initialization.
- Next morning’s five-section brief is complete by 07:30 or automatically retries with explicit diagnostics.
- ETF catalog, K-lines, and 20-day average metrics load without stale values being labeled current.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md docs/operations/daily-data-runbook.md
git commit -m "docs: add daily data operations runbook"
```

---

## Delivery Order and Estimated Effort

1. Tasks 1–2: job checkpoints and reconciliation heartbeat — 1 day.
2. Task 3: resumable new-high initialization — 1 day.
3. Tasks 4–5: six breadth snapshots and staged close review — 1.5 days.
4. Task 6: morning-brief punctuality and consistency validation — 1 day.
5. Task 7: ETF derived metrics and category completion — 0.5–1 day.
6. Task 8: field-level customer diagnostics — 0.5 day.
7. Task 9: deploy and observe one full trading cycle — 1 trading day.

Expected implementation time: about 5 engineering days plus one full trading day of production observation.

## Acceptance Boundary

The repair is complete only when the system demonstrates one full trading-day cycle. Passing unit tests alone is not enough because the main risks are provider availability, Worker execution limits, Cron delivery, and source timestamp quality.

Historical all-market breadth, large-down count, and turnover remain `暂缺` for dates where no reproducible full-market historical snapshot exists. This plan does not fabricate those values and does not use RSS, Firecrawl, or Qwen to calculate market statistics.
