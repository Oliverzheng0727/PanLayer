import { describe, expect, it, vi } from "vitest";
import { BRIEF_SECTION_DEFINITIONS, BRIEF_SECTION_DEFINITIONS_V3, type BriefSectionKey } from "../lib/ai/morning-brief-contract";
import { acquireJobLease, buildDailyReview, createDeadlineAwareBufferedFetcher, leaseLabelForJob, loadMorningBriefMarketContext, persistGlobalPoints, persistSourceAudits, prepareMorningBriefRegeneration, releaseJobLease, renewJobLease, resolveMorningBriefProvider, runPanLayerJob, shouldFinalizeEvidenceTemplate, shouldSkipMorningBrief } from "../lib/jobs/runner";
import * as runnerModule from "../lib/jobs/runner";
import { loadGlobalOvernightSnapshot } from "../lib/data/global/overnight";
import type { Quote } from "../lib/domain/types";
import type { SourceAudit } from "../lib/data/quality";
import { runHistoryBackfillBatch } from "../lib/history/backfill";
import type { BoardPools, MarketAggregate } from "../lib/data/provider";

vi.mock("../lib/data/global/overnight", () => ({
  loadGlobalOvernightSnapshot: vi.fn(async () => ({ raw: [], reconciled: [] })),
}));
vi.mock("../lib/history/backfill", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/history/backfill")>();
  return { ...original, runHistoryBackfillBatch: vi.fn(original.runHistoryBackfillBatch) };
});

const q = (symbol: string, pctChange: number, streak = 0): Quote => ({
  symbol, name: symbol, exchange: "SH", board: "MAIN", isST: false, isNoLimitDay: false,
  previousClose: 10, open: 10.2, price: pctChange === 10 ? 11 : 10 * (1 + pctChange / 100),
  high: 11, low: 9.8, pctChange, amount: 100, turnoverRate: 2,
  limitUpPrice: 11, limitDownPrice: 9, sector: streak ? "机器人" : "银行",
  firstLimitTime: streak ? "09:35:00" : null, limitStreak: streak,
});

function morningBriefJobHarness(failedKeys: BriefSectionKey[]) {
  const jobUpdates: Array<{ status: string; message: string }> = [];
  const requests: Partial<Record<BriefSectionKey, number>> = {};
  let nextJobRunId = 1;
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...bound: unknown[]) { values = bound; return this; },
        async first() {
          if (sql.startsWith("INSERT INTO job_runs")) return { id: nextJobRunId++ };
          if (sql.includes("job_leases")) return { token: String(sql.startsWith("UPDATE") ? values[4] : values[2]) };
          return null;
        },
        async all() { return { results: [] }; },
        async run() {
          if (sql.startsWith("UPDATE job_runs")) {
            jobUpdates.push({ status: String(values[0]), message: String(values[1] ?? "") });
          }
          return {};
        },
      };
    },
    async batch() { return []; },
  } as unknown as D1Database;
  const fetcher: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    const prompt = request.messages[1].content;
    const definition = BRIEF_SECTION_DEFINITIONS_V3.find((item) => prompt.includes(`key 必须为 "${item.key}"`));
    if (definition) requests[definition.key] = (requests[definition.key] ?? 0) + 1;
    if (!definition || failedKeys.includes(definition.key)) {
      return new Response(JSON.stringify({ message: "provider unavailable" }), { status: 503 });
    }
    const section = {
      key: definition.key,
      title: definition.title,
      summary: "已核验的隔夜市场信息摘要。",
      tags: ["市场"],
      blocks: [{
        type: "paragraph",
        text: `${definition.requiredTerms.join("、")}。${"客观市场事实与影响解读。".repeat(100)}`,
        sourceIds: ["ref_1"],
      }],
    };
    return new Response(JSON.stringify({
      output: {
        choices: [{ message: { content: JSON.stringify(section) } }],
        search_info: { search_results: [{ index: 1, title: "可靠来源", url: `https://example.com/${definition.key}` }] },
      },
    }), { status: 200 });
  };
  return { db, fetcher, jobUpdates, requests };
}

function orchestratedLeaseHarness() {
  let lease: { token: string; acquiredAt: string; expiresAt: string } | null = null;
  const globalWrites: string[] = [];
  const sectionWrites: Array<{ key: string; status: string; model: string }> = [];
  const aggregateWrites: string[] = [];
  let runId = 0;
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...bound: unknown[]) { values = bound; return this; },
        async first() {
          if (sql.startsWith("INSERT INTO job_leases")) {
            const [,, token, acquiredAt, expiresAt, now, staleAt] = values as string[];
            if (lease && lease.expiresAt > now && lease.acquiredAt > staleAt) return null;
            lease = { token, acquiredAt, expiresAt };
            return { token };
          }
          if (sql.startsWith("UPDATE job_leases")) {
            const [acquiredAt, expiresAt,,, token, now] = values as string[];
            if (!lease || lease.token !== token || lease.expiresAt <= now) return null;
            lease = { token, acquiredAt, expiresAt };
            return { token };
          }
          if (sql.startsWith("INSERT INTO job_runs")) return { id: ++runId };
          return null;
        },
        async all() { return { results: [] }; },
        async run() {
          if (sql.startsWith("DELETE FROM job_leases") && lease?.token === values[2]) lease = null;
          if (sql.includes("global_market_snapshots")) globalWrites.push(String(values[2]));
          if (sql.includes("morning_brief_sections")) sectionWrites.push({ key: String(values[1]), status: String(values[4]), model: String(values[2]) });
          if (sql.includes("morning_briefs")) aggregateWrites.push(String(values[1]));
          return {};
        },
      };
    },
    async batch() { return []; },
  } as unknown as D1Database;
  return { db, globalWrites, sectionWrites, aggregateWrites };
}

