# PanLayer Live Refresh and Data Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 60-second ETF refresh, 3-minute live market-breadth refresh, visible freshness/source status, and a manual refresh that updates the page without mislabeling stale data as current.

**Architecture:** Add pure refresh/freshness helpers, wrap live provider results in timestamped envelopes, and expose a lightweight authenticated live-market endpoint. Client components poll only while visible and in the applicable Beijing trading session, retain the last successful payload on failure, and label that payload as stale. Existing six scheduled breadth snapshots and historical persistence remain unchanged.

**Tech Stack:** React 19, TypeScript 5.9, Vinext/Next App Router, Cloudflare Workers and D1, Vitest, Eastmoney primary data, Tencent cross-check data.

## Global Constraints

- Preserve the current page structure, navigation, styling language, ETF categories, sorting, search, watchlist, and four K-line periods.
- ETF list refresh interval is exactly 60 seconds while the page is visible.
- Live breadth refresh interval is exactly 3 minutes during Beijing A-share trading sessions.
- The server cache lifetime for ETF and live breadth responses is exactly 60 seconds.
- A successful response older than 5 minutes is stale.
- Failed requests retain the last successful screen data but visibly label it as `更新失败 · 旧数据`.
- Do not create additional historical breadth rows beyond 09:25, 10:00, 11:00, 13:00, 14:00, and 15:00.
- Production K-line failures return no demo data.
- All external facts remain marked with source and timestamps; free data is not described as a professional SLA.

---

### Task 1: Refresh and freshness policy

**Files:**
- Create: `lib/live/refresh-policy.ts`
- Test: `tests/refresh-policy.test.ts`

**Interfaces:**
- Produces: `ETF_REFRESH_MS`, `BREADTH_REFRESH_MS`, `SERVER_LIVE_CACHE_MS`, `STALE_AFTER_MS`.
- Produces: `isBeijingMarketSession(date: Date): boolean` and `isStale(receivedAt: string | null, now?: Date): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { BREADTH_REFRESH_MS, ETF_REFRESH_MS, SERVER_LIVE_CACHE_MS, isBeijingMarketSession, isStale } from "../lib/live/refresh-policy";

describe("live refresh policy", () => {
  it("uses the approved refresh intervals", () => {
    expect(ETF_REFRESH_MS).toBe(60_000);
    expect(BREADTH_REFRESH_MS).toBe(180_000);
    expect(SERVER_LIVE_CACHE_MS).toBe(60_000);
  });

  it("recognizes Beijing A-share sessions", () => {
    expect(isBeijingMarketSession(new Date("2026-07-23T02:00:00Z"))).toBe(true);
    expect(isBeijingMarketSession(new Date("2026-07-23T04:00:00Z"))).toBe(false);
    expect(isBeijingMarketSession(new Date("2026-07-25T02:00:00Z"))).toBe(false);
  });

  it("marks a payload older than five minutes as stale", () => {
    const now = new Date("2026-07-23T02:10:01Z");
    expect(isStale("2026-07-23T02:05:00Z", now)).toBe(true);
    expect(isStale("2026-07-23T02:06:00Z", now)).toBe(false);
    expect(isStale(null, now)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/refresh-policy.test.ts`

Expected: FAIL because `lib/live/refresh-policy.ts` does not exist.

- [ ] **Step 3: Add the minimal pure implementation**

```ts
import { beijingDateParts } from "../jobs/schedule";

export const ETF_REFRESH_MS = 60_000;
export const BREADTH_REFRESH_MS = 180_000;
export const SERVER_LIVE_CACHE_MS = 60_000;
export const STALE_AFTER_MS = 300_000;

export function isBeijingMarketSession(date: Date): boolean {
  const { time, weekday } = beijingDateParts(date);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return (time >= "09:25" && time <= "11:30") || (time >= "13:00" && time <= "15:00");
}

export function isStale(receivedAt: string | null, now = new Date()): boolean {
  if (!receivedAt) return true;
  const received = Date.parse(receivedAt);
  return !Number.isFinite(received) || now.getTime() - received > STALE_AFTER_MS;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run tests/refresh-policy.test.ts`

Expected: 3 tests pass.

- [ ] **Step 5: Commit the policy**

