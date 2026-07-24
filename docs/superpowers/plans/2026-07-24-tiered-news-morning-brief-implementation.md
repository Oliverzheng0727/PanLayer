# PanLayer Tiered News Morning Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 06:50 tier-1 RSS collection, a 06:55 verified tier-2 Firecrawl gap-fill, and a 07:15 Qwen generation path that consumes the persisted source bundle.

**Architecture:** A focused news-intake package owns configuration, parsing, normalization, D1 persistence, collection, gap detection, and bundle selection. Scheduled jobs populate D1 before the existing morning-brief runner reads the current Beijing-date bundle and gives Qwen a closed, source-ID-addressable context. Existing structured market snapshots remain the only permitted market-number source.

**Tech Stack:** TypeScript 5.9, Cloudflare Workers/D1/Cron, Vitest, Qwen DashScope, Firecrawl Search, existing vinext/React application.

## Global Constraints

- Keep the current PanLayer page structure and five-section brief contract.
- Tier 1 runs at Beijing 06:50; tier 2 runs at Beijing 06:55; Qwen runs at Beijing 07:15.
- Use at most 6 items per RSS source, a 15-second source timeout, and a 7-day publication window.
- Tier 1 always outranks tier 2.
- An unofficial tier-2 fact requires two independent sources; unverified tier-2 items never enter Qwen input.
- RSS, Firecrawl, and Qwen must not create or repair structured market numbers.
- Current-day jobs never present a previous-day collection as current.
- Missing or unverifiable information displays as unavailable/partial rather than a fabricated zero or stale value.
- Preserve unrelated untracked files in the working tree.

---

### Task 1: Source Catalog, Types, RSS Parser, and Normalizer

**Files:**
- Create: `config/tier1-rss-sources.json`
- Create: `lib/ai/news-intake/types.ts`
- Create: `lib/ai/news-intake/config.ts`
- Create: `lib/ai/news-intake/parser.ts`
- Create: `lib/ai/news-intake/normalizer.ts`
- Test: `tests/news-intake-parser.test.ts`
- Test: `tests/news-intake-normalizer.test.ts`

**Interfaces:**
- Produces: `loadTier1NewsConfig(): Tier1NewsConfig`
- Produces: `parseFeedXml(xml: string): ParsedFeedItem[]`
- Produces: `normalizeFeedItems(input: NormalizeFeedInput): NormalizedNewsItem[]`
- Produces: `canonicalizeNewsUrl(value: string): string | null`

- [ ] **Step 1: Write failing parser and normalizer tests**

```ts
expect(parseFeedXml(rssXml)[0]).toMatchObject({
  title: "存储价格上调",
  url: "https://example.com/a?utm_source=x",
});
expect(parseFeedXml(atomXml)[0].url).toBe("https://example.com/b");
expect(canonicalizeNewsUrl("https://EXAMPLE.com/a?utm_source=x#top"))
  .toBe("https://example.com/a");
expect(normalizeFeedItems(input)).toHaveLength(1);
```

- [ ] **Step 2: Run tests and confirm missing-module failure**

Run: `npx vitest run tests/news-intake-parser.test.ts tests/news-intake-normalizer.test.ts`

Expected: FAIL because `lib/ai/news-intake/*` does not exist.

- [ ] **Step 3: Add the exact typed model**

```ts
export type NewsTier = 1 | 2;
export type NewsVerification = "verified" | "unverified" | "filtered";

export interface NormalizedNewsItem {
  id: string;
  canonicalUrl: string;
  title: string;
  excerpt: string | null;
  publishedAt: string | null;
  receivedAt: string;
  fetchDate: string;
  sourceIds: string[];
  sourceNames: string[];
  industries: string[];
  tier: NewsTier;
  verification: NewsVerification;
  corroboratingUrls: string[];
  filterReason: string | null;
}
```

- [ ] **Step 4: Implement dependency-free RSS/Atom parsing and deterministic normalization**

Use XML text extraction for RSS/RDF/Atom fields, decode standard XML entities, prefer Atom `link[rel=alternate]`, strip tracking parameters, reject non-HTTP(S), merge duplicate URLs, remove near-duplicate titles with normalized character n-grams, and filter title+excerpt against the configured redline list.

