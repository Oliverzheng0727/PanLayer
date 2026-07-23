# PanLayer History Review Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Excel-style historical review table with a left calendar, frozen headers and key columns, truthful null handling, and a resumable 20-trading-day backfill.

**Architecture:** Keep `daily_reviews` as the single persisted review record and allow historical partial reviews to contain empty breadth plus nullable metrics. A dedicated history backfill module obtains trading dates from the Shanghai Composite daily series and short-term sentiment from Eastmoney’s four historical board pools, then upserts only records created by the backfill. The current calendar/table workspace remains the UI boundary and gains null-safe cells, more comparison columns, sticky date-first layout, sorting, and session-state restoration.

**Tech Stack:** React 19, TypeScript 5.9, vinext/Cloudflare Workers, D1, Vitest, Node test runner, CSS sticky positioning.

## Global Constraints

- Do not change the landing page, morning brief, ETF workspace, or overall dashboard visual language.
- Default history order is newest trading date first.
- The desktop layout is a 240–260px calendar on the left and the table on the right.
- The table independently scrolls vertically and horizontally; header, date, and hot-sector columns remain frozen.
- Backfill exactly the most recent 20 closed Chinese trading days.
- Never convert unavailable historical metrics to zero; persist `null` and render `暂缺`.
- Do not synthesize historical intraday breadth snapshots.
- Re-running backfill must not duplicate rows or overwrite a richer non-backfill review.
- Production history must never be filled with demo rows.

---

## File Structure

- `lib/domain/types.ts`: nullable daily-review fields and optional backfill provenance.
- `lib/history/query.ts`: history-row projection, ratio calculation, nullable sorting, and allowed sort fields.
- `lib/history/backfill-sources.ts`: Shanghai Composite trading dates and Eastmoney historical board-pool adapters.
- `lib/history/backfill.ts`: partial review construction, resumable batch progress, and safe persistence.
- `lib/jobs/schedule.ts`: adds the manually runnable history-backfill job type without scheduling it.
- `lib/jobs/runner.ts`: dispatches one resumable history-backfill batch and records its job result.
- `app/api/v1/admin/jobs/[job]/run/route.ts`: validates `history-backfill?days=20`.
- `app/components/history/HistoryTable.tsx`: date-first Excel table and null-safe cells.
- `app/components/history/HistoryWorkspace.tsx`: persisted sort/filter/date state and infinite vertical reveal.
- `app/globals.css`: sticky column offsets, grouped columns, and 10–14-row viewport.
- `tests/history-query.test.ts`: history projection, ratios, sorting, and null behavior.
- `tests/history-backfill-sources.test.ts`: source parsing and empty/malformed response handling.
- `tests/history-backfill.test.ts`: idempotency, progress, and richer-record protection.
- `tests/runner.test.ts`: admin job dispatch and progress result.
- `tests/rendered-html.test.mjs`: date-first sticky layout and required visible columns.

---

### Task 1: Make history rows null-safe and comparison-ready

**Files:**
- Modify: `lib/domain/types.ts`
- Modify: `lib/history/query.ts`
- Modify: `lib/data/demo.ts`
- Modify: `tests/history-query.test.ts`

**Interfaces:**
- Produces: `HistoryRow.riseFallRatio: number | null`
- Produces: `HistoryRow.marginBalance: number | null`
- Produces: `HistoryRow.backfilled: boolean`
- Produces: `DailyReview.historyMeta?: { backfilled: boolean; receivedAt: string }`
- Consumes: existing `reviewToHistoryRow(review: DailyReview): HistoryRow`

- [ ] **Step 1: Write failing history projection tests**

Add a backfilled review fixture with no breadth and assert that unavailable metrics remain `null`:

```ts
it("keeps unavailable backfilled metrics null instead of zero", () => {
  const row = reviewToHistoryRow({
    ...review,
    breadth: [],
    metrics: { ...review.metrics, largeRise: null, high120: null, allTimeHigh: null },
    historyMeta: { backfilled: true, receivedAt: "2026-07-23T08:00:00.000Z" },
  });
  expect(row).toMatchObject({
    rising: null,
    falling: null,
    flat: null,
    riseFallRatio: null,
    largeRise: null,
    backfilled: true,
  });
});

it("calculates a finite rise-fall ratio", () => {
  expect(reviewToHistoryRow(review).riseFallRatio).toBeCloseTo(1530 / 2798, 4);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
npm test -- --run tests/history-query.test.ts
```