```bash
git add lib/live/refresh-policy.ts tests/refresh-policy.test.ts
git commit -m "feat: define live refresh policy"
```

---

### Task 2: Timestamped ETF catalog responses

**Files:**
- Modify: `lib/etf/live-catalog.ts`
- Modify: `app/api/v1/etfs/route.ts`
- Modify: `app/api/v1/etfs/categories/route.ts`
- Modify: `app/dashboard/page.tsx`
- Test: `tests/etf-live-catalog.test.ts`
- Test: `tests/etf-ui-contract.test.ts`

**Interfaces:**
- Produces: `EtfCatalogEnvelope = { items: EtfSnapshot[]; source: string; status: "complete"; receivedAt: string; marketTime: string | null; isStale: boolean }`.
- Produces: `loadLiveEtfCatalogEnvelope(date?: string): Promise<EtfCatalogEnvelope>`.
- Keeps: `loadLiveEtfCatalog(date?: string): Promise<EtfSnapshot[]>` for existing consumers.

- [ ] **Step 1: Extend the cache tests before production code**

```ts
it("returns the same timestamped envelope inside the one-minute cache", async () => {
  const cache = createEtfCatalogCache<{ items: number[]; receivedAt: string }>(60_000);
  let calls = 0;
  const loader = async () => ({ items: [++calls], receivedAt: new Date(10_000).toISOString() });
  expect(await cache.get(loader, 10_000)).toEqual(await cache.get(loader, 69_999));
  expect(calls).toBe(1);
  expect((await cache.get(loader, 70_001)).items).toEqual([2]);
});
```

Add API contract assertions to `tests/etf-ui-contract.test.ts` that the ETF response source contains `receivedAt`, `marketTime`, `status`, and `isStale`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run tests/etf-live-catalog.test.ts tests/etf-ui-contract.test.ts`

Expected: FAIL because the timestamped envelope and response fields do not exist.

- [ ] **Step 3: Implement the one-minute ETF envelope**

```ts
import { isStale, SERVER_LIVE_CACHE_MS } from "../live/refresh-policy";

export interface EtfCatalogEnvelope {
  items: EtfSnapshot[];
  source: "东方财富";
  status: "complete";
  receivedAt: string;
  marketTime: string | null;
  isStale: boolean;
}

const liveCatalogCache = createEtfCatalogCache<Omit<EtfCatalogEnvelope, "isStale">>(SERVER_LIVE_CACHE_MS);

export async function loadLiveEtfCatalogEnvelope(date = new Date().toISOString().slice(0, 10)): Promise<EtfCatalogEnvelope> {
  const cached = await liveCatalogCache.get(async () => ({
    items: await createEastmoneyProvider().getEtfs(date),
    source: "东方财富" as const,
    status: "complete" as const,
    receivedAt: new Date().toISOString(),
    marketTime: null,
  }));
  return { ...cached, isStale: isStale(cached.receivedAt) };
}

export async function loadLiveEtfCatalog(date?: string): Promise<EtfSnapshot[]> {
  return (await loadLiveEtfCatalogEnvelope(date)).items;
}
```

Update the ETF list and category routes to spread the envelope metadata into successful JSON responses. Development fallback responses must set `status: "partial"`, `source: "本机演示数据"`, `receivedAt`, `marketTime: null`, and `isStale: true`; production failures keep HTTP 502 with `status: "failed"` and no old items.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/etf-live-catalog.test.ts tests/etf-ui-contract.test.ts`

Expected: all focused tests pass.

- [ ] **Step 5: Commit ETF response metadata**

```bash
git add lib/etf/live-catalog.ts app/api/v1/etfs/route.ts app/api/v1/etfs/categories/route.ts app/dashboard/page.tsx tests/etf-live-catalog.test.ts tests/etf-ui-contract.test.ts
git commit -m "feat: expose ETF data freshness"
```

---

### Task 3: Live breadth endpoint without extra history rows

**Files:**
- Create: `lib/live/live-market.ts`
- Create: `app/api/v1/market/live/route.ts`
- Test: `tests/live-market.test.ts`
- Test: `tests/live-market-route.test.ts`