- [ ] **Step 5: Add the user-provided 12-industry source catalog**

Copy the attachment into `config/tier1-rss-sources.json` unchanged except for a top-level schema version. `loadTier1NewsConfig()` must validate unique source IDs derived from normalized URLs and merge duplicate URLs across industries.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run tests/news-intake-parser.test.ts tests/news-intake-normalizer.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add config/tier1-rss-sources.json lib/ai/news-intake tests/news-intake-parser.test.ts tests/news-intake-normalizer.test.ts
git commit -m "feat: add curated RSS intake primitives"
```

### Task 2: D1 Repository and Tier-1 Collector

**Files:**
- Create: `lib/ai/news-intake/repository.ts`
- Create: `lib/ai/news-intake/collector.ts`
- Test: `tests/news-intake-repository.test.ts`
- Test: `tests/news-intake-collector.test.ts`
- Modify: `lib/jobs/runner.ts`

**Interfaces:**
- Consumes: `Tier1NewsConfig`, `NormalizedNewsItem`
- Produces: `ensureNewsIntakeSchema(db: D1Database): Promise<void>`
- Produces: `collectTier1News(input: CollectTier1Input): Promise<NewsCollectionSummary>`
- Produces: `readCurrentNewsBundle(db, fetchDate): Promise<NewsBundle>`

- [ ] **Step 1: Write failing repository tests**

```ts
await writeNewsItems(db, [item]);
await writeNewsItems(db, [item]);
expect(db.items).toHaveLength(1);
expect(await readCurrentNewsBundle(db, "2026-07-24"))
  .toMatchObject({ fetchDate: "2026-07-24", items: [item] });
```

- [ ] **Step 2: Write failing collector tests**

```ts
const result = await collectTier1News({
  date: "2026-07-24",
  config,
  fetcher,
  concurrency: 2,
});
expect(result.status).toBe("partial");
expect(result.sourceSuccess).toBe(1);
expect(result.items).toHaveLength(1);
```

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `npx vitest run tests/news-intake-repository.test.ts tests/news-intake-collector.test.ts`

Expected: FAIL because repository and collector are absent.

- [ ] **Step 4: Implement the three-table D1 repository**

Create `brief_sources`, `brief_items`, and `brief_fetch_runs` with the fields from the approved design. Use deterministic item IDs and `ON CONFLICT(fetch_date, canonical_url) DO UPDATE`. Read only the latest complete/partial run for the requested Beijing date.

- [ ] **Step 5: Implement bounded tier-1 collection**

The collector must:

```ts
const PER_SOURCE_LIMIT = 6;
const SOURCE_TIMEOUT_MS = 15_000;
const MAX_CONCURRENCY = 8;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
```

Retry transport errors, timeouts, and 5xx once; do not retry 4xx or parse failures. A failed source records health and does not reject the batch. Reject private/loopback hosts before fetch and reject a final non-HTTPS URL.

- [ ] **Step 6: Register runtime schema**

Call `ensureNewsIntakeSchema()` from `ensureRuntimeSchema()` or add equivalent statements to the existing schema batch so every scheduled/manual job can safely access the tables.

- [ ] **Step 7: Run focused tests**

Run: `npx vitest run tests/news-intake-repository.test.ts tests/news-intake-collector.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/ai/news-intake/repository.ts lib/ai/news-intake/collector.ts lib/jobs/runner.ts tests/news-intake-repository.test.ts tests/news-intake-collector.test.ts
git commit -m "feat: persist tier-1 news collections"
```

### Task 3: Tier-2 Gap Detection and Verification

**Files:**
- Create: `lib/ai/news-intake/tier2.ts`
- Modify: `lib/ai/firecrawl-brief-fallback.ts`
- Test: `tests/news-intake-tier2.test.ts`

**Interfaces:**
- Consumes: `NewsBundle`, `BriefSectionKey`, existing `searchFirecrawlBriefSources`
- Produces: `detectTier2Gaps(bundle: NewsBundle): Tier2Gap[]`
- Produces: `collectTier2News(input: CollectTier2Input): Promise<NewsCollectionSummary>`
- Produces: `verifyTier2Candidates(candidates): NormalizedNewsItem[]`

- [ ] **Step 1: Write failing gap and verification tests**

```ts
expect(detectTier2Gaps(bundle)).toContainEqual(
  expect.objectContaining({ sectionKey: "global-markets", requiredTerm: "美债" }),
);
expect(verifyTier2Candidates([unofficialSingle])).toEqual([]);
expect(verifyTier2Candidates([unofficialA, unofficialB])[0].verification)
  .toBe("verified");
