# PanLayer Low-Cost Multi-Source Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-source runtime with an audited Eastmoney/Tencent A-share pipeline and add a quota-aware global overnight layer for the OpenAI morning brief without using Tushare.

**Architecture:** Keep `MarketDataProvider` as the domestic business-data boundary, add a Tencent quote adapter and pure reconciliation layer, then make the runner persist both business results and source audits. Build global providers behind small fetch interfaces, reconcile aggregator values with official macro sources, persist the snapshot, and pass it to the existing structured OpenAI brief generator.

**Tech Stack:** TypeScript 5.9, React 19, vinext/Cloudflare Workers, D1, Vitest, OpenAI Responses API, Eastmoney/Tencent public endpoints, Twelve Data, Alpha Vantage, FRED, EIA.

## Global Constraints

- Tushare is not called and `TUSHARE_TOKEN` is not read.
- Missing, stale, or conflicting data is marked partial/failed; old prices never impersonate current prices.
- Tencent batches contain at most 60 symbols and run with at most four concurrent requests.
- Twelve Data is budgeted at 8 credits per minute and 800 per day; Alpha Vantage is capped at 25 requests per day.
- All provider keys remain server-only in `.dev.vars` or hosted runtime secrets.
- OpenAI brief generation is billable and must not rerun for an already-complete date without explicit force.
- A-share red means up and green means down.

---

### Task 1: Tencent Quote Adapter

**Files:**
- Create: `lib/data/tencent.ts`
- Create: `tests/tencent.test.ts`

**Interfaces:**
- Produces: `toTencentCode(symbol: string): string`
- Produces: `mapTencentLine(line: string): Quote | null`
- Produces: `fetchTencentQuotes(symbols: string[], fetcher?: typeof fetch, options?: { batchSize?: number; concurrency?: number }): Promise<Quote[]>`

- [ ] **Step 1: Write failing mapping and batching tests**

```ts
expect(toTencentCode("600000.SH")).toBe("sh600000");
expect(toTencentCode("000001.SZ")).toBe("sz000001");
expect(toTencentCode("430047.BJ")).toBe("bj430047");
expect(mapTencentLine('v_sh600000="1~浦发银行~600000~10.10~10.00~10.01~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~20260723150000~1.00~10.20~9.90~10.10~0~0~100000000";')).toMatchObject({ symbol: "600000.SH", price: 10.1, previousClose: 10, pctChange: 1 });
```

Use a fake fetcher to record URLs for 121 symbols; assert request groups are `60, 60, 1` and active requests never exceed four.

- [ ] **Step 2: Run the focused test and verify missing-module failure**

Run: `npx vitest run tests/tencent.test.ts`

Expected: FAIL because `lib/data/tencent.ts` does not exist.

- [ ] **Step 3: Implement conversion, parsing, and bounded batches**

Parse Tencent `~` fields defensively, derive board and exchange from the code, calculate exchange limit prices from previous close, reject non-numeric/non-positive quotes, and never include raw response bodies in thrown errors.

- [ ] **Step 4: Run focused and full tests**

