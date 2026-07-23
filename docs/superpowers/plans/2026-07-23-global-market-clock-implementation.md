# PanLayer Global Market Clock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-visible global bar showing Beijing time, latest market-data time, source, status, delay, and the next live-breadth refresh countdown.

**Architecture:** Put pure time formatting and countdown calculations in `lib/live/market-clock.ts`, then render one client component below the dashboard header. The dashboard passes its existing live-market state into the component, so no additional market requests or persistence are introduced.

**Tech Stack:** React 19, TypeScript 5.9, Vinext/Next App Router, Vitest, existing PanLayer live-market state.

## Global Constraints

- Preserve the existing dashboard structure and module content.
- The Beijing clock updates once per second.
- Market data remains on the existing 3-minute breadth and 60-second ETF schedules.
- Responses older than 5 minutes are visibly delayed.
- Non-trading sessions show `已收盘`, not a misleading countdown.
- Failed refreshes retain the last successful market time and display `更新失败 · 旧数据`.
- The bar is visible at 390px, 768px, and desktop widths.

---

### Task 1: Pure market-clock calculations

**Files:**
- Create: `lib/live/market-clock.ts`
- Test: `tests/market-clock.test.ts`

**Interfaces:**
- Produces: `formatBeijingClock(date: Date): string`.
- Produces: `delayMinutes(receivedAt: string | null, now: Date): number | null`.
- Produces: `nextRefreshSeconds(lastSuccessAt: string | null, now: Date, intervalMs?: number): number`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { delayMinutes, formatBeijingClock, nextRefreshSeconds } from "../lib/live/market-clock";

describe("global market clock", () => {
  it("formats the current time in Beijing", () => {
    expect(formatBeijingClock(new Date("2026-07-23T02:36:25Z"))).toBe("10:36:25");
  });

  it("calculates whole delayed minutes", () => {
    expect(delayMinutes("2026-07-23T02:29:12Z", new Date("2026-07-23T02:36:25Z"))).toBe(7);
    expect(delayMinutes(null, new Date())).toBeNull();
  });

  it("counts down to the next three-minute refresh", () => {
    expect(nextRefreshSeconds("2026-07-23T02:35:00Z", new Date("2026-07-23T02:36:00Z"))).toBe(120);
    expect(nextRefreshSeconds("2026-07-23T02:30:00Z", new Date("2026-07-23T02:36:00Z"))).toBe(0);
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/market-clock.test.ts`

Expected: FAIL because `lib/live/market-clock.ts` does not exist.

- [ ] **Step 3: Implement the pure functions**

Use `Intl.DateTimeFormat` with `timeZone: "Asia/Shanghai"` and calculate delay/countdown from parsed UTC milliseconds. Invalid or missing timestamps return `null` delay and a zero countdown.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run tests/market-clock.test.ts`

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/live/market-clock.ts tests/market-clock.test.ts
git commit -m "feat: add global market clock calculations"
```

---

### Task 2: Always-visible dashboard clock bar

**Files:**
- Create: `app/components/data/GlobalMarketClock.tsx`
- Modify: `app/components/Dashboard.tsx`
- Modify: `app/globals.css`
- Test: `tests/global-market-clock-ui.test.ts`

**Interfaces:**
- Produces: `GlobalMarketClock` props `{ source, status, marketTime, receivedAt, error }`.
- Consumes: `formatBeijingClock`, `delayMinutes`, `nextRefreshSeconds`, `isBeijingMarketSession`, and the dashboard's current `liveMarket` state.

- [ ] **Step 1: Write the failing UI contract test**

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("global market clock UI", () => {
  it("is rendered globally and remains visible on mobile", async () => {
    const [dashboard, clock, css] = await Promise.all([
      readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/components/data/GlobalMarketClock.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    ]);
    expect(dashboard).toMatch(/GlobalMarketClock/);
    expect(clock).toContain("北京时间");
    expect(clock).toContain("市场数据");
    expect(clock).toContain("下次刷新");
    expect(clock).toContain("更新失败 · 旧数据");
    expect(clock).toMatch(/setInterval/);
    expect(css).toMatch(/global-market-clock/);
    expect(css).not.toMatch(/\\.global-market-clock\\s*\\{[^}]*display:\\s*none/);
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/global-market-clock-ui.test.ts`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the component and wiring**

`GlobalMarketClock` stores only the current clock tick, updates it every second, derives delay and countdown from the last successful `receivedAt`, and uses `aria-hidden="true"` for the ticking time. A separate `aria-live="polite"` status span announces only status changes. `Dashboard` renders it directly below `dashboard-topbar`, passing `liveMarket` metadata or the persisted review fallback.

The CSS uses a one-line horizontally scrollable bar on narrow screens and a centered wrapping row on larger screens. It keeps the black/gray/copper palette and uses red only for stale or failed state.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run tests/global-market-clock-ui.test.ts tests/market-clock.test.ts`

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/components/data/GlobalMarketClock.tsx app/components/Dashboard.tsx app/globals.css tests/global-market-clock-ui.test.ts
git commit -m "feat: show global live market time"
```

---

### Task 3: Verification and public deployment

**Files:**
- Modify only files required by verification failures.

- [ ] **Step 1: Verify the complete project**

Run: `npm test && npm run lint && npm run test:render`

Expected: all tests, lint, production build, and rendered-HTML checks pass.

- [ ] **Step 2: Push the branch**

Run: `git push origin codex/panlayer`

Expected: the remote branch advances to the verified HEAD.

- [ ] **Step 3: Publish**

Follow `sites-hosting`: push the exact verified HEAD to the configured Sites source, package that exact build, save one version, deploy the already-public site, and wait for `succeeded`.
