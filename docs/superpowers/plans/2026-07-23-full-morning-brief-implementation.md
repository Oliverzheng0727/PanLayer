# PanLayer Full Morning Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the production demo brief with a sourced, 5,000–8,000-character morning brief generated as five independently retryable modules and displayed behind the existing five summary cards.

**Architecture:** Introduce a versioned V2 brief contract with block-based content, generate each fixed module independently through the configured AI provider, persist module results in D1, and deterministically assemble them into the existing `morning_briefs` record. The dashboard keeps its five-card layout, while a wider source-aware drawer renders the full module and its tables, callouts, headings, and citations.

**Tech Stack:** React 19, Next/vinext, TypeScript 5.9, Cloudflare Workers and D1, Qwen DashScope native search with OpenAI Responses fallback, Vitest, ESLint, Sites hosting.

## Global Constraints

- Preserve exactly five modules: 全球外围市场全景、全球产业重大催化、国内隔夜重磅信息、板块利好、利空与内需映射、盘前情绪、观察方向与风险.
- A complete brief must contain 5,000–8,000 Chinese characters; each complete module must contain 1,000–1,600 Chinese characters.
- Every factual paragraph, bullet group, callout, and non-structured table must reference one or more real search sources.
- Structured index, currency, yield, and commodity values must come from the existing reconciled global snapshot and carry its source/time metadata.
- Never emit individual-stock recommendations, buy/sell points, position advice, or return promises.
- Production must never fall back to `demoBrief`; demo content is development-only.
- One module may fail without discarding the other four; retries and writes must be idempotent.
- Keep all dates, schedules, and displayed run times in Beijing time.
- Do not expose AI API keys, authenticated-user headers, or Sites credentials to the client.

---

## File Structure

- Create `lib/ai/morning-brief-contract.ts`: V2 types, fixed section definitions, length/coverage/source/safety validation, source resolution.
- Create `lib/ai/morning-brief-providers.ts`: provider-neutral section generator interface plus Qwen and OpenAI section implementations.
- Create `lib/ai/morning-brief-assembly.ts`: source namespacing, failed-section construction, deterministic merge, status derivation.
- Modify `lib/ai/morning-brief.ts`: compatibility exports and provider-facing entry points only.
- Modify `db/schema.ts`: `morning_brief_sections` table.
- Modify `lib/jobs/runner.ts`: runtime schema, module persistence, two-worker generation pool, retries, partial/failure job status.
- Modify `lib/data/repository.ts`: safe V2 brief parsing and module-state reads.
- Modify `app/api/v1/brief/[date]/route.ts`: return a real nullable brief and status instead of production demo data.
- Modify `app/api/v1/admin/jobs/[job]/run/route.ts`: accept an optional validated module key.
- Modify `app/auth-guard.ts`: expose a server-only admin check for rendering the regenerate control.
- Create `app/components/brief/BriefBlockRenderer.tsx`: render V2 blocks and their citations.
- Create `app/components/brief/BriefRegenerateButton.tsx`: protected manual regeneration action.
- Modify `app/components/brief/BriefDetailDrawer.tsx`: 900px full-module reader with sticky outline.
- Modify `app/components/Dashboard.tsx`: nullable state, richer cards, tags/status/source counts.
- Modify `app/dashboard/page.tsx`: production no-demo behavior and admin flag.
- Modify `app/globals.css`: drawer, outline, blocks, tables, mobile full-screen behavior.
- Modify `lib/data/demo.ts`: development-only V2 fixture.
- Modify tests listed in each task.

---

### Task 1: Define and Validate the V2 Brief Contract

**Files:**
- Create: `lib/ai/morning-brief-contract.ts`
- Modify: `lib/ai/morning-brief.ts`
- Test: `tests/morning-brief-contract.test.ts`

**Interfaces:**
- Produces: `BriefSectionKey`, `BriefStatus`, `BriefSource`, `BriefBlock`, `BriefSection`, `MorningBrief`, `BRIEF_SECTION_DEFINITIONS`, `validateBriefSection()`, `validateMorningBrief()`, `resolveBlockSources()`, `briefTextLength()`.
- Consumes: no application code beyond plain TypeScript.

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from "vitest";
import {
  BRIEF_SECTION_DEFINITIONS,
  briefTextLength,
  resolveBlockSources,
  validateBriefSection,
  validateMorningBrief,
  type BriefSection,
  type MorningBrief,
} from "../lib/ai/morning-brief-contract";