Run: `npx vitest run tests/tencent.test.ts && npm test`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/data/tencent.ts tests/tencent.test.ts
git commit -m "feat: add Tencent quote adapter"
```

### Task 2: Domestic Quality Reconciliation and Pipeline

**Files:**
- Create: `lib/data/quality.ts`
- Create: `lib/data/market-pipeline.ts`
- Create: `tests/quality.test.ts`
- Create: `tests/market-pipeline.test.ts`

**Interfaces:**
- Produces: `DataQualityStatus = "complete" | "partial" | "failed" | "demo"`
- Produces: `SourceAudit`, `MarketPipelineResult`
- Produces: `compareDomesticSnapshots(primary, secondary, expectedCount, now): SourceAudit[]`
- Produces: `runDomesticPipeline({ at, expectedSymbols, primary, secondary, now }): Promise<MarketPipelineResult>`

- [ ] **Step 1: Write failing threshold tests**

Create fixed quote arrays and assert:

```ts
expect(compareDomesticSnapshots(primary, secondary, 100, now).summary.status).toBe("complete");
expect(compareDomesticSnapshots(primary, secondary.slice(0, 80), 100, now).summary.status).toBe("partial");
expect(compareDomesticSnapshots([], [], 100, now).summary.status).toBe("failed");
```

Also assert price disagreement above `max(0.01, previousClose * 0.0015)`, direction agreement below 98%, and breadth difference above `max(30, expectedCount * 0.01)` prevent `complete`.

- [ ] **Step 2: Verify quality tests fail**

Run: `npx vitest run tests/quality.test.ts`

Expected: FAIL because `lib/data/quality.ts` does not exist.

- [ ] **Step 3: Implement pure quality functions**

Normalize symbols, remove ST/invalid quotes, compute coverage, direction match, price anomalies, and breadth difference. Return a summary plus one audit per source without logging provider payloads.

- [ ] **Step 4: Write failing pipeline fallback tests**

Assert the pipeline uses Eastmoney quotes for business metrics when both sources pass, returns Tencent as `partial` when primary fails but a cached symbol list is present, and returns `failed` with an empty quote array when both fail.

- [ ] **Step 5: Verify pipeline tests fail**

Run: `npx vitest run tests/market-pipeline.test.ts`

Expected: FAIL because `lib/data/market-pipeline.ts` does not exist.

- [ ] **Step 6: Implement retry and source selection**

Use existing `withRetry`, retry each source twice, call Tencent only with `expectedSymbols` or the current primary symbol list, and return `{ quotes, source, status, message, audits }`.

- [ ] **Step 7: Run focused and full tests, then commit**

Run: `npx vitest run tests/quality.test.ts tests/market-pipeline.test.ts && npm test`

```bash
git add lib/data/quality.ts lib/data/market-pipeline.ts tests/quality.test.ts tests/market-pipeline.test.ts
git commit -m "feat: reconcile domestic market sources"
```

### Task 3: Global Providers and Reconciliation

**Files:**
- Create: `lib/data/global/types.ts`
- Create: `lib/data/global/twelve-data.ts`
- Create: `lib/data/global/alpha-vantage.ts`
- Create: `lib/data/global/fred.ts`
- Create: `lib/data/global/eia.ts`
- Create: `lib/data/global/reconcile.ts`
- Create: `tests/global-data.test.ts`

**Interfaces:**
- Produces: `GlobalPoint { key, label, provider, value, previousClose, pctChange, marketTime, receivedAt, period, status, message }`
- Produces: `fetchTwelveDataQuotes(instruments, apiKey, fetcher): Promise<GlobalPoint[]>`
- Produces: `fetchAlphaVantageQuote(instrument, apiKey, fetcher): Promise<GlobalPoint | null>`
- Produces: `fetchFredSeries(series, apiKey, fetcher): Promise<GlobalPoint | null>`
- Produces: `fetchEiaSeries(series, apiKey, fetcher): Promise<GlobalPoint | null>`
- Produces: `reconcileGlobalPoints(points): ReconciledGlobalPoint[]`

- [ ] **Step 1: Write failing provider mapping tests**

Use official response-shaped fixtures. Verify Twelve Data batch results, Alpha Vantage global quote fields, FRED latest non-dot observation, EIA latest row, and missing-key results return a controlled `unconfigured` state without exposing keys.

- [ ] **Step 2: Verify provider tests fail**

Run: `npx vitest run tests/global-data.test.ts`

Expected: FAIL because the global modules do not exist.

- [ ] **Step 3: Implement provider adapters**

Each adapter accepts an injected fetcher, uses `encodeURIComponent`, checks HTTP status, validates dates/numbers, and throws only provider/status messages. Twelve Data accepts at most eight symbols in one call; Alpha Vantage is invoked only for a supplied instrument.

- [ ] **Step 4: Write failing reconciliation tests**

Assert same-date points within 0.2% become `cross-checked`, conflicting or different-date points become `partial`, and FRED/EIA points replace aggregator macro values while preserving both provider records for audit.

- [ ] **Step 5: Implement reconciliation and quota-aware orchestration**

Define the fixed morning instrument registry and an orchestration function that requests Twelve Data once, uses Alpha Vantage only for missing/selected validation instruments, and fetches FRED/EIA once each.

- [ ] **Step 6: Run focused and full tests, then commit**

Run: `npx vitest run tests/global-data.test.ts && npm test`

```bash
git add lib/data/global tests/global-data.test.ts
git commit -m "feat: add global overnight data layer"
```

### Task 4: Persistence, Jobs, and Protected API

**Files:**
- Modify: `db/schema.ts`
- Create: `drizzle/0002_market_source_audits.sql`
- Modify: `lib/jobs/runner.ts`
- Modify: `lib/data/repository.ts`
- Modify: `lib/ai/morning-brief.ts`
- Create: `app/api/v1/global/[date]/route.ts`
- Modify: `app/api/v1/data-health/route.ts`
- Modify: `tests/runner.test.ts`
- Modify: `tests/morning-brief.test.ts`
- Create: `tests/repository-health.test.ts`

**Interfaces:**
- Persists `market_source_audits` and `global_market_snapshots` using upserts.
- Extends `PanLayerEnv` with `TWELVE_DATA_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `FRED_API_KEY`, and `EIA_API_KEY` only.
- Extends `generateMorningBrief` with optional `globalSnapshot` structured context.
- Produces protected `GET /api/v1/global/:date`.

