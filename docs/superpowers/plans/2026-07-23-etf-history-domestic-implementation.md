# PanLayer ETF Workspace, History Table, and Domestic Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the confirmed B-layout ETF terminal with complete asset categories, four K-line periods, sortable frozen history tables, and a Docker/PostgreSQL-compatible domestic runtime.

**Architecture:** Keep the existing React/TypeScript UI and market-provider boundary, then add pure ETF taxonomy, sorting, K-line aggregation, and history query modules behind protected APIs. Split the current monolithic dashboard into focused ETF and history components. Preserve Cloudflare compatibility while adding a PostgreSQL repository, password authentication, Docker packaging, and a cron entrypoint for mainland deployment.

**Tech Stack:** React 19, TypeScript 5.9, vinext/Next-compatible routes, Tailwind CSS 4, Recharts, lightweight-charts, Vitest, PostgreSQL, postgres.js, Docker.

## Global Constraints

- ETF coverage includes domestic industry/theme, cross-border index, commodity, bond, and money-market products.
- ETF selection updates a persistent right-side chart with minute, day, week, and month periods plus forward adjustment.
- ETF and history tables use server-side allowlisted sorting and cursor pagination.
- History table freezes the header and date column and shows 10–12 rows before vertical scrolling.
- Missing live data is shown as unavailable; cached old data must not impersonate current data.
- A-share red means up and green means down.
- Private use only; no trading, positions, public registration, subscription, or investment advice.

---

### Task 1: ETF Taxonomy, Filtering, and Sorting

**Files:**
- Create: `lib/etf/catalog.ts`
- Create: `tests/etf-catalog.test.ts`
- Modify: `lib/data/provider.ts`

**Interfaces:**
- Produces: `classifyEtf(name: string): { category: EtfCategory; tags: string[] }`
- Produces: `queryEtfs(items: EtfSnapshot[], query: EtfQuery): EtfPage`
- Extends `EtfSnapshot` with `exchange`, `tags`, `turnoverRate`, `averageAmount20`, `status`, and `updatedAt`.

- [ ] **Step 1: Write failing taxonomy and sorting tests**

```ts
expect(classifyEtf("医美ETF")).toMatchObject({ category: "医药医疗", tags: expect.arrayContaining(["医美", "美容护理"]) });
expect(classifyEtf("纳指ETF").category).toBe("海外指数");
expect(queryEtfs(items, { sort: "averageAmount20", order: "desc", limit: 2 }).items.map(i => i.symbol)).toEqual(["B", "A"]);
```

- [ ] **Step 2: Run the test and verify missing-module failure**

Run: `npx vitest run tests/etf-catalog.test.ts`  
Expected: FAIL because `lib/etf/catalog.ts` does not exist.

- [ ] **Step 3: Implement the category rules and allowlisted sorting**

```ts
export const ETF_SORT_FIELDS = ["price", "pctChange", "amount", "averageAmount20", "scale", "turnoverRate"] as const;
export function queryEtfs(items: EtfSnapshot[], query: EtfQuery): EtfPage {
  const filtered = items.filter(item => matchesCategoryAndSearch(item, query));
  const field = ETF_SORT_FIELDS.includes(query.sort as EtfSortField) ? query.sort : "averageAmount20";
  const direction = query.order === "asc" ? 1 : -1;
  return pageByOffset(filtered.toSorted((a, b) => direction * compareNullable(a[field], b[field])), query);
}
```

- [ ] **Step 4: Run focused and full tests**

