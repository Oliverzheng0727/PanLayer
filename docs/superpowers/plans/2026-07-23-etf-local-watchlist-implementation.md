# ETF Local Watchlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the user to enter a six-digit ETF code, validate it online, and retain it in a browser-local “我的自选” category with removal and full K-line support.

**Architecture:** Keep persistence isolated in a pure local-storage codec that stores symbols only. Add a protected exact-lookup API that filters the current ETF market directory, then let `EtfWorkspace` hydrate saved symbols, merge fresh snapshots for display, and reuse the existing table/chart components.

**Tech Stack:** React 19, TypeScript, Vitest, vinext API routes, browser localStorage, existing Eastmoney market adapter, lightweight-charts.

## Global Constraints

- Browser storage contains ETF symbols only; cached prices must never be presented as current prices.
- The lookup endpoint accepts at most 50 unique six-digit symbols.
- Invalid, duplicate, non-ETF, network-failure, and storage-failure states require distinct Chinese feedback.
- The feature does not call OpenAI or perform general web search.
- Existing ETF category, sorting, and minute/day/week/month chart behavior must remain unchanged.

---

### Task 1: Local Watchlist Codec

**Files:**
- Create: `lib/etf/watchlist.ts`
- Create: `tests/etf-watchlist.test.ts`

**Interfaces:**
- Produces: `WATCHLIST_STORAGE_KEY`, `normalizeEtfSymbol(value)`, `parseWatchlist(raw)`, `serializeWatchlist(symbols)`, `addWatchlistSymbol(symbols, symbol)`, and `removeWatchlistSymbol(symbols, symbol)`.
- Consumes: no browser globals; this module remains pure and independently testable.

- [ ] **Step 1: Write the failing codec tests**

```ts
import { describe, expect, it } from "vitest";
import { addWatchlistSymbol, normalizeEtfSymbol, parseWatchlist, removeWatchlistSymbol, serializeWatchlist } from "../lib/etf/watchlist";

describe("ETF local watchlist", () => {
  it("accepts only six digit symbols", () => {
    expect(normalizeEtfSymbol(" 510300 ")).toBe("510300");
    expect(normalizeEtfSymbol("51030A")).toBeNull();
  });
  it("repairs malformed storage and removes duplicates", () => {
    expect(parseWatchlist('["510300","510300","159995","bad"]')).toEqual(["510300", "159995"]);
    expect(parseWatchlist("broken")).toEqual([]);
  });
  it("adds and removes without mutating the input", () => {
    const current = ["510300"];
    expect(addWatchlistSymbol(current, "159995")).toEqual(["510300", "159995"]);
    expect(removeWatchlistSymbol(current, "510300")).toEqual([]);
    expect(current).toEqual(["510300"]);
    expect(serializeWatchlist(["510300", "510300"])).toBe('["510300"]');
  });
});
```

- [ ] **Step 2: Verify the tests fail because the module is missing**

Run: `npx vitest run tests/etf-watchlist.test.ts`
Expected: FAIL because `lib/etf/watchlist.ts` does not exist.

- [ ] **Step 3: Implement the pure codec**

```ts
export const WATCHLIST_STORAGE_KEY = "panlayer.etf-watchlist.v1";

export const normalizeEtfSymbol = (value: string): string | null => {
  const symbol = value.trim();
  return /^\d{6}$/.test(symbol) ? symbol : null;
};

export function parseWatchlist(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? [...new Set(parsed.flatMap((value) => typeof value === "string" && normalizeEtfSymbol(value) ? [value.trim()] : []))].slice(0, 50) : [];
  } catch { return []; }
}

export const serializeWatchlist = (symbols: string[]) => JSON.stringify([...new Set(symbols.flatMap((value) => normalizeEtfSymbol(value) ? [value.trim()] : []))].slice(0, 50));
export const addWatchlistSymbol = (symbols: string[], symbol: string) => [...new Set([...symbols, symbol])].slice(0, 50);
export const removeWatchlistSymbol = (symbols: string[], symbol: string) => symbols.filter((item) => item !== symbol);
```

- [ ] **Step 4: Run the codec tests**

