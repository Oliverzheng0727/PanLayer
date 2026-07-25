# PanLayer Calendar-day Morning Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the sourced five-module morning brief every calendar day, label weekend output honestly, and show the latest valid brief while the current day is still pending.

**Architecture:** Separate calendar-day research jobs from market-session jobs in the scheduler. Add a weekend-safe provider instruction at the prompt boundary. Keep the exact-date API unchanged while the dashboard reads an explicit latest-valid fallback.

**Tech Stack:** React/TypeScript, vinext, Cloudflare Workers, D1, Vitest, Sites.

## Global Constraints

- All scheduling decisions use Beijing time.
- Weekend output must state that A shares are closed and must not invent an intraday market expectation.
- Every important fact remains source-backed; unavailable facts remain unavailable.
- Existing public API exact-date semantics remain unchanged.

---

### Task 1: Calendar-day scheduler

**Files:**
- Modify: `tests/remote-scheduler.test.ts`
- Modify: `lib/jobs/remote-scheduler.ts`
- Modify: `lib/jobs/checkpoints.ts`

**Interfaces:**
- Consumes: `planCatchUpJobs`, `scheduledJobKey`, checkpoint retry state.
- Produces: `planRemoteSchedulerJobs({ now, checkpoints }): ScheduledJob[]` with weekend research jobs and no weekend market-session jobs.

- [ ] **Step 1: Write the failing test**

Add a Saturday 08:17 case expecting `morning-brief` plus one background job, and assert that no breadth, ETF close metric, or close review job is selected.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/remote-scheduler.test.ts`

Expected: FAIL because the current weekend branch returns only `new-high-bootstrap`.

- [ ] **Step 3: Write minimal implementation**

Define calendar-day research keys and market-session keys. On weekends, plan only due research and background keys through the same checkpoint retry rules and priority ordering.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/remote-scheduler.test.ts`

Expected: PASS.

### Task 2: Weekend-safe prompt

**Files:**
- Modify: `tests/morning-brief-providers.test.ts`
- Modify: `lib/ai/morning-brief-providers.ts`

**Interfaces:**
- Consumes: the requested Beijing calendar date.
- Produces: provider prompts that explicitly distinguish weekend closure from a trading-day pre-market brief.

- [ ] **Step 1: Write the failing test**

Capture the Qwen prompt for `2026-07-25` and assert it says A shares are closed and forbids high-open, low-open, flat-open, and intraday-direction claims.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/morning-brief-providers.test.ts`

Expected: FAIL because the current prompt always says “A股隔夜早参”.

- [ ] **Step 3: Write minimal implementation**

Add a pure date-session instruction helper and append its weekend constraint to both the initial and supplement prompts.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/morning-brief-providers.test.ts`

Expected: PASS.

### Task 3: Latest-valid dashboard fallback

**Files:**
- Modify: `lib/data/repository.ts`
- Modify: `app/dashboard/page.tsx`
- Modify: `tests/brief-route.test.ts`

**Interfaces:**
- Produces: `readLatestBrief(onOrBefore: string): Promise<MorningBrief | null>`.
- Dashboard uses exact brief first, then latest valid brief; exact API remains `readBrief(date)`.

- [ ] **Step 1: Write the failing test**

Add contract assertions that the dashboard requests `readLatestBrief(date)` while the exact brief API still calls only `readBrief(date)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/brief-route.test.ts`

Expected: FAIL because `readLatestBrief` does not exist.

- [ ] **Step 3: Write minimal implementation**

Query `morning_briefs` on or before the requested date in descending date order, skip malformed rows, and use the result only when `readBrief(date)` is null.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/brief-route.test.ts`

Expected: PASS.

### Task 4: Verify and publish

**Files:**
- Validate all modified source and tests.

- [ ] **Step 1: Run complete verification**

Run: `npm test && npm run build && git diff --check`

Expected: all tests pass, build exits 0, no whitespace errors.

- [ ] **Step 2: Commit and push exact source**

Commit only the feature, tests, specification, and plan. Preserve unrelated user files.

- [ ] **Step 3: Publish and trigger**

Publish the exact commit through Sites, run the background workflow once, and verify the returned job list contains the weekend morning brief or a completed skip.