function qwenResponse(key: BriefSectionKey, status = 200) {
  const definition = BRIEF_SECTION_DEFINITIONS_V3.find((item) => item.key === key)!;
  return new Response(JSON.stringify(status === 200 ? {
    output: { choices: [{ message: { content: JSON.stringify({ key, title: definition.title, summary: "摘要", tags: ["测试"], blocks: [{ type: "paragraph", text: `${definition.requiredTerms.join("、")}。${"客观事实与盘面映射。".repeat(130)}`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: `https://example.com/${key}` }] } },
  } : { message: "provider unavailable" }), { status });
}

function openAIResponse(key: BriefSectionKey) {
  const definition = BRIEF_SECTION_DEFINITIONS_V3.find((item) => item.key === key)!;
  const url = `https://example.com/openai-${key}`;
  return Response.json({
    output: [
      { type: "web_search_call", action: { sources: [{ type: "url", url }] } },
      {
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            key,
            title: definition.title,
            summary: "备用生成源已完成该模块。",
            tags: ["市场"],
            blocks: [{
              type: "paragraph",
              text: `${definition.requiredTerms.join("、")}。${"客观市场事实与影响解读。".repeat(120)}`,
              sourceUrls: [url],
            }],
          }),
          annotations: [{ type: "url_citation", title: "备用可靠来源", url }],
        }],
      },
    ],
  });
}

