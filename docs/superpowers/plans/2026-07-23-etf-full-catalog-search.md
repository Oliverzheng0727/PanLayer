# PanLayer ETF Full-Catalog Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the existing ETF workspace layout while replacing its 26-item demo-only search with full-market server search, preview, and account-scoped watchlist additions.

**Architecture:** The dashboard loads a small real catalog page for its initial render, while the existing search box debounces requests to `GET /api/v1/etfs`. Search results replace the visible table without changing the three-column layout; selecting a result previews its existing K-line panel, and submitting an exact six-digit code persists it through the existing account-scoped watchlist endpoint.

**Tech Stack:** React 19, TypeScript, Next/Vinext route handlers, Cloudflare D1, Vitest, Eastmoney market adapter.

## Global Constraints

- Preserve the existing ETF workspace layout and visual language.
- Keep watchlists isolated by authenticated user email.
- Production must not fall back to demo ETF values when a live request fails.
- ETF code and Chinese-name searches must both query the full server catalog.
- Existing minute/day/week/month K-line behavior remains unchanged.

---

### Task 1: Full-catalog query contract

**Files:**
- Modify: `lib/etf/catalog.ts`
- Test: `tests/etf-catalog.test.ts`

**Interfaces:**
- Consumes: `EtfSnapshot[]`, `EtfQuery`
- Produces: `queryEtfs(items, query)` with trimmed, case-insensitive name/code/tag matching and stable paging.

- [ ] **Step 1: Write failing tests** for whitespace-normalized Chinese-name and code-fragment lookup against more than the initial demo set.
- [ ] **Step 2: Run** `npm test -- tests/etf-catalog.test.ts` and confirm the new normalization test fails.
- [ ] **Step 3: Implement** normalized query matching without changing sort semantics.
- [ ] **Step 4: Re-run** the focused test and confirm it passes.

### Task 2: Live dashboard catalog and remote search

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify: `app/components/etf/EtfWorkspace.tsx`
- Create: `lib/etf/search.ts`
- Test: `tests/etf-search.test.ts`

**Interfaces:**
- Produces: `buildEtfSearchUrl({ query, category, sort, order, limit })`.
- Consumes: `GET /api/v1/etfs` response `{ items, total, nextCursor, source }`.

- [ ] **Step 1: Write failing URL-contract tests** covering encoded Chinese text, category, sort, order, and limit.
- [ ] **Step 2: Run** `npm test -- tests/etf-search.test.ts` and confirm failure because the helper is absent.
- [ ] **Step 3: Implement** the URL helper.
- [ ] **Step 4: Change dashboard loading** to request a real Eastmoney ETF catalog in production while retaining demo fixtures only in development.
- [ ] **Step 5: Add debounced remote search** to the existing input; keep the current local list while empty, show remote results while querying, and ignore stale responses.
- [ ] **Step 6: Preserve preview/add behavior** so row selection updates K-line and an exact code can be persisted to the current user's watchlist.
- [ ] **Step 7: Run focused tests** and confirm they pass.

### Task 3: Dynamic categories and failure states

**Files:**
- Modify: `app/api/v1/etfs/categories/route.ts`
- Modify: `app/components/etf/EtfWorkspace.tsx`
- Test: `tests/etf-categories.test.ts`

**Interfaces:**
- Produces: category counts from live catalog in production and explicit `502` with no fake values when unavailable.

- [ ] **Step 1: Write failing tests** for live category aggregation and zero-demo production failure behavior.
- [ ] **Step 2: Run** the focused test and confirm expected failure.
- [ ] **Step 3: Replace demo-only category aggregation** with a reusable aggregation function and live provider route.
- [ ] **Step 4: Keep search failures visible** without discarding already loaded rows.
- [ ] **Step 5: Run focused tests** and confirm they pass.

### Task 4: Full verification

**Files:**
- Modify only if verification exposes a defect in this feature.

- [ ] **Step 1:** Run `npm test`.
- [ ] **Step 2:** Run `npm run lint`.
- [ ] **Step 3:** Run `npm run build`.
- [ ] **Step 4:** Inspect `git diff --check` and the final diff for unintended layout/content changes.