expect(verifyTier2Candidates([official])[0].verification).toBe("verified");
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx vitest run tests/news-intake-tier2.test.ts`

Expected: FAIL because tier-2 functions do not exist.

- [ ] **Step 3: Implement deterministic gap detection**

Check each section’s required terms against tier-1 title+excerpt text and enforce minimum source diversity. Emit only missing terms/sections, capped at one query per section.

- [ ] **Step 4: Extend Firecrawl search with a fixed-query override**

Add `query?: string` and `limit?: number` to `SearchFirecrawlBriefSourcesInput`. Preserve current callers and sanitize queries to 500 characters.

- [ ] **Step 5: Implement verification**

Official/government/exchange/company-primary hosts verify directly. Other candidates verify only when two different registered domains produce the same normalized-event title cluster. Persist unverified candidates for diagnostics but exclude them from the Qwen bundle.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run tests/news-intake-tier2.test.ts tests/firecrawl-brief-fallback.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/ai/news-intake/tier2.ts lib/ai/firecrawl-brief-fallback.ts tests/news-intake-tier2.test.ts tests/firecrawl-brief-fallback.test.ts
git commit -m "feat: add verified tier-2 news enrichment"
```

### Task 4: Scheduling and Job Orchestration

**Files:**
- Modify: `lib/jobs/schedule.ts`
- Modify: `lib/jobs/runner.ts`
- Modify: `worker/index.ts`
- Modify: `vite.config.ts`
- Modify: `app/api/v1/admin/jobs/[job]/run/route.ts`
- Test: `tests/scheduler.test.ts`
- Test: `tests/runner.test.ts`
- Test: `tests/admin-route.test.ts`

**Interfaces:**
- Extends: `ScheduledJob` with `{ type: "tier1-rss-prefetch" } | { type: "tier2-news-prefetch" }`
- Extends: `runPanLayerJob()` for both new jobs

- [ ] **Step 1: Update failing schedule tests**

```ts
expect(jobForBeijingTime("06:50")).toEqual({ type: "tier1-rss-prefetch" });
expect(jobForBeijingTime("06:55")).toEqual({ type: "tier2-news-prefetch" });
expect(jobForBeijingTime("07:15")).toEqual({ type: "morning-brief" });
```

- [ ] **Step 2: Run schedule tests and confirm failure**

Run: `npx vitest run tests/scheduler.test.ts`

Expected: FAIL because 06:50/06:55 are currently bootstrap slots.

- [ ] **Step 3: Implement job mappings and cron triggers**

Add UTC cron expressions:

```ts
"50 22 * * 0-4",
"55 22 * * 0-4",
"15 23 * * 0-4",
```

Ensure the new exact times are matched before the generic 02:00–06:55 bootstrap range.

- [ ] **Step 4: Add runner branches and leases**

Tier 1 loads the validated catalog and calls `collectTier1News`. Tier 2 reads the same-date bundle, calls `detectTier2Gaps`, and returns complete without Firecrawl when there are no gaps. Both write `job_runs`, release leases, and return explicit counts.

- [ ] **Step 5: Add protected manual endpoints**

Map `/api/v1/admin/jobs/tier1-rss-prefetch/run` and `/api/v1/admin/jobs/tier2-news-prefetch/run` to the new jobs without changing authorization.

- [ ] **Step 6: Run focused scheduling/orchestration tests**

Run: `npx vitest run tests/scheduler.test.ts tests/runner.test.ts tests/admin-route.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/jobs/schedule.ts lib/jobs/runner.ts worker/index.ts vite.config.ts app/api/v1/admin/jobs/[job]/run/route.ts tests/scheduler.test.ts tests/runner.test.ts tests/admin-route.test.ts
git commit -m "feat: schedule tiered news prefetch"
```