Run: `npx vitest run tests/etf-watchlist.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit the codec**

```bash
git add lib/etf/watchlist.ts tests/etf-watchlist.test.ts
git commit -m "feat: add ETF watchlist storage codec"
```

---

### Task 2: Exact ETF Lookup API

**Files:**
- Modify: `lib/etf/watchlist.ts`
- Modify: `tests/etf-watchlist.test.ts`
- Create: `app/api/v1/etfs/lookup/route.ts`

**Interfaces:**
- Consumes: `createEastmoneyProvider().getEtfs(date)` and `normalizeEtfSymbol` from Task 1.
- Produces: `findEtfsBySymbols(items, symbols): { items: EtfSnapshot[]; missing: string[] }` and `GET /api/v1/etfs/lookup?symbols=510300,159995`.

- [ ] **Step 1: Add a failing exact-match test**

```ts
it("returns requested ETFs in request order and reports missing symbols", () => {
  const items = [snapshot("159995"), snapshot("510300")];
  expect(findEtfsBySymbols(items, ["510300", "000001", "159995"])).toEqual({
    items: [snapshot("510300"), snapshot("159995")],
    missing: ["000001"],
  });
});
```

Use this deterministic helper above the test:

```ts
const snapshot = (symbol: string): EtfSnapshot => ({
  symbol, name: `${symbol} ETF`, category: "宽基指数", tags: ["宽基"], exchange: symbol.startsWith("5") ? "SH" : "SZ",
  price: 1, pctChange: 0, amount: 1, averageAmount20: 1, scale: 1, turnoverRate: 1,
  status: "active", updatedAt: "2026-07-23 15:00",
});
```

- [ ] **Step 2: Run the lookup test and confirm RED**

Run: `npx vitest run tests/etf-watchlist.test.ts`
Expected: FAIL because `findEtfsBySymbols` is not exported.

- [ ] **Step 3: Implement exact matching and the protected route**

```ts
export function findEtfsBySymbols(items: EtfSnapshot[], symbols: string[]) {
  const bySymbol = new Map(items.map((item) => [item.symbol, item]));
  return {
    items: symbols.flatMap((symbol) => bySymbol.has(symbol) ? [bySymbol.get(symbol)!] : []),
    missing: symbols.filter((symbol) => !bySymbol.has(symbol)),
  };
}
```

The route must authorize with `authorizeApi()`, split the `symbols` query on commas, normalize and deduplicate it, reject zero or more than 50 symbols with status 400, load the current ETF directory from `createEastmoneyProvider().getEtfs()`, call `findEtfsBySymbols`, and return `{ items, missing, source: "东方财富", status: missing.length ? "partial" : "complete" }`. On provider failure return status 502 with empty `items`, the requested codes in `missing`, and `status: "failed"`.

```ts
import { authorizeApi } from "../../../../auth-guard";
import { createEastmoneyProvider } from "../../../../../lib/data/eastmoney";
import { findEtfsBySymbols, normalizeEtfSymbol } from "../../../../../lib/etf/watchlist";

export async function GET(request: Request) {
  const denied = await authorizeApi();
  if (denied) return denied;
  const values = (new URL(request.url).searchParams.get("symbols") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!values.length || values.length > 50 || values.some((value) => !normalizeEtfSymbol(value))) {
    return Response.json({ error: "symbols must contain 1-50 six-digit ETF codes" }, { status: 400 });
  }
  const symbols = [...new Set(values)];
  try {
    const directory = await createEastmoneyProvider().getEtfs(new Date().toISOString().slice(0, 10));
    const result = findEtfsBySymbols(directory, symbols);
    return Response.json({ ...result, source: "东方财富", status: result.missing.length ? "partial" : "complete" });
  } catch (error) {
    return Response.json({ items: [], missing: symbols, source: "东方财富", status: "failed", error: error instanceof Error ? error.message : "ETF lookup failed" }, { status: 502 });
  }
}
```

- [ ] **Step 4: Verify lookup tests and type checking**

Run: `npx vitest run tests/etf-watchlist.test.ts && npm run lint`
Expected: all watchlist tests PASS and ESLint exits 0.

- [ ] **Step 5: Commit the lookup API**

```bash
git add lib/etf/watchlist.ts tests/etf-watchlist.test.ts app/api/v1/etfs/lookup/route.ts
git commit -m "feat: add exact ETF lookup API"
```

---

### Task 3: Watchlist Input and Workspace Integration

**Files:**
- Create: `app/components/etf/EtfWatchlistInput.tsx`
- Modify: `app/components/etf/EtfWorkspace.tsx`
- Modify: `app/components/etf/EtfTable.tsx`
- Modify: `lib/etf/catalog.ts`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: Task 1 storage functions and Task 2 lookup response `{ items, missing, source, status }`.
- Produces: “我的自选” category, add/remove controls, and fresh `EtfSnapshot` values reused by `EtfTable` and `EtfChart`.

- [ ] **Step 1: Add failing server-render and category tests**

Add `"我的自选"` to the expected `ETF_CATEGORIES` order before `"全部"`, and add these rendered HTML assertions:

```js
assert.match(html, /输入6位 ETF 代码/);
assert.match(html, /加入自选/);
assert.match(html, /ETF 全品类[\s\S]*我的自选[\s\S]*全部/);
```

Run: `npx vitest run tests/etf-catalog.test.ts && npm run test:render`
Expected: FAIL because the category and controls do not exist.

- [ ] **Step 2: Implement `EtfWatchlistInput`**

The component accepts this exact result union and maps it to fixed Chinese feedback:

```tsx
"use client";
import { Plus } from "lucide-react";
import { useState } from "react";

export type WatchlistAddResult = "added" | "duplicate" | "missing" | "invalid" | "network-failed" | "storage-failed";
const messages: Record<WatchlistAddResult, string> = {
  added: "已加入我的自选", duplicate: "该 ETF 已在自选中", missing: "未找到有效 ETF",
  invalid: "请输入6位 ETF 代码", "network-failed": "行情查询失败，请稍后重试",
  "storage-failed": "本地保存失败，刷新后可能丢失",
};