describe("close review aggregation", () => {
  it("assigns every scheduled job a stable lease label", () => {
    expect(leaseLabelForJob({ type: "breadth", time: "10:00" })).toBe("breadth-10:00");
    expect(leaseLabelForJob({ type: "close-review" })).toBe("close-review");
    expect(leaseLabelForJob({ type: "history-backfill", days: 120 })).toBe("history-backfill");
  });

  it("runs one resumable history-backfill batch and reports progress", async () => {
    const jobUpdates: string[] = [];
    const db = {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...bound: unknown[]) { values = bound; return this; },
          async first() {
            if (sql.startsWith("INSERT INTO job_leases")) return { token: String(values[2]) };
            return sql.startsWith("INSERT INTO job_runs") ? { id: 1 } : null;
          },
          async run() {
            if (sql.startsWith("UPDATE job_runs")) jobUpdates.push(String(values[0] ?? ""));
            return {};
          },
        };
      },
      async batch() { return []; },
    } as unknown as D1Database;
    vi.mocked(runHistoryBackfillBatch).mockResolvedValueOnce({
      target: 120,
      completed: 5,
      remaining: 115,
      dates: [],
    });

    await expect(runPanLayerJob(
      { type: "history-backfill", days: 120 },
      new Date("2026-07-23T08:00:00Z"),
      { DB: db },
    )).resolves.toEqual({ ok: true, status: "partial", message: "history-backfill 5/120; remaining 115" });

    expect(runHistoryBackfillBatch).toHaveBeenCalledWith(expect.objectContaining({
      db,
      endDate: "2026-07-23",
      days: 120,
      batchSize: 5,
    }));
    expect(jobUpdates.at(-1)).toBe("history-backfill 5/120; remaining 115");
  });

  it("bounds a completely hung global snapshot request and clears its timer", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("aborted", "AbortError")); }, { once: true });
      });
      const buffered = createDeadlineAwareBufferedFetcher(fetcher, Date.now() + 110_000);
      const pending = buffered("https://example.com/snapshot");
      const rejected = expect(pending).rejects.toThrow(/Global snapshot request timed out/);

      await vi.advanceTimersByTimeAsync(8_000);

      await rejected;
      expect(aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("bounds a global snapshot response whose headers arrive but body never finishes", async () => {
    vi.useFakeTimers();
    try {
      const fetcher: typeof fetch = async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('{"data":')); },
      }), { headers: { "content-type": "application/json", "x-provider": "snapshot" } });
      const buffered = createDeadlineAwareBufferedFetcher(fetcher, Date.now() + 110_000);
      const pending = buffered("https://example.com/snapshot");
      const rejected = expect(pending).rejects.toThrow(/Global snapshot request timed out/);

      await vi.advanceTimersByTimeAsync(8_000);

      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("buffers a normal global snapshot response without changing status, headers, or body", async () => {
    const fetcher: typeof fetch = async () => new Response('{"ok":true}', { status: 201, headers: { "content-type": "application/json", "x-provider": "snapshot" } });
    const response = await createDeadlineAwareBufferedFetcher(fetcher, Date.now() + 110_000)("https://example.com/snapshot");

    expect(response.status).toBe(201);
    expect(response.headers.get("x-provider")).toBe("snapshot");
    await expect(response.text()).resolves.toBe('{"ok":true}');
  });

  it("continues to morning modules after a timed-out snapshot request becomes unavailable", async () => {
    vi.useFakeTimers();
    try {
      const { db } = morningBriefJobHarness([]);
      let generated = 0;
      const fetcher: typeof fetch = async (input, init) => {
        if (String(input).includes("snapshot-hang")) return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
        const request = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
        const definition = BRIEF_SECTION_DEFINITIONS.find((item) => request.messages[1].content.includes(`key 必须为 "${item.key}"`))!;
        generated += 1;
        return qwenResponse(definition.key);
      };
      vi.mocked(loadGlobalOvernightSnapshot).mockImplementationOnce(async (_env, snapshotFetcher) => {
        await snapshotFetcher("https://example.com/snapshot-hang").catch(() => undefined);
        return { raw: [], reconciled: [] };
      });
      const pending = runPanLayerJob({ type: "morning-brief" }, new Date("2026-07-22T23:15:00Z"), { DB: db, DASHSCOPE_API_KEY: "qwen" }, { fetcher, sectionKeys: ["risk"] });

      await vi.advanceTimersByTimeAsync(8_000);

      await expect(pending).resolves.toMatchObject({ ok: true });
      expect(generated).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("loads prior review and ETF snapshot provenance from persisted dates and update times", async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() { return this; },
          async first() {
            return sql.includes("daily_reviews") ? {
              trade_date: "2026-07-22",
              updated_at: "2026-07-22T16:10:00+08:00",
              status: "complete",
              payload: JSON.stringify({ date: "2026-07-22", status: "complete", breadth: [], metrics: { limitUp: 1, limitDown: 0, consecutive: 0, largeRise: 0, high120: null, allTimeHigh: null, marginBalance: null }, ladder: { first: [], second: [], third: [], fourth: [], fivePlus: [] }, sectors: [], leaders: [] }),
            } : null;
          },
          async all() {
            return { results: [{ category: "人工智能", name: "AI ETF", symbol: "159819", trade_date: "2026-07-21", updated_at: "2026-07-21T16:05:00+08:00" }] };
          },
        };
      },
    } as unknown as D1Database;

    const context = await loadMorningBriefMarketContext(db, "2026-07-23");
    expect(context.review).toMatchObject({ marketTime: "2026-07-22T00:00:00+08:00", receivedAt: "2026-07-22T08:10:00.000Z" });
    expect(context.etfSnapshot).toEqual({ marketTime: "2026-07-21T00:00:00+08:00", receivedAt: "2026-07-21T08:05:00.000Z" });
  });

  it("fences a stale orchestrated run before its delayed global snapshot can write", async () => {
    vi.useFakeTimers();
    try {
      const { db, globalWrites, sectionWrites, aggregateWrites } = orchestratedLeaseHarness();
      const at = new Date("2026-07-22T23:15:00Z");
      vi.setSystemTime(at);
      let resume!: () => void;
      let entered!: () => void;
      const blocked = new Promise<void>((resolve) => { resume = resolve; });
      const reached = new Promise<void>((resolve) => { entered = resolve; });
      const snapshot = { raw: [{ key: "sp500", label: "标普500", provider: "test", value: 630.2, previousClose: 625.1, pctChange: .8, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", status: "ok" as const, message: "" }], reconciled: [] };
      vi.mocked(loadGlobalOvernightSnapshot).mockImplementationOnce(async () => { entered(); await blocked; return snapshot; }).mockImplementationOnce(async () => snapshot);
      const fetcher: typeof fetch = async (_input, init) => qwenResponse(BRIEF_SECTION_DEFINITIONS.find((item) => JSON.parse(String(init?.body)).messages[1].content.includes(`key 必须为 "${item.key}"`))!.key);
      const oldRun = runPanLayerJob({ type: "morning-brief" }, at, { DB: db, DASHSCOPE_API_KEY: "qwen" }, { fetcher, sectionKeys: ["risk"] });
      await reached;
      vi.setSystemTime(new Date("2026-07-22T23:31:00Z"));
      await expect(runPanLayerJob({ type: "morning-brief" }, at, { DB: db, DASHSCOPE_API_KEY: "qwen" }, { fetcher, sectionKeys: ["risk"] })).resolves.toMatchObject({ ok: true });
      resume();

      await expect(oldRun).rejects.toThrow(/lease/i);
      expect(globalWrites).toEqual(["标普500"]);
      expect(sectionWrites).toEqual([{ key: "risk", status: "complete", model: "qwen3.7-plus" }]);
      expect(aggregateWrites).toEqual(["qwen3.7-plus"]);
    } finally { vi.useRealTimers(); }
  });

  it("fences a stale provider failure before failed-section or aggregate persistence", async () => {
    vi.useFakeTimers();
    try {
      const { db, globalWrites, sectionWrites, aggregateWrites } = orchestratedLeaseHarness();
      const at = new Date("2026-07-22T23:15:00Z");
      vi.setSystemTime(at);
      const snapshot = { raw: [{ key: "sp500", label: "标普500", provider: "test", value: 630.2, previousClose: 625.1, pctChange: .8, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", status: "ok" as const, message: "" }], reconciled: [] };
      vi.mocked(loadGlobalOvernightSnapshot).mockImplementation(async () => snapshot);
      let resume!: () => void;
      let entered!: () => void;
      const blocked = new Promise<void>((resolve) => { resume = resolve; });
      const reached = new Promise<void>((resolve) => { entered = resolve; });
      let calls = 0;
      const fetcher: typeof fetch = async (_input, init) => {
        const key = BRIEF_SECTION_DEFINITIONS.find((item) => JSON.parse(String(init?.body)).messages[1].content.includes(`key 必须为 "${item.key}"`))!.key;
        calls += 1;
        if (calls === 1) { entered(); await blocked; return qwenResponse(key, 503); }
        return qwenResponse(key);
      };
      const oldRun = runPanLayerJob({ type: "morning-brief" }, at, { DB: db, DASHSCOPE_API_KEY: "qwen" }, { fetcher, sectionKeys: ["risk"] });
      await reached;
      vi.setSystemTime(new Date("2026-07-22T23:31:00Z"));
      await expect(runPanLayerJob({ type: "morning-brief" }, at, { DB: db, DASHSCOPE_API_KEY: "qwen" }, { fetcher, sectionKeys: ["risk"] })).resolves.toMatchObject({ ok: true });
      resume();

      await expect(oldRun).rejects.toThrow(/lease/i);
      expect(globalWrites).toHaveLength(2);
      expect(sectionWrites).toEqual([{ key: "risk", status: "complete", model: "qwen3.7-plus" }]);
      expect(aggregateWrites).toEqual(["qwen3.7-plus"]);
    } finally { vi.useRealTimers(); }
  });

  it("reclaims cancelled leases after three minutes but preserves renewed active leases", async () => {
    let lease: { token: string; acquiredAt: string; expiresAt: string } | null = null;
    const db = {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...bound: unknown[]) { values = bound; return this; },
          async first() {
            if (!sql.includes("job_leases")) return null;
            if (sql.startsWith("INSERT")) {
              const [,, token, acquiredAt, expiresAt, now, staleAt] = values as string[];
              if (lease && lease.expiresAt > now && lease.acquiredAt > staleAt) return null;
              lease = { token, acquiredAt, expiresAt };
              return { token };
            }
            const [acquiredAt, expiresAt,,, token, now] = values as string[];
            if (!lease || lease.token !== token || lease.expiresAt <= now) return null;
            lease = { token, acquiredAt, expiresAt };
            return { token };
          },
          async run() {
            if (sql.startsWith("DELETE") && lease?.token === values[2]) lease = null;
            return {};
          },
        };
      },
    } as unknown as D1Database;
    const start = new Date("2026-07-22T23:00:00Z");
    const first = await acquireJobLease(db, "morning-brief", "2026-07-23", start);
    const beforeExpiry = await acquireJobLease(db, "morning-brief", "2026-07-23", new Date("2026-07-22T23:02:59Z"));

    expect(first).toBeTruthy();
    expect(beforeExpiry).toBeNull();
    const recovered = await acquireJobLease(db, "morning-brief", "2026-07-23", new Date("2026-07-22T23:03:00Z"));
    expect(recovered).toBeTruthy();
    expect(recovered).not.toBe(first);

    await expect(renewJobLease(db, "morning-brief", "2026-07-23", recovered!, new Date("2026-07-22T23:05:00Z"))).resolves.toBe(true);
    const protectedOverlap = await acquireJobLease(db, "morning-brief", "2026-07-23", new Date("2026-07-22T23:07:00Z"));
    expect(protectedOverlap).toBeNull();
    await releaseJobLease(db, "morning-brief", "2026-07-23", "stale-token");
    expect(lease?.token).toBe(recovered);
  });

  it("releases an acquired morning lease when job-run creation fails", async () => {
    let released = false;
    const db = {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...bound: unknown[]) { values = bound; return this; },
          async first() {
            if (sql.includes("job_leases")) return { token: String(values[2]) };
            if (sql.startsWith("INSERT INTO job_runs")) throw new Error("D1 unavailable");
            return null;
          },
          async run() { if (sql.startsWith("DELETE FROM job_leases")) released = true; return {}; },
        };
      },
      async batch() { return []; },
    } as unknown as D1Database;

    await expect(runPanLayerJob({ type: "morning-brief" }, new Date("2026-07-22T23:15:00Z"), { DB: db, DASHSCOPE_API_KEY: "qwen" })).rejects.toThrow("D1 unavailable");
    expect(released).toBe(true);
  });

  it("loads the persisted security universe for provider fallback", async () => {
    const loadExpectedSymbols = (runnerModule as unknown as {
      loadExpectedSymbols?: (db: D1Database) => Promise<string[]>;
    }).loadExpectedSymbols;
    expect(loadExpectedSymbols).toBeTypeOf("function");
    const db = {
      prepare() {
        return { all: async () => ({ results: [{ symbol: "600000.SH" }, { symbol: "000001.SZ" }] }) };
      },
    } as unknown as D1Database;
    await expect(loadExpectedSymbols?.(db)).resolves.toEqual(["600000.SH", "000001.SZ"]);
  });

  it("does not bill the AI provider twice for a completed date unless force is explicit", () => {
    expect(shouldSkipMorningBrief("complete", false)).toBe(true);
    expect(shouldSkipMorningBrief("complete", true)).toBe(false);
    expect(shouldSkipMorningBrief("failed", false)).toBe(false);
    expect(shouldSkipMorningBrief("complete", false, 2, 5)).toBe(false);
    expect(shouldSkipMorningBrief("complete", false, 3, 5)).toBe(false);
    expect(shouldSkipMorningBrief("complete", false, 3, 7)).toBe(true);
  });

  it("removes prior module rows before a protected serial regeneration", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...bound: unknown[]) {
            values = bound;
            return this;
          },
          async run() {
            statements.push({ sql, values });
            return { meta: { changes: sql.startsWith("DELETE FROM morning_brief_sections") ? 7 : 1 } };
          },
        };
      },
      async batch() {
        return [];
      },
    } as unknown as D1Database;

    await expect(prepareMorningBriefRegeneration(
      db,
      new Date("2026-07-28T04:00:00Z"),
    )).resolves.toEqual({ date: "2026-07-28", sectionsMarked: 7 });
    expect(statements[0]).toMatchObject({
      sql: "DELETE FROM morning_brief_sections WHERE trade_date = ?",
      values: ["2026-07-28"],
    });
    expect(statements.some(({ sql }) => sql.startsWith("UPDATE morning_brief_sections"))).toBe(false);
  });

  it("prefers Qwen and keeps OpenAI as an optional fallback", () => {
    expect(resolveMorningBriefProvider({ DASHSCOPE_API_KEY: "qwen", OPENAI_API_KEY: "openai" })).toMatchObject({
      provider: "qwen",
      apiKey: "qwen",
      model: "qwen3.7-plus",
    });
    expect(resolveMorningBriefProvider({ OPENAI_API_KEY: "openai" })).toMatchObject({
      provider: "openai",
      apiKey: "openai",
      model: "gpt-5.6-terra",
    });
    expect(() => resolveMorningBriefProvider({})).toThrow("DASHSCOPE_API_KEY");
  });

  it("only finalizes the verified evidence template from 07:50 Beijing", () => {
    expect(shouldFinalizeEvidenceTemplate("2026-07-29", new Date("2026-07-28T23:49:59Z"))).toBe(false);
    expect(shouldFinalizeEvidenceTemplate("2026-07-29", new Date("2026-07-28T23:50:00Z"))).toBe(true);
    expect(shouldFinalizeEvidenceTemplate("2026-07-29", new Date("2026-07-29T00:05:00Z"))).toBe(true);
  });

  it("upserts domestic audits and global points by their unique keys", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return { bind: (...values: unknown[]) => ({ run: async () => { calls.push({ sql, values }); } }) };
      },
    } as unknown as D1Database;
    const audit: SourceAudit = {
      source: "东方财富", marketTime: "2026-07-23T15:00:00+08:00", receivedAt: "2026-07-23T07:00:00Z",
      rawCount: 100, validCount: 99, invalidCount: 1, coveragePct: 99, directionAgreementPct: 99,
      priceAgreementPct: 99, breadthDifference: 1, status: "complete", message: "双源一致",
    };
    await persistSourceAudits(db, "2026-07-23", "15:00", [audit]);
    await persistGlobalPoints(db, "2026-07-23", [{
      key: "sp500", label: "标普500", provider: "Twelve Data", value: 630, previousClose: 625, pctChange: .8,
      marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", status: "ok", message: "",
    }]);
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain("ON CONFLICT(trade_date, snapshot_time, source)");
    expect(calls[1].sql).toContain("ON CONFLICT(trade_date, symbol, provider)");
    expect(calls[0].values.slice(0, 3)).toEqual(["2026-07-23", "15:00", "东方财富"]);
    expect(calls[1].values.slice(0, 3)).toEqual(["2026-07-23", "sp500", "标普500"]);
  });

  it("builds objective metrics, ladders and rankings from quotes and the limit pool", () => {
    const review = buildDailyReview({
      date: "2026-07-22",
      quotes: [q("A", 10), q("B", -10), q("C", 8), q("D", 1)],
      limitPool: [q("A", 10, 2)],
      breadth: [{ time: "15:00", rising: 3, falling: 1, flat: 0 }],
      marginBalance: 26_000,
      high20: 7,
      high120: 4,
      allTimeHigh: 2,
      source: "东方财富",
    });
    expect(review.metrics).toMatchObject({ limitUp: 1, limitDown: 1, consecutive: 1, largeRise: 1, high20: 7, high120: 4, allTimeHigh: 2 });
    expect(review.ladder.second[0].symbol).toBe("A");
    expect(review.leaders[0].symbol).toBe("A");
    expect(review.sectors.every((sector) => sector.amountGrowthPct === null)).toBe(true);
    expect(review.structure).toMatchObject({
      status: "partial",
      source: "东方财富涨停池",
    });
    expect(review.status).toBe("partial");
  });

  it("does not mislabel quote-only limit-ups as first boards, sectors, or objective leaders", () => {
    const review = buildDailyReview({
      date: "2026-07-23",
      quotes: [q("600001.SH", 10), q("600002.SH", 10), q("600003.SH", 2)],
      limitPool: [],
      breadth: [],
      marginBalance: null,
      high20: 1,
      high120: 1,
      allTimeHigh: 1,
      source: "新浪财经",
      boardPools: null,
    });

    expect(review.metrics.limitUp).toBe(2);
    expect(review.metrics.consecutive).toBeNull();
    expect(review.ladder).toEqual({ first: [], second: [], third: [], fourth: [], fivePlus: [] });
    expect(review.sectors).toEqual([]);
    expect(review.leaders).toEqual([]);
    expect(review.structure).toMatchObject({
      status: "failed",
      message: expect.stringContaining("涨停池"),
    });
    expect(review.status).toBe("partial");
  });

  it("uses the verified four-pool snapshot as the authoritative ladder and sector source", () => {
    const boardPools: BoardPools = {
      limitUp: [
        { code: "600001", name: "二板甲", pctChange: 10, amount: 2e8, industry: "机器人", limitStreak: 2, previousLimitStreak: 1, firstLimitTime: "09:35:00" },
        { code: "600002", name: "首板乙", pctChange: 10, amount: 1e8, industry: "机器人", limitStreak: 1, previousLimitStreak: 0, firstLimitTime: "10:00:00" },
      ],
      broken: [],
      limitDown: [],
      yesterdayLimitUp: [],
    };
    const review = buildDailyReview({
      date: "2026-07-23",
      quotes: [q("600001.SH", 10), q("600002.SH", 10), q("600003.SH", 2)],
      limitPool: [],
      breadth: [],
      marginBalance: null,
      high20: 1,
      high120: 1,
      allTimeHigh: 1,
      source: "新浪财经",
      boardPools,
    });

    expect(review.metrics).toMatchObject({ limitUp: 2, consecutive: 1 });
    expect(review.ladder.second.map((item) => item.name)).toEqual(["二板甲"]);
    expect(review.ladder.first.map((item) => item.name)).toEqual(["首板乙"]);
    expect(review.sectors[0]).toMatchObject({ name: "机器人", limitUpCount: 2, maxStreak: 2 });
    expect(review.leaders[0]).toMatchObject({ name: "二板甲", limitStreak: 2 });
    expect(review.structure).toMatchObject({
      status: "complete",
      source: "东方财富四池",
    });
  });

  it("attaches the verified comparison snapshot to the daily review", () => {
    const boardPools: BoardPools = {
      limitUp: [{ code: "600001", name: "二板甲", pctChange: 10, amount: 2e8, industry: "机器人", limitStreak: 2, previousLimitStreak: 0, firstLimitTime: "09:35:00" }],
      broken: [{ code: "600002", name: "炸板乙", pctChange: 3, amount: 1e8, industry: "电子", limitStreak: 1, previousLimitStreak: 0, firstLimitTime: "10:00:00" }],
      limitDown: [],
      yesterdayLimitUp: [{ code: "600003", name: "昨日二板丙", pctChange: -2, amount: 1e8, industry: "医药", limitStreak: 0, previousLimitStreak: 2, firstLimitTime: "09:40:00" }],
    };
    const marketAggregate: MarketAggregate = {
      amount: 18_000,
      rawCount: 5_300,
      validCount: 5_250,
      coveragePct: 99.06,
      marketTime: "2026-07-22T15:00:00+08:00",
      receivedAt: "2026-07-22T08:10:00.000Z",
      source: "东方财富",
      status: "complete",
      message: "",
    };

    const review = buildDailyReview({
      date: "2026-07-22",
      quotes: [q("600001.SH", 10, 2), q("600003.SH", -2)],
      limitPool: [q("600001.SH", 10, 2)],
      breadth: [],
      marginBalance: null,
      high120: null,
      allTimeHigh: null,
      source: "东方财富",
      boardPools,
      marketAggregate,
      indices: [],
      receivedAt: "2026-07-22T08:10:00.000Z",
    });

    expect(review.comparison).toMatchObject({
      brokenCount: 1,
      sealRate: 50,
      marketAmount: 18_000,
      brokenBoard: { count: 1, rate: 100, sampleSize: 1 },
    });
    expect(review.premium).toEqual({ openPct: 2, closePct: -2, sampleSize: 1 });
  });

  it("marks unavailable new-high data partial instead of inventing zero values", () => {
    const review = buildDailyReview({
      date: "2026-07-22", quotes: [], limitPool: [], breadth: [], marginBalance: null,
      high120: null, allTimeHigh: null, source: "东方财富",
    });
    expect(review.status).toBe("partial");
    expect(review.metrics.high120).toBeNull();
    expect(review.metrics.allTimeHigh).toBeNull();
  });

  it("does not fabricate a 15:00 breadth snapshot when the scheduled row is missing", () => {
    const review = buildDailyReview({
      date: "2026-07-23", quotes: [q("A", 1), q("B", -1), q("C", 0)], limitPool: [], breadth: [],
      marginBalance: null, high120: null, allTimeHigh: null, source: "东方财富",
    });
    expect(review.breadth).toEqual([]);
    expect(review.breadthMeta).toEqual({
      expected: 6,
      captured: 0,
      missing: ["09:25", "10:00", "11:00", "13:00", "14:00", "15:00"],
      status: "partial",
    });
  });

  it("persists a partial morning job run and names its failed module", async () => {
    const { db, fetcher, jobUpdates } = morningBriefJobHarness(["mapping"]);

    await expect(runPanLayerJob({ type: "morning-brief" }, new Date("2026-07-22T23:15:00Z"), { DB: db, DASHSCOPE_API_KEY: "qwen" }, { fetcher }))
      .resolves.toMatchObject({ ok: true, message: expect.stringContaining("partial") });

    expect(jobUpdates.at(-1)).toEqual({ status: "partial", message: "incomplete modules: mapping" });
  });

  it("tries the three Qwen tiers once for each failing module", async () => {
    const { db, fetcher, requests } = morningBriefJobHarness(["risk", "mapping"]);

    await runPanLayerJob({ type: "morning-brief" }, new Date("2026-07-22T23:15:00Z"), { DB: db, DASHSCOPE_API_KEY: "qwen" }, { fetcher, sectionKeys: ["risk", "mapping"] });

    expect(requests.risk).toBe(3);
    expect(requests.mapping).toBe(3);
  });

  it("advances one Qwen module per automatic scheduler tick", async () => {
    const { db, fetcher, requests } = morningBriefJobHarness([]);

    await expect(runPanLayerJob(
      { type: "morning-brief" },
      new Date("2026-07-22T23:15:00Z"),
      { DB: db, DASHSCOPE_API_KEY: "qwen" },
      { fetcher, trigger: "cron" },
    )).resolves.toMatchObject({
      ok: true,
      status: "partial",
    });

    expect(requests).toEqual({ "global-markets": 1 });
  });

  it("does not call Firecrawl when the first Qwen generation succeeds", async () => {
    const { db } = morningBriefJobHarness([]);
    const calls = { qwen: 0, firecrawl: 0 };
    const fetcher: typeof fetch = async (input) => {
      if (String(input).includes("firecrawl.example")) {
        calls.firecrawl += 1;
        return Response.json({ success: true, data: { news: [] } });
      }
      calls.qwen += 1;
      return qwenResponse("risk");
    };

    await runPanLayerJob(
      { type: "morning-brief" },
      new Date("2026-07-22T23:15:00Z"),
      {
        DB: db,
        DASHSCOPE_API_KEY: "qwen",
        FIRECRAWL_API_KEY: "firecrawl",
        FIRECRAWL_API_URL: "https://firecrawl.example/v2/search",
      },
      { fetcher, sectionKeys: ["risk"] },
    );

    expect(calls).toEqual({ qwen: 1, firecrawl: 0 });
  });

  it("falls from qwen3.7-plus to qwen3.6-plus after a provider failure", async () => {
    const { db } = morningBriefJobHarness([]);
    const models: string[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      models.push(body.model);
      if (models.length === 1) return Response.json({ message: "provider unavailable" }, { status: 503 });
      return qwenResponse("risk");
    };

    const result = await runPanLayerJob(
      { type: "morning-brief" },
      new Date("2026-07-22T23:15:00Z"),
      {
        DB: db,
        DASHSCOPE_API_KEY: "qwen",
      },
      { fetcher, sectionKeys: ["risk"] },
    );

    expect(result.ok).toBe(true);
    expect(models).toEqual(["qwen3.7-plus", "qwen3.6-plus"]);
  });

  it("uses qwen3.7-max as the final model and does not call Firecrawl on demand", async () => {
    const { db } = morningBriefJobHarness([]);
    const models: string[] = [];
    let firecrawlCalls = 0;
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input).includes("firecrawl.example")) {
        firecrawlCalls += 1;
      }
      models.push(JSON.parse(String(init?.body)).model);
      return Response.json({ message: "provider unavailable" }, { status: 503 });
    };

    await runPanLayerJob(
      { type: "morning-brief" },
      new Date("2026-07-22T23:15:00Z"),
      {
        DB: db,
        DASHSCOPE_API_KEY: "qwen",
        FIRECRAWL_API_KEY: "firecrawl",
        FIRECRAWL_API_URL: "https://firecrawl.example/v2/search",
      },
      { fetcher, sectionKeys: ["risk"] },
    );

    expect(models).toEqual(["qwen3.7-plus", "qwen3.6-plus", "qwen3.7-max"]);
    expect(firecrawlCalls).toBe(0);
  });

  it("does not leave the requested Qwen chain for OpenAI", async () => {
    const { db } = morningBriefJobHarness([]);
    const calls = { qwen: 0, openai: 0 };
    const fetcher: typeof fetch = async (input) => {
      if (String(input).includes("api.openai.com")) {
        calls.openai += 1;
        return openAIResponse("risk");
      }
      calls.qwen += 1;
      return Response.json({ message: "provider unavailable" }, { status: 503 });
    };

    await runPanLayerJob(
      { type: "morning-brief" },
      new Date("2026-07-22T23:15:00Z"),
      {
        DB: db,
        DASHSCOPE_API_KEY: "qwen",
        OPENAI_API_KEY: "openai",
      },
      { fetcher, sectionKeys: ["risk"] },
    );

    expect(calls).toEqual({ qwen: 3, openai: 0 });
  });

  it("skips later Qwen tiers when the batch has less than eight seconds left", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-07-22T23:15:00Z");
      vi.setSystemTime(now);
      const { db } = morningBriefJobHarness([]);
      let qwenCalls = 0;
      const fetcher: typeof fetch = async () => {
        qwenCalls += 1;
        vi.setSystemTime(new Date(now.getTime() + 143_000));
        return Response.json({ message: "provider unavailable" }, { status: 503 });
      };

      await runPanLayerJob(
        { type: "morning-brief" },
        now,
        {
          DB: db,
          DASHSCOPE_API_KEY: "qwen",
          FIRECRAWL_API_KEY: "firecrawl",
          FIRECRAWL_API_URL: "https://firecrawl.example/v2/search",
        },
        { fetcher, sectionKeys: ["risk"] },
      );

      expect(qwenCalls).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not perform a redundant outer retry for an explicit Qwen module", async () => {
    const { db } = morningBriefJobHarness([]);
    const requests: string[] = [];
    let calls = 0;
    const fetcher: typeof fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const prompt = request.messages[1].content;
      requests.push(prompt);
      calls += 1;
      const definition = BRIEF_SECTION_DEFINITIONS.find((item) => prompt.includes(`key 必须为 "${item.key}"`))!;
      const terms = calls === 1 ? definition.requiredTerms.filter((term) => term !== "关键") : definition.requiredTerms;
      const section = {
        key: definition.key,
        title: definition.title,
        summary: "已核验的隔夜市场信息摘要。",
        tags: ["市场"],
        blocks: [{ type: "paragraph", text: `${terms.join("、")}。${"客观市场事实与影响解读。".repeat(120)}`, sourceIds: ["ref_1"] }],
      };
      return new Response(JSON.stringify({
        output: { choices: [{ message: { content: JSON.stringify(section) } }], search_info: { search_results: [{ index: 1, title: "可靠来源", url: "https://example.com/risk" }] } },
      }));
    };

    await expect(runPanLayerJob({ type: "morning-brief" }, new Date("2026-07-22T23:15:00Z"), { DB: db, DASHSCOPE_API_KEY: "qwen" }, { fetcher, sectionKeys: ["risk"] }))
      .resolves.toMatchObject({ ok: true, status: "partial", message: expect.stringContaining("partial") });

    expect(calls).toBe(1);
    expect(requests).toHaveLength(1);
  });

  it("persists a readable partial fallback and names every incomplete module", async () => {
    const failedKeys = BRIEF_SECTION_DEFINITIONS_V3.map((item) => item.key);
    const { db, fetcher, jobUpdates } = morningBriefJobHarness(failedKeys);

    await expect(runPanLayerJob({ type: "morning-brief" }, new Date("2026-07-22T23:15:00Z"), { DB: db, DASHSCOPE_API_KEY: "qwen" }, { fetcher }))
      .resolves.toMatchObject({ ok: true, status: "partial", message: expect.stringContaining("partial") });

    expect(jobUpdates.at(-1)).toEqual({ status: "partial", message: `incomplete modules: ${failedKeys.join(", ")}` });
  });
});