Expected: TypeScript or assertion failure because `largeRise` is not nullable and the new fields do not exist.

- [ ] **Step 3: Extend the domain and history projection**

Update the relevant part of `DailyReview`:

```ts
metrics: {
  limitUp: number;
  limitDown: number;
  consecutive: number;
  largeRise: number | null;
  high120: number | null;
  allTimeHigh: number | null;
  marginBalance: number | null;
};
historyMeta?: {
  backfilled: boolean;
  receivedAt: string;
};
```

Update `HistoryRow`:

```ts
export interface HistoryRow {
  date: string;
  rising: number | null;
  falling: number | null;
  flat: number | null;
  riseFallRatio: number | null;
  limitUp: number;
  limitDown: number;
  largeRise: number | null;
  consecutive: number;
  maxStreak: number;
  openPremium: number | null;
  closePremium: number | null;
  high120: number | null;
  allTimeHigh: number | null;
  marginBalance: number | null;
  topSector: string;
  backfilled: boolean;
  status: "complete" | "partial" | "failed" | "demo";
  source: string;
  updatedAt: string;
}
```

Project without defaulting to zero:

```ts
const closeBreadth = review.breadth.at(-1);
const rising = closeBreadth?.rising ?? null;
const falling = closeBreadth?.falling ?? null;

return {
  date: review.date,
  rising,
  falling,
  flat: closeBreadth?.flat ?? null,
  riseFallRatio: rising !== null && falling !== null && falling > 0
    ? Number((rising / falling).toFixed(2))
    : null,
  // existing fields
  largeRise: review.metrics.largeRise,
  marginBalance: review.metrics.marginBalance,
  backfilled: review.historyMeta?.backfilled === true,
};
```

Add `"riseFallRatio"` and `"marginBalance"` to `HISTORY_SORT_FIELDS`. Keep `compareValue()` placing `null` after real values in both directions.

- [ ] **Step 4: Update demo rows with explicit derived fields**

Add:

```ts
riseFallRatio: Number((historyRising[index] / falling).toFixed(2)),
marginBalance: 26_900 + index * 11.8,
backfilled: false,
```

Compute `falling` in a local variable before returning each demo row so the ratio and displayed falling count share the same denominator.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npm test -- --run tests/history-query.test.ts
npm run lint
```

Expected: all focused tests pass and lint exits 0.

Commit:

```bash
git add lib/domain/types.ts lib/history/query.ts lib/data/demo.ts tests/history-query.test.ts
git commit -m "feat: make historical review metrics null-safe"
```

---

### Task 2: Add historical trading-date and board-pool adapters

**Files:**
- Create: `lib/history/backfill-sources.ts`
- Create: `tests/history-backfill-sources.test.ts`

**Interfaces:**
- Produces: `fetchRecentTradingDates(endDate: string, count: number, fetcher?: typeof fetch): Promise<string[]>`
- Produces: `fetchHistoricalBoardPools(date: string, fetcher?: typeof fetch): Promise<HistoricalBoardPools>`
- Produces:

```ts
export interface HistoricalPoolItem {
  code: string;
  name: string;
  pctChange: number;
  amount: number;
  industry: string;
  limitStreak: number;
  firstLimitTime: string | null;
}

export interface HistoricalBoardPools {
  limitUp: HistoricalPoolItem[];
  broken: HistoricalPoolItem[];
  limitDown: HistoricalPoolItem[];
  yesterdayLimitUp: HistoricalPoolItem[];
}
```

- [ ] **Step 1: Write failing source-shape tests**

Use response fixtures, never live network, and verify date filtering plus Eastmoney field conversion:

```ts
it("returns the newest 20 Shanghai Composite trading dates on or before endDate", async () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({
    day: `2026-07-${String(index + 1).padStart(2, "0")}`,
    close: "3500",
  }));
  const fetcher = async () => new Response(JSON.stringify(rows));
  const dates = await fetchRecentTradingDates("2026-07-23", 20, fetcher as typeof fetch);
  expect(dates).toHaveLength(20);
  expect(dates[0]).toBe("2026-07-23");
  expect(dates.at(-1)).toBe("2026-07-04");
});