export function EtfWatchlistInput({ onAdd }: { onAdd: (symbol: string) => Promise<WatchlistAddResult> }) {
  const [symbol, setSymbol] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const submit = async () => {
    if (loading) return;
    setLoading(true);
    try { const result = await onAdd(symbol); setFeedback(messages[result]); if (result === "added") setSymbol(""); }
    finally { setLoading(false); }
  };
  return <div className="etf-watchlist-input"><label><input inputMode="numeric" maxLength={6} value={symbol} onChange={(event) => setSymbol(event.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} placeholder="输入6位 ETF 代码" /></label><button type="button" disabled={loading} onClick={() => void submit()}><Plus size={12} />{loading ? "查询中" : "加入自选"}</button>{feedback && <span className="etf-watchlist-feedback" role="status">{feedback}</span>}</div>;
}
```

- [ ] **Step 3: Hydrate and persist in `EtfWorkspace`**

On mount, read `WATCHLIST_STORAGE_KEY`, parse symbols, then request `/api/v1/etfs/lookup?symbols=${symbols.join(",")}`. Keep separate `watchlistSymbols` and fresh `watchlistItems` state. Adding first validates through the same endpoint, writes the symbol list to localStorage, switches to `我的自选`, and selects the added symbol. Removing writes the remaining symbols, removes only the watchlist snapshot, and leaves matching system entries available in `全部` and industry categories.

Use a shared loader with this response shape:

```ts
type LookupPayload = { items?: EtfSnapshot[]; missing?: string[]; status?: "complete" | "partial" | "failed" };
const lookupEtfs = async (symbols: string[]) => {
  const response = await fetch(`/api/v1/etfs/lookup?symbols=${encodeURIComponent(symbols.join(","))}`);
  if (!response.ok) throw new Error("lookup failed");
  return response.json() as Promise<LookupPayload>;
};
```

The add handler must normalize before requesting, return `duplicate` before network access, return `missing` when no item matches, persist with `localStorage.setItem(WATCHLIST_STORAGE_KEY, serializeWatchlist(nextSymbols))`, and return `storage-failed` only when that write throws. The remove handler uses `removeWatchlistSymbol`, persists the result, filters `watchlistItems`, and keeps `initialEtfs` unchanged.

For query input, use `category === "我的自选" ? watchlistItems : initialEtfs`; do not merge user entries into the system list. Category counts must report `watchlistSymbols.length` for “我的自选”.

- [ ] **Step 4: Add a remove action to the ETF table**

Add optional props `watchlist?: boolean` and `onRemove?: (symbol: string) => void`. In watchlist mode render a final `操作` column with a `移除` button. The button must stop row propagation and call `onRemove(item.symbol)`; all other categories keep the current table unchanged.

- [ ] **Step 5: Style and verify the interaction**

Add compact styles for `.etf-watchlist-input`, `.etf-watchlist-feedback`, and `.etf-watchlist-remove`. At 760px and below, the input becomes a full-width row above the ETF list. Run:

```bash
npm test
npm run lint
npm run build
npm run test:render
```

Expected: all unit and render tests PASS; the build completes with no errors.

- [ ] **Step 6: Commit the workspace integration**

```bash
git add app/components/etf/EtfWatchlistInput.tsx app/components/etf/EtfWorkspace.tsx app/components/etf/EtfTable.tsx lib/etf/catalog.ts app/globals.css tests/rendered-html.test.mjs tests/etf-catalog.test.ts
git commit -m "feat: add local ETF watchlist controls"
```

---

### Task 4: Browser Acceptance Check

**Files:**
- Modify only files from Tasks 1-3 if verification exposes a defect.

**Interfaces:**
- Consumes: the complete local watchlist flow.
- Produces: verified local behavior at `http://localhost:3000/dashboard`.

- [ ] **Step 1: Verify a valid ETF**

At an 820px viewport, enter `510300`, submit, and verify that “我的自选” count becomes 1, the row is selected, and the K-line remains 500px high.

- [ ] **Step 2: Verify persistence and duplicate handling**

Reload the page, confirm `510300` remains in “我的自选” after an online refresh, submit it again, and confirm `该 ETF 已在自选中` without a duplicate row.

- [ ] **Step 3: Verify invalid, non-ETF, and remove behavior**

Submit `123`, submit a six-digit non-ETF code, confirm their distinct validation messages, then remove `510300` and verify it disappears from “我的自选” but remains in “全部”.

- [ ] **Step 4: Run the final verification suite**

Run: `npm test && npm run lint && npm run build && npm run test:render && git diff --check`
Expected: all tests and builds pass and `git diff --check` prints no output.

- [ ] **Step 5: Commit any acceptance-only fixes**

If verification required changes, stage only those files and commit with `git commit -m "fix: harden ETF watchlist interaction"`. If no changes were required, do not create an empty commit.