Run: `npx vitest run tests/etf-catalog.test.ts && npm test`  
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/etf/catalog.ts lib/data/provider.ts tests/etf-catalog.test.ts
git commit -m "feat: add ETF taxonomy and sorting"
```

### Task 2: K-Line Period Aggregation and Protected API

**Files:**
- Create: `lib/etf/bars.ts`
- Create: `app/api/v1/etfs/[symbol]/bars/route.ts`
- Create: `tests/etf-bars.test.ts`
- Modify: `lib/data/eastmoney.ts`

**Interfaces:**
- Produces: `aggregateBars(bars: MarketBar[], period: "week" | "month"): MarketBar[]`
- Produces: `GET /api/v1/etfs/:symbol/bars?period=minute|day|week|month&adjust=none|forward`

- [ ] **Step 1: Write failing aggregation tests**

```ts
expect(aggregateBars(twoWeeks, "week")).toEqual([
  { time: "2026-07-17", open: 1, high: 1.3, low: 0.9, close: 1.2, volume: 300, amount: 360 },
  { time: "2026-07-24", open: 1.2, high: 1.4, low: 1.1, close: 1.35, volume: 250, amount: 330 },
]);
```

- [ ] **Step 2: Run and verify the expected missing-function failure**

Run: `npx vitest run tests/etf-bars.test.ts`  
Expected: FAIL because `aggregateBars` is missing.

- [ ] **Step 3: Implement OHLCV aggregation and Eastmoney ETF bars**

```ts
const grouped = Map.groupBy(bars, bar => periodKey(bar.time, period));
return [...grouped.values()].map(group => ({
  time: group.at(-1)!.time,
  open: group[0].open,
  high: Math.max(...group.map(item => item.high)),
  low: Math.min(...group.map(item => item.low)),
  close: group.at(-1)!.close,
  volume: group.reduce((sum, item) => sum + item.volume, 0),
  amount: group.reduce((sum, item) => sum + item.amount, 0),
}));
```

- [ ] **Step 4: Add query validation and protected JSON response**

```ts
if (!BAR_PERIODS.includes(period)) return Response.json({ error: "invalid period" }, { status: 400 });
const bars = period === "minute" ? await provider.getIntradayBars(symbol) : await provider.getMarketBars(symbol, adjust);
return Response.json({ symbol, period, adjust, bars: aggregateIfNeeded(bars, period), source: provider.name });
```

- [ ] **Step 5: Run tests and build**

Run: `npx vitest run tests/etf-bars.test.ts && npm run build`  
Expected: tests and production build pass.

- [ ] **Step 6: Commit**

```bash
git add lib/etf/bars.ts lib/data/eastmoney.ts app/api/v1/etfs tests/etf-bars.test.ts
git commit -m "feat: add ETF K-line periods API"
```

### Task 3: ETF Query API and B-Layout Workspace

**Files:**
- Create: `app/api/v1/etfs/route.ts`
- Create: `app/api/v1/etfs/categories/route.ts`
- Create: `app/components/etf/EtfWorkspace.tsx`
- Create: `app/components/etf/EtfChart.tsx`
- Create: `app/components/etf/EtfTable.tsx`
- Modify: `app/components/Dashboard.tsx`
- Modify: `app/globals.css`
- Modify: `lib/data/demo.ts`
- Modify: `package.json`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: `queryEtfs`, category catalog, and bars API.
- Produces: `<EtfWorkspace initialEtfs={etfs} />` with category, table, sorting, and persistent chart state.

- [ ] **Step 1: Add failing rendered-output expectations**

```js
assert.match(html, /ETF 全品类/);
assert.match(html, /近20日均成交/);
assert.match(html, /分时/);
assert.match(html, /周K/);
assert.match(html, /月K/);
```

- [ ] **Step 2: Run render test and verify failure**

Run: `npm run test:render`  
Expected: FAIL because the new workspace labels are absent.

- [ ] **Step 3: Install and wrap lightweight-charts**

Run: `npm install lightweight-charts`  
Expected: package is added without audit errors that block installation.

```tsx
useEffect(() => {
  const chart = createChart(container.current!, chartOptions);
  const candles = chart.addSeries(CandlestickSeries, { upColor: "#ef5b58", downColor: "#3bc987" });
  candles.setData(bars);
  return () => chart.remove();
}, [bars]);
```

- [ ] **Step 4: Implement the category tree, sortable ETF table, and persistent chart**

```tsx
<EtfCategoryTree categories={categories} selected={category} onSelect={setCategory} />
<EtfTable items={items} sort={sort} order={order} onSort={cycleSort} onSelect={setSelected} />
<EtfChart symbol={selected.symbol} period={period} adjust={adjust} />
```

- [ ] **Step 5: Replace the existing ETF section and add responsive styles**

```tsx
<section id="etfs" className="dashboard-section scroll-mt-24">
  <SectionHeading eyebrow="ETF TERMINAL" title="ETF 专业工作台" description="全品类、可排序、四周期行情。" />
  <EtfWorkspace initialEtfs={etfs} />