const section = (index: number): BriefSection => ({
  key: BRIEF_SECTION_DEFINITIONS[index].key,
  title: BRIEF_SECTION_DEFINITIONS[index].title,
  summary: "三行以内摘要",
  tags: ["重点"],
  status: "complete",
  generatedAt: "2026-07-23T07:15:00+08:00",
  blocks: [{
    type: "paragraph",
    text: `${BRIEF_SECTION_DEFINITIONS[index].requiredTerms.join("、")}。${"市场事实与影响解读。".repeat(100)}`,
    sourceIds: [`s${index}`],
  }],
  sourceIds: [`s${index}`],
});

const brief: MorningBrief = {
  schemaVersion: 2,
  date: "2026-07-23",
  status: "complete",
  generatedAt: "2026-07-23T07:15:00+08:00",
  sections: BRIEF_SECTION_DEFINITIONS.map((_, index) => section(index)),
  sources: BRIEF_SECTION_DEFINITIONS.map((_, index) => ({
    id: `s${index}`, title: `来源${index}`, url: `https://example.com/${index}`,
    publishedAt: "2026-07-23T06:00:00+08:00",
  })),
  disclaimer: "仅供市场复盘，不构成投资建议。",
};

describe("V2 morning brief contract", () => {
  it("accepts a five-module sourced brief and counts rendered text", () => {
    expect(briefTextLength(brief.sections[0])).toBeGreaterThanOrEqual(1000);
    expect(validateMorningBrief(brief).ok).toBe(true);
  });

  it("rejects missing coverage, missing sources and recommendation language", () => {
    const invalid = structuredClone(brief);
    invalid.sections[1].blocks = [{ type: "paragraph", text: "建议买入并加仓", sourceIds: [] }];
    const result = validateBriefSection(invalid.sections[1], new Set(invalid.sources.map((item) => item.id)));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/来源|投资建议|字数|覆盖/);
  });

  it("resolves block sources once and in citation order", () => {
    const block = { type: "paragraph" as const, text: "事实", sourceIds: ["s3", "missing", "s1", "s3"] };
    expect(resolveBlockSources(brief, block).map((item) => item.id)).toEqual(["s3", "s1"]);
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `npx vitest run tests/morning-brief-contract.test.ts`

Expected: FAIL because `lib/ai/morning-brief-contract.ts` does not exist.

- [ ] **Step 3: Implement the V2 contract**

Create discriminated block types and fixed definitions:

```ts
export type BriefStatus = "complete" | "partial" | "failed";
export type BriefSectionKey = "global-markets" | "global-industry" | "domestic" | "mapping" | "risk";

export interface BriefSource {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
}

export type BriefBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string; sourceIds: string[] }
  | { type: "bullets"; items: Array<{ text: string; sourceIds: string[] }> }
  | { type: "table"; columns: string[]; rows: string[][]; sourceIds: string[]; dataSource?: { label: string; marketTime: string | null } }
  | { type: "callout"; tone: "insight" | "risk" | "missing"; text: string; sourceIds: string[] };

export interface BriefSection {
  key: BriefSectionKey;
  title: string;
  summary: string;
  tags: string[];
  status: BriefStatus;
  generatedAt: string;
  blocks: BriefBlock[];
  sourceIds: string[];
}

export interface MorningBrief {
  schemaVersion: 2;
  date: string;
  status: BriefStatus;
  generatedAt: string;
  sections: BriefSection[];
  sources: BriefSource[];
  disclaimer: string;
}

export const BRIEF_SECTION_DEFINITIONS = [
  { key: "global-markets", title: "全球外围市场全景", requiredTerms: ["道琼斯", "标普", "纳斯达克", "费城半导体", "英伟达", "美光", "中概", "A50", "人民币", "美债", "原油", "黄金", "工业金属"] },
  { key: "global-industry", title: "全球产业重大催化", requiredTerms: ["Kimi", "DeepSeek", "GPT", "存储", "人形机器人", "算力", "光模块", "钠离子电池", "新能源车", "医药"] },
  { key: "domestic", title: "国内隔夜重磅信息", requiredTerms: ["宏观", "政策", "产业", "公告", "央行", "流动性"] },
  { key: "mapping", title: "板块利好、利空与内需映射", requiredTerms: ["指数", "成交额", "涨跌停", "连板", "资金", "ETF", "利好", "利空", "内需"] },
  { key: "risk", title: "盘前情绪、观察方向与风险", requiredTerms: ["情绪", "观察", "持续性", "风险", "关键"] },
] as const;
```

Implement validators so source requirements apply to factual blocks, complete sections enforce 1,000–1,600 characters and required terms, complete briefs enforce all five keys and 5,000–8,000 characters, while partial/failed briefs may contain explicit failed-section callouts.

Keep `lib/ai/morning-brief.ts` as a compatibility facade:

```ts
export * from "./morning-brief-contract";
export { generateQwenBriefSection, generateOpenAIBriefSection } from "./morning-brief-providers";
export { assembleMorningBrief } from "./morning-brief-assembly";
```

- [ ] **Step 4: Run contract tests**

Run: `npx vitest run tests/morning-brief-contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/morning-brief-contract.ts lib/ai/morning-brief.ts tests/morning-brief-contract.test.ts
git commit -m "feat: define full morning brief contract"
```

---

### Task 2: Generate One Sourced Module per Provider Call

**Files:**
- Create: `lib/ai/morning-brief-providers.ts`
- Test: `tests/morning-brief-providers.test.ts`
- Modify: `tests/morning-brief.test.ts`

**Interfaces:**
- Consumes: `BriefSectionKey`, `BriefSection`, `BriefSource`, `BRIEF_SECTION_DEFINITIONS`, `ReconciledGlobalPoint[]`.
- Produces:

```ts
export interface GeneratedBriefSection {
  section: BriefSection;
  sources: BriefSource[];
}

export type BriefSectionGenerator = (input: {
  date: string;
  key: BriefSectionKey;
  globalSnapshot: ReconciledGlobalPoint[];
}) => Promise<GeneratedBriefSection>;
```

- [ ] **Step 1: Write failing provider tests**

Test that one Qwen call requests exactly one key, enables native search, maps search result `ref_1` to `${key}_ref_1`, and never puts the API key in the prompt. Add the equivalent strict-schema assertion for the OpenAI Responses fallback.

```ts
const result = await generateQwenBriefSection({
  date: "2026-07-23",
  key: "global-industry",
  apiKey: "secret",
  globalSnapshot: [],
  fetcher,
});
expect(request.parameters.enable_search).toBe(true);
expect(request.input.messages[1].content).toContain("global-industry");
expect(request.input.messages[1].content).not.toContain("secret");
expect(result.sources[0].id).toBe("global-industry_ref_1");
expect(JSON.stringify(result.section)).toContain("global-industry_ref_1");
```

- [ ] **Step 2: Run provider tests and verify failure**

Run: `npx vitest run tests/morning-brief-providers.test.ts tests/morning-brief.test.ts`

Expected: FAIL because section generators and V2 response parsing are absent.

- [ ] **Step 3: Implement provider-neutral prompts and provider adapters**

Build one prompt per fixed section. The prompt must include the section-specific required terms, 1,000–1,600-character limit, source rules, prohibited language, the structured global snapshot, and this JSON shape:

```json
{
  "key": "global-industry",
  "title": "全球产业重大催化",
  "summary": "最多三行摘要",
  "tags": ["AI", "存储"],
  "blocks": [
    {"type":"heading","text":"AI 大模型"},
    {"type":"paragraph","text":"事实与盘面映射","sourceIds":["ref_1"]}
  ]
}
```

Implement:

```ts
export async function generateQwenBriefSection(input: ProviderSectionInput): Promise<GeneratedBriefSection>
export async function generateOpenAIBriefSection(input: ProviderSectionInput): Promise<GeneratedBriefSection>
```

For both providers:

1. reject empty API keys;
2. reject missing/invalid output JSON;
3. replace every local `ref_n` with `${key}_ref_n`;
4. build sources only from provider search metadata;
5. set `status: "complete"` and `generatedAt` on the returned section;
6. run `validateBriefSection()` before returning.

Qwen parameters stay:

```ts
{
  result_format: "message",
  response_format: { type: "json_object" },
  enable_thinking: false,
  enable_search: true,
  search_options: {
    search_strategy: "turbo",
    forced_search: true,
    enable_source: true,
    enable_citation: true,
    citation_format: "[ref_<number>]",
    freshness: 7
  }
}
```

OpenAI uses `gpt-5.6-terra`, medium reasoning, `web_search`, high verbosity, and a strict JSON schema for one section.

- [ ] **Step 4: Run provider tests**

Run: `npx vitest run tests/morning-brief-providers.test.ts tests/morning-brief.test.ts`

Expected: PASS, with the live Qwen test still skipped unless `RUN_LIVE_QWEN_TEST=1`.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/morning-brief-providers.ts tests/morning-brief-providers.test.ts tests/morning-brief.test.ts
git commit -m "feat: generate sourced brief modules independently"
```

---

### Task 3: Persist Module Results and Assemble a Partial-Safe Brief

**Files:**
- Create: `lib/ai/morning-brief-assembly.ts`
- Modify: `db/schema.ts`
- Modify: `lib/jobs/runner.ts`
- Modify: `lib/data/repository.ts`
- Test: `tests/morning-brief-assembly.test.ts`
- Test: `tests/morning-brief-persistence.test.ts`
- Modify: `tests/repository-health.test.ts`

**Interfaces:**
- Consumes: `GeneratedBriefSection[]`, fixed section definitions, D1.
- Produces:

```ts
export function failedBriefSection(key: BriefSectionKey, error: string, generatedAt: string): BriefSection;
export function assembleMorningBrief(date: string, results: Array<GeneratedBriefSection | { key: BriefSectionKey; error: string }>, generatedAt: string): MorningBrief;
export async function persistBriefSection(db: D1Database, date: string, model: string, result: BriefSection, attempts: number, error: string): Promise<void>;
export async function readPersistedBriefSections(db: D1Database, date: string): Promise<BriefSection[]>;
```

- [ ] **Step 1: Write failing assembly and persistence tests**

Cover source de-duplication, fixed section order, one failed section producing overall `partial`, five failures producing `failed`, and D1 upsert keyed by `(trade_date, section_key)`.

```ts
const brief = assembleMorningBrief("2026-07-23", [
  complete("global-markets"),
  { key: "global-industry", error: "provider timeout" },
  complete("domestic"),
  complete("mapping"),
  complete("risk"),
], "2026-07-23T07:15:00+08:00");
expect(brief.status).toBe("partial");
expect(brief.sections.map((item) => item.key)).toEqual([
  "global-markets", "global-industry", "domestic", "mapping", "risk",
]);
expect(brief.sections[1]).toMatchObject({ status: "failed" });
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run tests/morning-brief-assembly.test.ts tests/morning-brief-persistence.test.ts tests/repository-health.test.ts`

Expected: FAIL because the assembler and table do not exist.

- [ ] **Step 3: Add the module table and runtime schema**

Add to `db/schema.ts` and the runtime `schemaStatements` in `lib/jobs/runner.ts`:

```sql
CREATE TABLE IF NOT EXISTS morning_brief_sections (
  trade_date TEXT NOT NULL,
  section_key TEXT NOT NULL,
  model TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (trade_date, section_key)
)
```

The Drizzle table must expose the same columns and composite primary key.

- [ ] **Step 4: Implement deterministic assembly and repository parsing**

Assembly must:

- preserve fixed module order;
- turn rejected modules into `missing` callouts;
- de-duplicate sources by URL and remap source IDs deterministically;
- derive `complete`, `partial`, or `failed`;
- validate all successful sections and the assembled brief;
- never call an AI model.

`readBrief()` must parse only `schemaVersion: 2` records and return `null` for malformed or legacy/demo payloads in production. In development it may return the V2 demo fixture.

- [ ] **Step 5: Run persistence tests**

Run: `npx vitest run tests/morning-brief-assembly.test.ts tests/morning-brief-persistence.test.ts tests/repository-health.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/morning-brief-assembly.ts db/schema.ts lib/jobs/runner.ts lib/data/repository.ts tests/morning-brief-assembly.test.ts tests/morning-brief-persistence.test.ts tests/repository-health.test.ts
git commit -m "feat: persist and assemble brief modules"
```

---

### Task 4: Orchestrate Five Modules with Bounded Concurrency and Retry

**Files:**
- Modify: `lib/jobs/runner.ts`
- Test: `tests/morning-brief-runner.test.ts`
- Modify: `tests/runner.test.ts`

**Interfaces:**
- Consumes: `BriefSectionGenerator`, `persistBriefSection()`, `assembleMorningBrief()`, `loadGlobalOvernightSnapshot()`.
- Produces:

```ts
export async function generateFullMorningBrief(input: {
  date: string;
  model: string;
  sectionKeys: BriefSectionKey[];
  generator: BriefSectionGenerator;
  db: D1Database;
  concurrency?: number;
  retries?: number;
}): Promise<MorningBrief>;
```

- [ ] **Step 1: Write failing orchestration tests**

Use a fake generator to prove:

- no more than two provider calls run concurrently;
- a transient module failure is retried twice;
- completed modules are persisted once by their unique key;
- selecting `["risk"]` regenerates only that module and merges it with four stored modules;
- one permanent failure still saves a partial full brief;
- a completed full brief is skipped unless `force` is true.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run tests/morning-brief-runner.test.ts tests/runner.test.ts`

Expected: FAIL because `generateFullMorningBrief()` is absent.

- [ ] **Step 3: Implement the two-worker job pool**

Use a shared cursor and exactly `Math.min(2, sectionKeys.length)` workers. Each worker attempts a section at most three times, persists its final success/failure, and returns a result instead of throwing away other modules.

```ts
const results: SectionRunResult[] = Array(sectionKeys.length);
let cursor = 0;
const worker = async () => {
  while (cursor < sectionKeys.length) {
    const index = cursor++;
    results[index] = await runSectionWithRetry(sectionKeys[index], 3);
  }
};
await Promise.all(Array.from({ length: Math.min(concurrency, sectionKeys.length) }, worker));
```

After assembly, upsert `morning_briefs` with the real `brief.status`. Update `job_runs` to `complete`, `partial`, or `failed` and store failed module names in `message`.

Wire Qwen as the preferred section generator and OpenAI as the fallback provider when only `OPENAI_API_KEY` is configured.

- [ ] **Step 4: Run orchestration tests**

Run: `npx vitest run tests/morning-brief-runner.test.ts tests/runner.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/runner.ts tests/morning-brief-runner.test.ts tests/runner.test.ts
git commit -m "feat: orchestrate resilient five-part morning brief"
```

---

### Task 5: Remove Production Demo Fallback and Add Targeted Regeneration

**Files:**
- Modify: `app/api/v1/brief/[date]/route.ts`
- Modify: `app/api/v1/admin/jobs/[job]/run/route.ts`
- Modify: `app/auth-guard.ts`
- Modify: `app/dashboard/page.tsx`
- Modify: `lib/data/demo.ts`
- Test: `tests/brief-route.test.ts`
- Test: `tests/admin-route.test.ts`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: nullable `MorningBrief`, `BriefSectionKey`, `runPanLayerJob(..., { force, sectionKeys })`.
- Produces: `GET /api/v1/brief/:date -> { brief: MorningBrief | null, status: "complete" | "partial" | "failed" | "unavailable", demo: boolean }`.
- Produces: `POST /api/v1/admin/jobs/morning-brief/run?force=true&section=risk`.

- [ ] **Step 1: Write failing route and no-demo tests**

Assert:

```ts
expect(briefRouteSource).not.toContain("demoBrief");
expect(briefRouteSource).toContain("status: brief?.status ?? \"unavailable\"");
expect(adminRouteSource).toContain("BRIEF_SECTION_DEFINITIONS");
expect(adminRouteSource).toContain("sectionKeys");
expect(dashboardPageSource).toMatch(/process\.env\.NODE_ENV === "development"/);
```

The rendered production dashboard must contain an unavailable state when D1 has no brief and must not contain “演示来源占位”.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run tests/brief-route.test.ts tests/admin-route.test.ts && npm run test:render`

Expected: FAIL because production still injects `demoBrief` and the admin route cannot target a section.

- [ ] **Step 3: Implement nullable production behavior and validated section selection**

The brief route returns:

```ts
const brief = await readBrief(date);
return Response.json({
  brief,
  status: brief?.status ?? "unavailable",
  demo: false,
});
```

`app/dashboard/page.tsx` uses:

```ts
const brief = storedBrief ?? (process.env.NODE_ENV === "development" ? { ...demoBrief, date } : null);
```

Validate `section` against `BRIEF_SECTION_DEFINITIONS`; reject unknown values with HTTP 400. Extend runner options with `sectionKeys?: BriefSectionKey[]`.

Export a server-only helper from `app/auth-guard.ts`:

```ts
export async function isAdminUser(email: string): Promise<boolean> {
  return canRunAdminJob(email, await resolveAdminEmail());
}
```

Pass `canManageBrief={await isAdminUser(user.email)}` to `Dashboard`.

- [ ] **Step 4: Run API and render tests**

Run: `npx vitest run tests/brief-route.test.ts tests/admin-route.test.ts && npm run test:render`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/brief/[date]/route.ts app/api/v1/admin/jobs/[job]/run/route.ts app/auth-guard.ts app/dashboard/page.tsx lib/data/demo.ts tests/brief-route.test.ts tests/admin-route.test.ts tests/rendered-html.test.mjs
git commit -m "fix: stop serving demo briefs in production"
```

---

### Task 6: Build the Rich Summary Cards and Full-Width Reader

**Files:**
- Create: `app/components/brief/BriefBlockRenderer.tsx`
- Create: `app/components/brief/BriefRegenerateButton.tsx`
- Modify: `app/components/brief/BriefDetailDrawer.tsx`
- Modify: `app/components/Dashboard.tsx`
- Modify: `app/globals.css`
- Test: `tests/brief-ui.test.ts`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: `MorningBrief | null`, `BriefSection`, `BriefBlock`, `canManageBrief`.
- Produces: semantic, source-aware cards and a dialog reader; admin-only manual regeneration control.

- [ ] **Step 1: Write failing UI source/render tests**

Assert the implementation includes:

- `brief-card-summary`, `brief-tags`, module status and source count;
- `brief-drawer-outline`, `brief-block-table`, `brief-callout-risk`;
- drawer width `min(900px,100vw)`;
- mobile width `100vw`;
- an unavailable empty state;
- `BriefRegenerateButton` only when `canManageBrief`.

- [ ] **Step 2: Run UI tests and verify failure**

Run: `npx vitest run tests/brief-ui.test.ts && npm run test:render`

Expected: FAIL because V2 blocks and new styles are absent.

- [ ] **Step 3: Implement block rendering with scoped citations**

`BriefBlockRenderer` renders:

- headings with stable IDs `${section.key}-block-${index}`;
- paragraphs and callouts with their source chips;
- bullet items with per-item sources;
- horizontally scrollable tables with fixed headers;
- structured table source/time metadata;
- missing callouts without fake links.

Do not render raw HTML from AI output.

- [ ] **Step 4: Upgrade cards, drawer, empty state and manual action**

Cards show `section.summary`, up to five tags, status, item/source counts, and generation time.

The drawer uses:

```tsx
<nav className="brief-drawer-outline" aria-label="本模块目录">
  {headings.map((heading) => <a key={heading.id} href={`#${heading.id}`}>{heading.text}</a>)}
</nav>
```

`BriefRegenerateButton` performs:

```ts
await fetch("/api/v1/admin/jobs/morning-brief/run?force=true", { method: "POST" });
window.location.reload();
```

It shows running, success, and failure text and never receives an API key.

- [ ] **Step 5: Add responsive styles**

Set:

```css
.brief-drawer { width:min(900px,100vw); }
.brief-drawer-layout { display:grid; grid-template-columns:170px minmax(0,1fr); }
.brief-drawer-outline { position:sticky; top:0; max-height:calc(100vh - 160px); overflow:auto; }
.brief-block-table-wrap { overflow-x:auto; }
@media (max-width:760px) {
  .brief-drawer { width:100vw; border-left:0; }
  .brief-drawer-layout { display:block; }
  .brief-drawer-outline { position:static; display:flex; overflow-x:auto; }
}
```

Preserve focus-visible styles, Escape-to-close, overlay close, and valid dialog labeling.

- [ ] **Step 6: Run UI tests**

Run: `npx vitest run tests/brief-ui.test.ts && npm run test:render`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/components/brief/BriefBlockRenderer.tsx app/components/brief/BriefRegenerateButton.tsx app/components/brief/BriefDetailDrawer.tsx app/components/Dashboard.tsx app/globals.css tests/brief-ui.test.ts tests/rendered-html.test.mjs
git commit -m "feat: add full morning brief reader"
```

---

### Task 7: Verify, Publish, and Generate the Current Brief

**Files:**
- Modify only if verification finds a defect in files from Tasks 1–6.
- Use: `.openai/hosting.json`

**Interfaces:**
- Consumes: completed feature and existing Sites project ID.
- Produces: a saved Sites version, successful production deployment, and a newly generated current-day brief.

- [ ] **Step 1: Run focused morning-brief tests**

Run:

```bash
npx vitest run tests/morning-brief-contract.test.ts tests/morning-brief-providers.test.ts tests/morning-brief-assembly.test.ts tests/morning-brief-persistence.test.ts tests/morning-brief-runner.test.ts tests/brief-route.test.ts tests/admin-route.test.ts tests/brief-ui.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run complete verification**

Run:

```bash
npm test
npm run lint
git diff --check
npm run build
npm run test:render
```

Expected: tests, lint, diff check, build, and server-render tests pass. The existing large-chunk build warning is non-blocking.

- [ ] **Step 3: Commit any verification fixes**

```bash
git add lib/ai app/api/v1/brief app/api/v1/admin/jobs app/components/brief app/components/Dashboard.tsx app/dashboard/page.tsx app/globals.css app/auth-guard.ts lib/data/repository.ts lib/data/demo.ts lib/jobs/runner.ts db/schema.ts tests
git commit -m "fix: complete morning brief verification"
```

Skip this commit if no files changed.

- [ ] **Step 4: Push the exact HEAD to the configured Sites source repository**

Read `.openai/hosting.json`, create a short-lived source repository credential, and push the exact `git rev-parse HEAD` to the configured Sites `main` branch using per-command authentication. Never save or print the token.

- [ ] **Step 5: Package and save a Sites version**

Run:

```bash
archive_dir=$(mktemp -d /tmp/panlayer-brief-sites-XXXXXX)
/Users/zhengbinwen/.codex/plugins/cache/openai-bundled/sites/0.1.30/scripts/package-site.sh . "$archive_dir/panlayer.tar.gz"
```

Call `save_site_version` with the exact pushed commit SHA and archive.

- [ ] **Step 6: Deploy the approved public version and wait for success**

Call `deploy_site_version`, then poll `get_deployment_status` until `succeeded` or `failed`. Report the production URL only after success.

- [ ] **Step 7: Force-regenerate the current brief**

Open the authenticated production dashboard, use the admin “重新生成今日早参” control once, and wait for its success state. This is authorized by the approved design.

- [ ] **Step 8: Verify production acceptance signals**

Reload the dashboard and verify:

- the brief is not the demo fixture;
- five cards exist;
- each card shows a summary, tags, source count, status, and generated time;
- all five drawers open;
- a complete brief totals 5,000–8,000 Chinese characters;
- sources include real URLs and publication times;
- the desktop drawer is approximately 900px and mobile uses full width;
- production data health reports the AI job as complete or partial with explicit failed modules.

- [ ] **Step 9: Final handoff**

Report the production URL, saved version number, deployed commit, test counts, brief status, character count, source count, and any module explicitly marked partial.