**Interfaces:**
- Produces: `LiveMarketSnapshot = { breadth: Breadth; source: string; status: "complete" | "partial" | "failed"; message: string; marketTime: string | null; receivedAt: string; isStale: boolean }`.
- Produces: `createLiveMarketLoader(fetcher?: typeof fetch)` with `get(now?: Date): Promise<LiveMarketSnapshot>`.
- Does not consume D1 and therefore cannot insert historical rows.

- [ ] **Step 1: Write failing cache and failure tests**

```ts
import { describe, expect, it } from "vitest";
import { createLiveMarketCache } from "../lib/live/live-market";

describe("live market snapshot", () => {
  it("deduplicates requests inside one minute", async () => {
    const cache = createLiveMarketCache<number>(60_000);
    let calls = 0;
    expect(await cache.get(async () => ++calls, 1_000)).toBe(1);
    expect(await cache.get(async () => ++calls, 60_999)).toBe(1);
    expect(await cache.get(async () => ++calls, 61_001)).toBe(2);
  });

  it("does not retain a failed request as current data", async () => {
    const cache = createLiveMarketCache<number>(60_000);
    await expect(cache.get(async () => { throw new Error("down"); }, 1_000)).rejects.toThrow("down");
    await expect(cache.get(async () => 2, 1_001)).resolves.toBe(2);
  });
});
```

The route test must assert authenticated success includes breadth/source/timestamps and that provider failure returns HTTP 502 with `status: "failed"`, `breadth: null`, and no cached numeric breadth.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run tests/live-market.test.ts tests/live-market-route.test.ts`

Expected: FAIL because the loader and route do not exist.

- [ ] **Step 3: Implement the loader and route**

`lib/live/live-market.ts` will use `createEastmoneyProvider`, `fetchTencentQuotes`, `runDomesticPipeline`, `calculateBreadth`, `beijingDateParts`, `SERVER_LIVE_CACHE_MS`, and `isStale`. It will call the domestic pipeline with `expectedSymbols: []`, derive the Tencent comparison list from the primary response, reject an empty/failed market result, and return timestamps without writing D1.

The route is:

```ts
import { authorizeApi } from "../../../auth-guard";
import { loadLiveMarketSnapshot } from "../../../../../lib/live/live-market";