- [ ] **Step 1: Write failing schema/job tests**

Assert the schema exports both new tables, the runner source contains no Tushare reference, repeated audit/snapshot writes target unique keys, and an existing complete morning brief is skipped unless `force` is true.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run tests/runner.test.ts tests/repository-health.test.ts`

- [ ] **Step 3: Add D1 tables and repository readers**

Add exact columns from the approved design with primary keys `(trade_date, snapshot_time, source)` and `(trade_date, symbol, provider)`. `readDataHealth()` returns `{ status, lastRun, jobs, domestic, global, macro, ai }`.

- [ ] **Step 4: Write failing brief-context test**

Capture the Responses API body and assert the system input includes serialized global points, instructs the model to use those points for numeric claims, and never includes any API key.

- [ ] **Step 5: Update runner and morning brief generator**

Breadth and close-review jobs call the domestic pipeline and persist audits. Morning-brief calls the global layer first, persists every provider point, injects reconciled values into the prompt, then saves the five-section brief. If OpenAI is unconfigured, mark AI failed while keeping the global snapshot.

- [ ] **Step 6: Add protected global API and run tests**

Run: `npx vitest run tests/runner.test.ts tests/morning-brief.test.ts tests/repository-health.test.ts && npm test`

- [ ] **Step 7: Generate migration and commit**

Run: `npm run db:generate`

```bash
git add db/schema.ts drizzle lib/jobs/runner.ts lib/data/repository.ts lib/ai/morning-brief.ts app/api/v1/global app/api/v1/data-health tests
git commit -m "feat: persist audited domestic and global data"
```

### Task 5: Data Health UI and Runtime Configuration

**Files:**
- Modify: `lib/domain/types.ts`
- Modify: `lib/data/demo.ts`
- Modify: `app/components/Dashboard.tsx`
- Modify: `app/globals.css`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- `DailyReview.status` remains `complete | partial | failed | demo`.
- Dashboard renders source, market/update time, and an explicit Chinese status label.
- Runtime secrets are documented but never rendered.

- [ ] **Step 1: Write failing rendered UI assertions**

Require `数据来源`, `更新时间`, `完整`, `部分`, `失败`, and `演示` labels in the server-rendered dashboard, and assert no environment-key names or secret-looking values appear in HTML.

- [ ] **Step 2: Build and verify the rendered test fails**

Run: `npm run test:render`

- [ ] **Step 3: Implement truthful state labels and configuration docs**

Map all four statuses, never label `partial` as normal, and document Sites runtime secret names plus free-tier budgets. Keep `.openai/hosting.json` free of secrets.

- [ ] **Step 4: Run rendered and full verification**

Run: `npm run test:render && npm test && npm run lint && npm run build`

- [ ] **Step 5: Commit**

```bash
git add lib/domain/types.ts lib/data/demo.ts app/components/Dashboard.tsx app/globals.css .env.example README.md tests/rendered-html.test.mjs
git commit -m "feat: show audited data health states"
```

### Task 6: Final Security and Local Acceptance

**Files:**
- Verify only; modify tests if a real uncovered regression is found by first writing a failing test.

- [ ] **Step 1: Scan tracked files for forbidden secrets and Tushare runtime dependencies**

Run: `git grep -nE 'TUSHARE_TOKEN|5186c8b4|api[_-]?key[=:][^[:space:]]+' -- ':!docs/superpowers/**' ':!.env.example'`

Expected: no secret or Tushare runtime match.

- [ ] **Step 2: Run full automated verification**

Run: `npm test && npm run lint && npm run test:render && npm run build`

Expected: all commands exit 0.

- [ ] **Step 3: Verify local protected pages and APIs**

With the existing local server, verify `/dashboard`, `/api/v1/data-health`, and an invalid `/api/v1/global/not-a-date` request. Confirm dashboard remains usable when all optional global keys are absent and clearly reports unconfigured/partial data.

- [ ] **Step 4: Review spec coverage and commit any final test-backed correction**

Run: `git status --short && git diff --check && git log --oneline -8`

Expected: clean whitespace checks and implementation commits visible.