### Task 5: Closed-Source Qwen Bundle Integration

**Files:**
- Create: `lib/ai/news-intake/bundle-selector.ts`
- Modify: `lib/ai/morning-brief-providers.ts`
- Modify: `lib/jobs/runner.ts`
- Test: `tests/news-bundle-selector.test.ts`
- Modify: `tests/morning-brief-providers.test.ts`
- Modify: `tests/morning-brief-runner.test.ts`

**Interfaces:**
- Produces: `selectBriefSourceBundle(bundle, key): BriefExternalSource[]`
- Extends: `generateQwenBriefSection()` to accept verified persisted sources using the existing `externalSources` contract

- [ ] **Step 1: Write failing selection tests**

```ts
const selected = selectBriefSourceBundle(bundle, "industry");
expect(selected.every((item) => item.verification === "verified")).toBe(true);
expect(selected.find((item) => item.tier === 1)).toBeDefined();
expect(selected.filter((item) => item.tier === 2)).toHaveLength(6);
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx vitest run tests/news-bundle-selector.test.ts`

Expected: FAIL because the selector is absent.

- [ ] **Step 3: Implement tier-aware selection**

Select up to 12 tier-1 and 6 verified tier-2 items per section. Rank tier 1 first, then verification, publication time, required-term relevance, source diversity, and event uniqueness. Cap each item at 900 characters.

- [ ] **Step 4: Change Qwen’s default generation input**

When a persisted bundle contains usable sources, pass it as `externalSources` so the existing prompt disables autonomous search and enforces local source IDs. If a section has no usable bundle, keep current provider behavior and mark the collection status in the job message.

- [ ] **Step 5: Keep targeted recovery module-scoped**

On Qwen validation failure, reuse the same section bundle first. Only after a second failed module validation may the current Firecrawl fallback search the missing section, and successful sections must remain persisted.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run tests/news-bundle-selector.test.ts tests/morning-brief-providers.test.ts tests/morning-brief-runner.test.ts tests/runner.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/ai/news-intake/bundle-selector.ts lib/ai/morning-brief-providers.ts lib/jobs/runner.ts tests/news-bundle-selector.test.ts tests/morning-brief-providers.test.ts tests/morning-brief-runner.test.ts tests/runner.test.ts
git commit -m "feat: generate Qwen brief from verified source bundle"
```

### Task 6: Health API, Full Verification, and Documentation

**Files:**
- Modify: `lib/data/repository.ts`
- Modify: `app/api/v1/data-health/route.ts`
- Modify: `tests/repository-health.test.ts`
- Modify: `README.md`

**Interfaces:**
- Extends: `readDataHealth()` with optional `newsCollection` containing tier times, statuses, counts, and errors

- [ ] **Step 1: Write failing health-contract test**

```ts
expect(await readDataHealth()).toMatchObject({
  newsCollection: {
    tier1: { status: "partial", fetchDate: "2026-07-24" },
    tier2: { status: "complete", fetchDate: "2026-07-24" },
  },
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx vitest run tests/repository-health.test.ts`

Expected: FAIL because `newsCollection` is absent.

- [ ] **Step 3: Implement backward-compatible health output**

Read the latest tier-1 and tier-2 collection runs. When D1 tables do not yet exist, return `newsCollection: null` instead of failing the entire endpoint.

- [ ] **Step 4: Document operations**

Document both cron times, required `DASHSCOPE_API_KEY` and `FIRECRAWL_API_KEY`, the two manual protected endpoints, failure states, and the rule that market numbers never come from AI/news sources.

- [ ] **Step 5: Run the complete test suite**

Run: `npm test`

Expected: all test files pass.

- [ ] **Step 6: Run static and production checks**

Run: `npm run lint`

Expected: exit 0.

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 7: Inspect the final diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only intended files plus the user’s pre-existing untracked files.

- [ ] **Step 8: Commit**

```bash
git add lib/data/repository.ts app/api/v1/data-health/route.ts tests/repository-health.test.ts README.md
git commit -m "feat: expose tiered news collection health"
```