export async function GET() {
  const denied = await authorizeApi();
  if (denied) return denied;
  try {
    return Response.json(await loadLiveMarketSnapshot());
  } catch (error) {
    return Response.json({
      breadth: null,
      source: "东方财富 / 腾讯",
      status: "failed",
      message: error instanceof Error ? error.message : "实时市场数据失败",
      marketTime: null,
      receivedAt: new Date().toISOString(),
      isStale: true,
    }, { status: 502 });
  }
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/live-market.test.ts tests/live-market-route.test.ts`

Expected: all focused tests pass.

- [ ] **Step 5: Commit the live breadth endpoint**

```bash
git add lib/live/live-market.ts app/api/v1/market/live/route.ts tests/live-market.test.ts tests/live-market-route.test.ts
git commit -m "feat: add non-persistent live market breadth"
```

---

### Task 4: Visibility-aware client polling and status UI

**Files:**
- Create: `lib/live/polling.ts`
- Create: `app/components/data/LiveDataStatus.tsx`
- Modify: `app/components/Dashboard.tsx`
- Modify: `app/components/etf/EtfWorkspace.tsx`
- Modify: `app/components/etf/EtfChart.tsx`
- Modify: `app/globals.css`
- Test: `tests/polling.test.ts`
- Test: `tests/live-refresh-ui-contract.test.ts`

**Interfaces:**
- Produces: `shouldPoll({ visible, kind, now }): boolean` where `kind` is `"etf" | "breadth"`.
- Produces: reusable visual `LiveDataStatus` with source/status/marketTime/receivedAt/stale/error props and `aria-live="polite"`.
- Consumes the ETF metadata from Task 2 and `GET /api/v1/market/live` from Task 3.

- [ ] **Step 1: Write failing policy and UI-contract tests**

```ts
import { describe, expect, it } from "vitest";
import { shouldPoll } from "../lib/live/polling";

describe("visibility-aware polling", () => {
  it("polls ETFs whenever the page is visible", () => {
    expect(shouldPoll({ visible: true, kind: "etf", now: new Date("2026-07-25T02:00:00Z") })).toBe(true);
    expect(shouldPoll({ visible: false, kind: "etf", now: new Date("2026-07-23T02:00:00Z") })).toBe(false);
  });

  it("polls breadth only in a Beijing trading session", () => {
    expect(shouldPoll({ visible: true, kind: "breadth", now: new Date("2026-07-23T02:00:00Z") })).toBe(true);
    expect(shouldPoll({ visible: true, kind: "breadth", now: new Date("2026-07-23T04:00:00Z") })).toBe(false);
  });
});
```

The UI contract test must read the component source and assert exact uses of `ETF_REFRESH_MS`, `BREADTH_REFRESH_MS`, `visibilitychange`, `aria-live="polite"`, `更新失败`, and `旧数据`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run tests/polling.test.ts tests/live-refresh-ui-contract.test.ts`

Expected: FAIL because polling and status components do not exist.

- [ ] **Step 3: Implement polling and visible status**

```ts
import { isBeijingMarketSession } from "./refresh-policy";

export function shouldPoll({ visible, kind, now }: { visible: boolean; kind: "etf" | "breadth"; now: Date }): boolean {
  if (!visible) return false;
  return kind === "etf" || isBeijingMarketSession(now);
}
```

In `EtfWorkspace`, extract the current ETF fetch into one `refreshCatalog(signal?)` callback. Run it immediately for state changes, every `ETF_REFRESH_MS`, and once on `visibilitychange` when the document becomes visible. Prevent overlapping requests with a ref. Store the last successful metadata separately; on failure keep `catalogEtfs` and set error/stale status.

In `Dashboard`, store `liveBreadth` initialized from the latest persisted breadth. Poll `/api/v1/market/live` every `BREADTH_REFRESH_MS` only when `shouldPoll` returns true. Use the live value in the overview and market-temperature cards without appending it to `review.breadth`, preserving the six-node historical chart.

Change manual refresh to check `response.ok`, surface the response error, then call `router.refresh()` and immediately refresh live breadth. Disable the button while pending.

`LiveDataStatus` must render source, market time when available, relative/absolute received time, and one of `完整`, `部分`, `更新失败 · 旧数据`. Add only compact status styling that follows the existing black/copper palette.

In `EtfChart`, retain the last successful K-line while a new period loads, but if the live request fails show `数据暂缺 · 更新失败` and do not identify fallback data as current. Production already returns no demo bars.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/polling.test.ts tests/live-refresh-ui-contract.test.ts`

Expected: all focused tests pass.

- [ ] **Step 5: Commit client refresh behavior**

```bash
git add lib/live/polling.ts app/components/data/LiveDataStatus.tsx app/components/Dashboard.tsx app/components/etf/EtfWorkspace.tsx app/components/etf/EtfChart.tsx app/globals.css tests/polling.test.ts tests/live-refresh-ui-contract.test.ts
git commit -m "feat: auto-refresh visible market data"
```

---

### Task 5: Full verification and public deployment

**Files:**
- Modify only files required by failures found in this task.

**Interfaces:**
- Consumes all outputs from Tasks 1–4.
- Produces a tested production build and a new public PanLayer Sites version.

- [ ] **Step 1: Run the complete unit suite**

Run: `npm test`

Expected: all Vitest tests pass with zero failures.

- [ ] **Step 2: Run code quality checks**

Run: `npm run lint`

Expected: exit code 0 with no lint errors.

- [ ] **Step 3: Build and run rendered HTML checks**

Run: `npm run test:render`

Expected: production build succeeds and every Node rendered-HTML test passes.

- [ ] **Step 4: Commit any verification-only fixes**

```bash
git add app lib tests docs
git commit -m "fix: harden live refresh behavior"
```

Skip this commit only when `git status --short` shows no tracked changes.

- [ ] **Step 5: Publish the exact verified source**

Follow `sites-hosting`: push the exact branch head, package the successful build with `scripts/package-site.sh`, save one site version, deploy it to the already-public PanLayer project, and wait for `status: "succeeded"`.

- [ ] **Step 6: Verify the public behavior**

Open the deployed `/dashboard` and confirm the live DOM includes the ETF status line, `加入自选`, source, updated time, and the manual refresh control. Confirm the live endpoint returns a timestamped envelope or an explicit failed status without fabricated numeric breadth.