</section>
```

- [ ] **Step 6: Run render, unit, lint, and build checks**

Run: `npm test && npm run lint && npm run test:render`  
Expected: all checks pass.

- [ ] **Step 7: Commit**

```bash
git add app/components/etf app/components/Dashboard.tsx app/globals.css app/api/v1/etfs lib/data/demo.ts package.json package-lock.json tests/rendered-html.test.mjs
git commit -m "feat: build ETF professional workspace"
```

### Task 4: Sortable History Query Contract

**Files:**
- Create: `lib/history/query.ts`
- Create: `tests/history-query.test.ts`
- Modify: `lib/data/repository.ts`
- Modify: `app/api/v1/history/route.ts`
- Modify: `db/schema.ts`

**Interfaces:**
- Produces: `HistoryRow`, `HistoryQuery`, `queryHistoryRows(rows, query)`.
- Produces: cursor-paged `/api/v1/history` response `{ items, nextCursor }`.

- [ ] **Step 1: Write failing allowlist, sorting, and cursor tests**

```ts
expect(parseHistoryQuery(new URLSearchParams("sort=limitUp&order=desc&limit=2"))).toMatchObject({ sort: "limitUp", order: "desc", limit: 2 });
expect(queryHistoryRows(rows, query).items.map(row => row.date)).toEqual(["2026-07-21", "2026-07-22"]);
expect(() => parseHistoryQuery(new URLSearchParams("sort=payload"))).toThrow("invalid history sort");
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/history-query.test.ts`  
Expected: FAIL because the query module is absent.

- [ ] **Step 3: Implement summary typing and pure query behavior**

```ts
export const HISTORY_SORT_FIELDS = ["date", "rising", "falling", "limitUp", "limitDown", "consecutive", "maxStreak", "openPremium", "closePremium", "high120", "allTimeHigh"] as const;
export function queryHistoryRows(rows: HistoryRow[], query: HistoryQuery): HistoryPage {
  const direction = query.order === "asc" ? 1 : -1;
  const filtered = query.sector ? rows.filter(row => row.topSector.includes(query.sector)) : rows;
  const sorted = filtered.toSorted((a, b) => compareNullable(a[query.sort], b[query.sort]) * direction);
  const items = sorted.slice(query.cursor, query.cursor + query.limit);
  const next = query.cursor + items.length;
  return { items, nextCursor: next < sorted.length ? next : null };
}
```

- [ ] **Step 4: Add structured history columns and repository SQL mapping**

```ts
await sql`ALTER TABLE daily_reviews ADD COLUMN IF NOT EXISTS rising integer`;
await sql`ALTER TABLE daily_reviews ADD COLUMN IF NOT EXISTS top_sector text`;
```

The route maps validated public sort names to fixed SQL column identifiers rather than interpolating raw input.

- [ ] **Step 5: Run focused and full tests**

Run: `npx vitest run tests/history-query.test.ts && npm test`  
Expected: all tests pass.

- [ ] **Step 6: Generate migrations and commit**

Run: `npm run db:generate`  
Expected: a migration adds the history summary columns.

```bash
git add lib/history lib/data/repository.ts app/api/v1/history db drizzle tests/history-query.test.ts
git commit -m "feat: add sortable history query contract"
```

### Task 5: Calendar and Frozen History Table

**Files:**
- Create: `app/components/history/HistoryWorkspace.tsx`
- Create: `app/components/history/HistoryCalendar.tsx`
- Create: `app/components/history/HistoryTable.tsx`
- Modify: `app/components/Dashboard.tsx`
- Modify: `app/globals.css`
- Modify: `lib/data/demo.ts`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: history API pages.
- Produces: calendar selection, sticky header/date column, sorting, sector filtering, and preserved scroll state.

- [ ] **Step 1: Add failing render expectations**

```js
assert.match(html, /历史数据表/);
assert.match(html, /120日新高/);
assert.match(html, /连板收盘溢价/);
assert.doesNotMatch(html, /市场情绪震荡修复/);
```

- [ ] **Step 2: Run and verify the old history card fails the test**

Run: `npm run test:render`  
Expected: FAIL on the new labels or old-card exclusion.

- [ ] **Step 3: Implement calendar-table synchronization and infinite loading**

```tsx
<HistoryCalendar dates={availableDates} selected={selectedDate} onSelect={scrollToDate} />
<HistoryTable rows={rows} sort={sort} order={order} onSort={cycleSort} onNearEnd={loadNextPage} />
```

- [ ] **Step 4: Add sticky and responsive CSS**

```css
.history-table thead { position: sticky; top: 0; z-index: 4; }
.history-table .history-date { position: sticky; left: 0; z-index: 3; background: #121314; }
.history-table-scroll { max-height: 620px; overflow: auto; }
```

- [ ] **Step 5: Run render, lint, and accessibility-oriented checks**

Run: `npm run lint && npm run test:render`  
Expected: checks pass and rendered HTML contains table headers and button labels.

- [ ] **Step 6: Commit**

```bash
git add app/components/history app/components/Dashboard.tsx app/globals.css lib/data/demo.ts tests/rendered-html.test.mjs
git commit -m "feat: add frozen historical review table"
```

### Task 6: New-High Stock Detail Drawer

**Files:**
- Create: `lib/history/high-details.ts`
- Create: `app/api/v1/history/[date]/highs/route.ts`
- Create: `app/components/history/HighDetailDrawer.tsx`
- Create: `tests/high-details.test.ts`
- Modify: `app/components/history/HistoryTable.tsx`
- Modify: `app/components/history/HistoryWorkspace.tsx`
- Modify: `app/globals.css`
- Modify: `lib/data/demo.ts`

**Interfaces:**
- Produces: `HighDetail`, `queryHighDetails(items, query)` and protected high-detail API.
- Produces: a 560px desktop drawer and full-screen mobile drawer with 120-day/all-time tabs.

- [ ] **Step 1: Write failing sorting and filtering tests**

```ts
expect(queryHighDetails(items, { type: "120d", query: "半导体", sort: "amount", order: "desc" }).map(item => item.symbol)).toEqual(["688001.SH"]);
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/high-details.test.ts`  
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the allowlisted detail query and demo/live contract**

```ts
export const HIGH_DETAIL_SORT_FIELDS = ["name", "pctChange", "amount", "intervalPct"] as const;
export function queryHighDetails(items: HighDetail[], query: HighDetailQuery) {
  const filtered = items.filter(item => item.type === query.type && `${item.name}${item.symbol}${item.sector}`.includes(query.query));
  return filtered.toSorted((a, b) => compare(a[query.sort], b[query.sort], query.order));
}
```

- [ ] **Step 4: Make the two history counts clickable and render the drawer**

```tsx
<button onClick={() => openHighs(row.date, "120d")}>{row.high120 ?? "暂缺"}</button>
<HighDetailDrawer state={drawer} onClose={closeDrawer} />
```

- [ ] **Step 5: Verify tests, render output, keyboard close, and responsive CSS**

Run: `npm test && npm run lint && npm run test:render`  
Expected: all checks pass and rendered HTML contains `查看120日新高股票`.

- [ ] **Step 6: Commit**

```bash
git add lib/history/high-details.ts app/api/v1/history app/components/history app/globals.css lib/data/demo.ts tests
git commit -m "feat: add new-high stock detail drawer"
```

### Task 7: PostgreSQL Repository, Private Password Auth, and Docker Runtime

**Files:**
- Create: `lib/storage/postgres.ts`
- Create: `lib/auth/private-session.ts`
- Create: `app/login/page.tsx`
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/auth/logout/route.ts`
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.env.docker.example`
- Create: `server/cron.ts`
- Create: `server/migrate.ts`
- Create: `db/postgres/001_initial.sql`
- Create: `tests/private-session.test.ts`
- Modify: `app/auth-guard.ts`
- Modify: `lib/data/repository.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Produces: `createPrivateSession`, `verifyPrivateSession`, and repository selection by `DATABASE_URL`.
- Produces: `docker compose up -d` deployment path with web, cron, and postgres services.

- [ ] **Step 1: Write failing signed-session tests**

```ts
const token = await createPrivateSession({ subject: "owner", secret: "0123456789abcdef0123456789abcdef", now: 1000 });
expect(await verifyPrivateSession(token, { secret, now: 1001 })).toMatchObject({ subject: "owner" });
expect(await verifyPrivateSession(`${token}x`, { secret, now: 1001 })).toBeNull();
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/private-session.test.ts`  
Expected: FAIL because the private-session module is missing.

- [ ] **Step 3: Implement Web Crypto HMAC sessions and password login**

```ts
const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
return `${base64url(payload)}.${base64url(signature)}`;
```

Login verifies `PANLAYER_PASSWORD_HASH` using `scrypt`-derived or pre-generated hash material, sets an HttpOnly, SameSite=Strict, Secure cookie, and never stores the plaintext password.

- [ ] **Step 4: Add PostgreSQL schema and repository selection**

```ts
export async function getRepository(): Promise<ReviewRepository> {
  return process.env.DATABASE_URL ? createPostgresRepository(process.env.DATABASE_URL) : createD1Repository(await getD1());
}
```

- [ ] **Step 5: Add Docker web, cron, and PostgreSQL services**

```yaml
services:
  postgres:
    image: postgres:17-alpine
  web:
    build: .
    command: npm run start
  cron:
    build: .
    command: npm run cron
```

- [ ] **Step 6: Document mainland deployment prerequisites**

README must list Node 22, Docker, domain/ICP filing, HTTPS reverse proxy, environment variables, migration, backup, and cron health-check commands.

- [ ] **Step 7: Run session, lint, build, and Docker configuration checks**

Run: `npx vitest run tests/private-session.test.ts && npm run lint && npm run build && docker compose config`  
Expected: all available checks pass; if Docker is unavailable, record that exact environmental limitation while keeping the config syntactically reviewable.

- [ ] **Step 8: Commit**

```bash
git add lib/storage lib/auth app/login app/api/auth app/auth-guard.ts lib/data/repository.ts Dockerfile docker-compose.yml .env.docker.example server db/postgres package.json package-lock.json README.md tests/private-session.test.ts
git commit -m "feat: add domestic private deployment runtime"
```

### Task 8: End-to-End Verification and Release Handoff

**Files:**
- Modify: `tests/rendered-html.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Verifies all interfaces from Tasks 1–6.

- [ ] **Step 1: Add rendered checks for the complete dashboard contract**

```js
assert.match(html, /ETF 专业工作台/);
assert.match(html, /历史数据表/);
assert.match(html, /仅供市场复盘，不构成投资建议/);
```

- [ ] **Step 2: Run the entire verification suite**

Run: `npm test && npm run lint && npm run db:generate && npm run build && npm run test:render`  
Expected: every command exits 0.

- [ ] **Step 3: Verify the current branch and working tree**

Run: `git status --short && git log --oneline -8`  
Expected: no unintended files; implementation commits are present.

- [ ] **Step 4: Commit final documentation or test adjustments**

```bash
git add README.md tests/rendered-html.test.mjs
git commit -m "test: verify ETF and history upgrade"
```

- [ ] **Step 5: Report deployment boundary**

Report the verified local/Docker result, the current private preview status, and the external items still required for mainland production: server, domain, ICP filing, HTTPS certificate, database password, private login hash, and AI provider key.