it("maps Eastmoney four-pool fields without inventing values", async () => {
  const fetcher = async (input: RequestInfo | URL) => {
    const endpoint = String(input);
    const pool = endpoint.includes("getTopicZTPool")
      ? [{ c: "600001", n: "示例", zdp: 10.01, amount: 800000000, hybk: "电子", lbc: 3, fbt: 93500 }]
      : [];
    return new Response(JSON.stringify({ data: { pool } }));
  };
  const pools = await fetchHistoricalBoardPools("2026-07-22", fetcher as typeof fetch);
  expect(pools.limitUp[0]).toMatchObject({
    code: "600001",
    pctChange: 10.01,
    industry: "电子",
    limitStreak: 3,
    firstLimitTime: "09:35:00",
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run:

```bash
npm test -- --run tests/history-backfill-sources.test.ts
```

Expected: FAIL because `lib/history/backfill-sources.ts` does not exist.

- [ ] **Step 3: Implement the source adapters**

Use Sina’s Shanghai Composite daily endpoint for the trading calendar:

```ts
const SINA_TRADING_DATES =
  "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/" +
  "CN_MarketData.getKLineData?symbol=sh000001&scale=240&ma=no&datalen=90";
```

Use the four Vibe-Research/AStockData-compatible pool endpoints:

```ts
const POOLS = {
  limitUp: ["getTopicZTPool", "fbt:asc"],
  broken: ["getTopicZBPool", "fbt:asc"],
  limitDown: ["getTopicDTPool", "fund:asc"],
  yesterdayLimitUp: ["getYesterdayZTPool", "zs:desc"],
} as const;
```

Every request must include:

```ts
{
  headers: {
    accept: "application/json",
    referer: "https://quote.eastmoney.com/",
    "user-agent": "PanLayer/1.0",
  },
  signal: AbortSignal.timeout(4_500),
}
```

Treat non-2xx, malformed JSON, and missing `data.pool` as source errors. An explicit empty pool array is a valid zero-count response.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npm test -- --run tests/history-backfill-sources.test.ts
npm run lint
```

Expected: all source tests pass.

Commit:

```bash
git add lib/history/backfill-sources.ts tests/history-backfill-sources.test.ts
git commit -m "feat: add historical board-pool adapters"
```

---

### Task 3: Build resumable, idempotent 20-day backfill

**Files:**
- Create: `lib/history/backfill.ts`
- Modify: `lib/jobs/schedule.ts`
- Modify: `lib/jobs/runner.ts`
- Modify: `app/api/v1/admin/jobs/[job]/run/route.ts`
- Create: `tests/history-backfill.test.ts`
- Modify: `tests/runner.test.ts`

**Interfaces:**
- Consumes: `fetchRecentTradingDates()`
- Consumes: `fetchHistoricalBoardPools()`
- Produces:

```ts
export interface HistoryBackfillProgress {
  target: number;
  completed: number;
  remaining: number;
  dates: string[];
}

export async function runHistoryBackfillBatch(args: {
  db: D1Database;
  endDate: string;
  days: number;
  batchSize?: number;
  fetcher?: typeof fetch;
}): Promise<HistoryBackfillProgress>
```

- [ ] **Step 1: Write failing builder and persistence tests**

Test partial review construction:

```ts
it("builds a truthful partial review from historical board pools", () => {
  const review = buildBackfilledReview("2026-07-22", pools, "2026-07-23T08:00:00.000Z");
  expect(review.breadth).toEqual([]);
  expect(review.metrics).toMatchObject({
    limitUp: 2,
    limitDown: 1,
    consecutive: 1,
    largeRise: null,
    high120: null,
    allTimeHigh: null,
  });
  expect(review.historyMeta?.backfilled).toBe(true);
  expect(review.status).toBe("partial");
});
```

Use the existing fake-D1 pattern from `tests/runner.test.ts` to assert:

```ts
expect(savedDates).toEqual(["2026-07-22", "2026-07-21", "2026-07-20", "2026-07-17", "2026-07-16"]);
expect(new Set(savedDates).size).toBe(savedDates.length);
expect(completeExistingPayload).toBe(originalPayload);
```

- [ ] **Step 2: Verify tests fail**

Run:

```bash
npm test -- --run tests/history-backfill.test.ts tests/runner.test.ts
```

Expected: FAIL because the job and builder do not exist.

- [ ] **Step 3: Implement partial review construction**

Convert each limit-up item to the existing `Quote` shape. Values absent from the pool remain neutral only where the domain object requires them, while history metrics remain `null`:

```ts
export function buildBackfilledReview(
  date: string,
  pools: HistoricalBoardPools,
  marginBalance: number | null,
  receivedAt: string,
): DailyReview {
  const limitUps = pools.limitUp.map(poolItemToQuote);
  return {
    date,
    status: "partial",
    source: "历史回补 · 东方财富涨跌停池 / 新浪交易日历",
    updatedAt: receivedAt,
    breadth: [],
    metrics: {
      limitUp: pools.limitUp.length,
      limitDown: pools.limitDown.length,
      consecutive: pools.limitUp.filter((item) => item.limitStreak >= 2).length,
      largeRise: null,
      high120: null,
      allTimeHigh: null,
      marginBalance,
    },
    premium: { openPct: null, closePct: null, sampleSize: 0 },
    ladder: bucketLimitLadder(limitUps),
    sectors: buildBackfillSectors(pools.limitUp),
    leaders: rankLeaders(limitUps).slice(0, 20),
    historyMeta: { backfilled: true, receivedAt },
  };
}
```

Rank sectors by limit-up count, then maximum streak, then name. Do not create average sector return or amount-growth values from unavailable data; set those two fields to `0` only inside `SectorMetric` for compatibility and never expose them as verified history fields.

- [ ] **Step 4: Implement resumable batches**

Persist progress in `bootstrap_state` under `history-backfill-v1`:

```ts
interface StoredProgress {
  endDate: string;
  days: number;
  dates: string[];
  completed: string[];
}
```

On each call:

1. Load or initialize the 20 target dates.
2. Select at most `batchSize = 5` dates not in `completed`.
3. Fetch each date with concurrency 2. For each date, call `createEastmoneyProvider(fetcher).getMarginBalance(date)` in parallel with `fetchHistoricalBoardPools(date, fetcher)` and convert a failed margin request to `null`.
4. Insert the partial review only when no row exists, or update it only when the existing payload has `historyMeta.backfilled === true`.
5. Add successful dates to `completed`.
6. Save progress with `ON CONFLICT(key) DO UPDATE`.
7. Return target/completed/remaining.

Use this protection before writing:

```ts
const existing = await db.prepare(
  "SELECT payload FROM daily_reviews WHERE trade_date = ?",
).bind(date).first<{ payload: string }>();

const parsed = existing?.payload ? JSON.parse(existing.payload) as DailyReview : null;
if (parsed && parsed.historyMeta?.backfilled !== true) return "skipped-richer";
```

- [ ] **Step 5: Wire the manual admin job**

Extend `ScheduledJob`:

```ts
| { type: "history-backfill"; days: number };
```

Do not add it to `jobForBeijingTime()`. In the admin route, accept:

```ts
job === "history-backfill"
  ? { type: "history-backfill", days: Number(searchParams.get("days") ?? 20) }
  : existingMapping;
```

Validate `days` as an integer from 1 through 20 and allow `days` only for this job. In `runPanLayerJob()`, call one five-date batch and return:

```ts
{
  ok: true,
  message: `history-backfill ${progress.completed}/${progress.target}; remaining ${progress.remaining}`,
}
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm test -- --run tests/history-backfill.test.ts tests/runner.test.ts tests/scheduler.test.ts
npm run lint
```

Expected: all focused tests pass; scheduler still returns no automatic backfill job.

Commit:

```bash
git add lib/history/backfill.ts lib/jobs/schedule.ts lib/jobs/runner.ts 'app/api/v1/admin/jobs/[job]/run/route.ts' tests/history-backfill.test.ts tests/runner.test.ts
git commit -m "feat: add resumable history backfill job"
```

---

### Task 4: Convert the history workspace to the approved Excel layout

**Files:**
- Modify: `app/components/history/HistoryTable.tsx`
- Modify: `app/components/history/HistoryWorkspace.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: expanded `HistoryRow`
- Preserves: `onOpenHighs(date, "120d" | "all-time")`
- Preserves: `/dashboard?date=YYYY-MM-DD` date links

- [ ] **Step 1: Write failing rendered-HTML assertions**

Replace the old hotspot-first assertion with:

```js
assert.ok(
  historyTable.indexOf("日期") < historyTable.indexOf("热点板块"),
  "历史表应先显示日期，再显示热点板块",
);
assert.match(historyTable, /涨跌比/);
assert.match(historyTable, /两融余额/);
assert.match(historyTable, /数据来源/);
assert.match(historyTable, /更新时间/);
```

Add CSS assertions:

```js
assert.match(css, /\.history-table th\s*\{[^}]*position:sticky;[^}]*top:0;/);
assert.match(css, /\.history-table \.history-date\s*\{[^}]*left:0;/);
assert.match(css, /\.history-table \.history-sector-cell\s*\{[^}]*left:102px;/);
assert.match(css, /\.history-table-scroll\s*\{[^}]*max-height:548px;[^}]*overflow:auto;/);
```

- [ ] **Step 2: Verify the render test fails**

Run:

```bash
npm run build
node --test tests/rendered-html.test.mjs
```

Expected: FAIL on the date/hot-sector order and missing new columns.

- [ ] **Step 3: Reorder and extend table columns**

Use this column order:

```ts
const columns = [
  { field: "date", label: "日期", className: "history-date" },
  { label: "热点板块", className: "history-sector-cell" },
  { field: "rising", label: "上涨家数" },
  { field: "falling", label: "下跌家数" },
  { label: "平盘家数" },
  { field: "riseFallRatio", label: "涨跌比" },
  { field: "limitUp", label: "涨停" },
  { field: "limitDown", label: "跌停" },
  { label: "大涨股" },
  { field: "consecutive", label: "连板" },
  { field: "maxStreak", label: "最高板" },
  { field: "openPremium", label: "连板开盘溢价" },
  { field: "closePremium", label: "连板收盘溢价" },
  { field: "high120", label: "120日新高" },
  { field: "allTimeHigh", label: "历史新高" },
  { field: "marginBalance", label: "两融余额" },
  { label: "数据状态" },
  { label: "数据来源" },
  { label: "更新时间" },
] satisfies Array<{ field?: HistorySortField; label: string; className?: string }>;
```

Render nullable numbers with:

```ts
const count = (value: number | null) => value === null ? "暂缺" : value.toLocaleString("zh-CN");
const ratio = (value: number | null) => value === null ? "暂缺" : value.toFixed(2);
const moneyYi = (value: number | null) => value === null ? "暂缺" : `${value.toFixed(2)}亿`;
```

Display `回补` when `row.backfilled` is true; retain `完整/部分/失败/演示` for normal rows. Do not disable the date link for a backfilled row because Task 3 stores a truthful partial `DailyReview`.

- [ ] **Step 4: Correct sticky columns and viewport**

Set:

```css
.history-table-scroll {
  max-height:548px;
  min-width:0;
  overflow:auto;
  overscroll-behavior:contain;
}

.history-table {
  min-width:1960px;
}

.history-table .history-date {
  position:sticky;
  left:0;
  z-index:3;
  width:102px;
  min-width:102px;
  background:#121314;
}

.history-table .history-sector-cell {
  position:sticky;
  left:102px;
  z-index:3;
  width:170px;
  min-width:170px;
  border-right:1px solid rgba(255,255,255,.06);
  background:#121314;
}
```

Add a slightly stronger separator after `涨跌比`, `最高板`, and `两融余额` using column classes instead of nth-child selectors.

- [ ] **Step 5: Persist workspace state within the browser session**

In `HistoryWorkspace`, initialize from `sessionStorage` after mount and store:

```ts
interface HistoryViewState {
  sort: HistorySortField;
  order: SortOrder;
  sector: string;
  selected: string;
  visibleCount: number;
  scrollTop: number;
  scrollLeft: number;
}
```

Pass a `scrollRef` into `HistoryTable`, update the saved scroll values on scroll, and restore them after rows render. Clamp `visibleCount` to `sorted.length`.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm test -- --run tests/history-query.test.ts
npm run build
node --test tests/rendered-html.test.mjs
npm run lint
```

Expected: all commands pass.

Commit:

```bash
git add app/components/history/HistoryTable.tsx app/components/history/HistoryWorkspace.tsx app/globals.css tests/rendered-html.test.mjs
git commit -m "feat: add Excel-style historical review table"
```

---

### Task 5: Make current and backfilled reviews render truthfully

**Files:**
- Modify: `app/components/Dashboard.tsx`
- Modify: `lib/jobs/runner.ts`
- Modify: `tests/rendered-html.test.mjs`
- Modify: `tests/runner.test.ts`

**Interfaces:**
- Consumes: nullable `DailyReview.metrics.largeRise`
- Consumes: empty `DailyReview.breadth`
- Preserves: current-day close-review calculations and persistence

- [ ] **Step 1: Add failing null-display tests**

Add rendered HTML assertions that a partial backfilled review contains `暂缺` for breadth and large-rise values and does not render those unknown values as zero.

Add a runner test confirming current close-review still writes numeric `largeRise`:

```ts
expect(savedReview.metrics.largeRise).toBeTypeOf("number");
expect(savedReview.historyMeta).toBeUndefined();
```

- [ ] **Step 2: Verify tests fail**

Run:

```bash
npm test -- --run tests/runner.test.ts
npm run build
node --test tests/rendered-html.test.mjs
```

Expected: render failure because the dashboard defaults missing breadth to zero.

- [ ] **Step 3: Render absent breadth and metrics as unavailable**

Replace zero fallbacks with nullable display values:

```ts
const closeBreadth = review.breadth.at(-1);
const rising = closeBreadth?.rising ?? null;
const falling = closeBreadth?.falling ?? null;
const flat = closeBreadth?.flat ?? null;
```

Use:

```tsx
<Metric
  label="上涨家数"
  value={rising === null ? "暂缺" : String(rising)}
  note={falling === null ? "下跌 暂缺" : `下跌 ${falling}` }
/>
```

Do the same for market-temperature bars and `largeRise`. Do not render bar widths when the relevant value is `null`.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npm test -- --run tests/runner.test.ts tests/history-query.test.ts
npm run lint
npm run build
node --test tests/rendered-html.test.mjs
```

Expected: all commands pass.

Commit:

```bash
git add app/components/Dashboard.tsx lib/jobs/runner.ts tests/rendered-html.test.mjs tests/runner.test.ts
git commit -m "fix: render unavailable historical metrics truthfully"
```

---

### Task 6: Full verification, production backfill, and deployment

**Files:**
- Modify only if verification reveals a scoped defect.

**Interfaces:**
- Consumes: `POST /api/v1/admin/jobs/history-backfill/run?days=20`
- Produces: deployed Sites version containing the exact tested commit

- [ ] **Step 1: Run the complete local verification suite**

Run:

```bash
npm test
npm run lint
npm run build
node --test tests/rendered-html.test.mjs
git diff --check
```

Expected:

- all Vitest files pass;
- lint exits 0;
- vinext build completes;
- seven or more rendered-HTML checks pass;
- `git diff --check` has no output.

- [ ] **Step 2: Exercise a local five-date backfill batch**

Run the production-mode server and call the protected admin endpoint using the local authenticated browser session:

```text
POST /api/v1/admin/jobs/history-backfill/run?days=20
```

Expected response after the first call:

```json
{
  "ok": true,
  "message": "history-backfill 5/20; remaining 15"
}
```

Repeat until `remaining 0`. Query:

```text
GET /api/v1/history?sort=date&order=desc&limit=30
```

Verify 20 unique, descending trading dates and no weekends.

- [ ] **Step 3: Commit any final scoped fixes**

If no files changed, skip this commit. Otherwise, inspect `git status --short`, stage only the files changed for the scoped verification fix, and commit:

```bash
git commit -m "fix: finalize historical review backfill"
```

- [ ] **Step 4: Push the exact HEAD and save a Sites version**

Read `.openai/hosting.json`, reuse:

```text
appgprj_6a60e025581c8191b92514c441d22d04
```

Create a short-lived source credential, push the exact current `HEAD` to the configured Sites `main` branch, package the existing `dist` build, and call `save_site_version` with that exact commit SHA.

- [ ] **Step 5: Deploy the saved version**

Because this site is public and the user has approved production updates, call `deploy_site_version` with the saved version ID. Poll `get_deployment_status` until `succeeded`.

- [ ] **Step 6: Run the production backfill to completion**

In the authenticated production browser, call the admin backfill endpoint up to four times until the response reports:

```text
history-backfill 20/20; remaining 0
```

If a source date fails, call again; progress only advances for successfully persisted dates.

- [ ] **Step 7: Production UI acceptance**

On:

```text
https://panlayer-market-review.lihaozheng567.chatgpt.site/dashboard#history
```

Verify:

- the left calendar and right table are visible together at 1440px;
- the first row is the latest trading day;
- at least 20 unique dates exist;
- the table body scrolls vertically without moving the header;
- horizontal scroll keeps date and hot-sector columns visible;
- unavailable backfilled values read `暂缺`, never `0`;
- clicking a `120日新高` or `历史新高` count opens the right drawer;
- sorting a numeric column reverses the row order;
- selecting a calendar date scrolls to and highlights the matching row.

- [ ] **Step 8: Report the deployed version**

Report the production URL, Sites version number, commit SHA, verified row count, and any fields that remain unavailable in the 20-day backfill.
