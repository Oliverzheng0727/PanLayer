import { describe, expect, it, vi } from "vitest";
import { BRIEF_SECTION_DEFINITIONS, type BriefSectionKey } from "../lib/ai/morning-brief-contract";
import { acquireJobLease, buildDailyReview, persistGlobalPoints, persistSourceAudits, releaseJobLease, resolveMorningBriefProvider, runPanLayerJob, shouldSkipMorningBrief } from "../lib/jobs/runner";
import * as runnerModule from "../lib/jobs/runner";
import { loadGlobalOvernightSnapshot } from "../lib/data/global/overnight";
import type { Quote } from "../lib/domain/types";
import type { SourceAudit } from "../lib/data/quality";

vi.mock("../lib/data/global/overnight", () => ({
  loadGlobalOvernightSnapshot: vi.fn(async () => ({ raw: [], reconciled: [] })),
}));

const q = (symbol: string, pctChange: number, streak = 0): Quote => ({
  symbol, name: symbol, exchange: "SH", board: "MAIN", isST: false, isNoLimitDay: false,
  previousClose: 10, open: 10.2, price: pctChange === 10 ? 11 : 10 * (1 + pctChange / 100),
  high: 11, low: 9.8, pctChange, amount: 100, turnoverRate: 2,
  limitUpPrice: 11, limitDownPrice: 9, sector: streak ? "机器人" : "银行",
  firstLimitTime: streak ? "09:35:00" : null, limitStreak: streak,
});

function morningBriefJobHarness(failedKeys: BriefSectionKey[]) {
  const jobUpdates: Array<{ status: string; message: string }> = [];
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
    const request = JSON.parse(String(init?.body)) as { input: { messages: Array<{ content: string }> } };
    const prompt = request.input.messages[1].content;
    const definition = BRIEF_SECTION_DEFINITIONS.find((item) => prompt.includes(`key 必须为 "${item.key}"`));
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
  return { db, fetcher, jobUpdates };
}

function orchestratedLeaseHarness() {
  let lease: { token: string; expiresAt: string } | null = null;
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
            const [,, token,,, now] = values as string[];
            const expiresAt = String(values[4]);
            if (lease && lease.expiresAt > now) return null;
            lease = { token, expiresAt };
            return { token };
          }
          if (sql.startsWith("UPDATE job_leases")) {
            const [, expiresAt,,, token, now] = values as string[];
            if (!lease || lease.token !== token || lease.expiresAt <= now) return null;
            lease = { token, expiresAt };
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
  const definition = BRIEF_SECTION_DEFINITIONS.find((item) => item.key === key)!;
  return new Response(JSON.stringify(status === 200 ? {
    output: { choices: [{ message: { content: JSON.stringify({ key, title: definition.title, summary: "摘要", tags: ["测试"], blocks: [{ type: "paragraph", text: `${definition.requiredTerms.join("、")}。${"客观事实与盘面映射。".repeat(130)}`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: `https://example.com/${key}` }] } },
  } : { message: "provider unavailable" }), { status });
}

describe("close review aggregation", () => {
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
      const fetcher: typeof fetch = async (_input, init) => qwenResponse(BRIEF_SECTION_DEFINITIONS.find((item) => JSON.parse(String(init?.body)).input.messages[1].content.includes(`key 必须为 "${item.key}"`))!.key);
      const oldRun = runPanLayerJob({ type: "morning-brief" }, at, { DB: db, DASHSCOPE_API_KEY: "qwen" }, { fetcher, sectionKeys: ["risk"] });
      await reached;
      vi.setSystemTime(new Date("2026-07-22T23:31:00Z"));
      await expect(runPanLayerJob({ type: "morning-brief" }, at, { DB: db, DASHSCOPE_API_KEY: "qwen" }, { fetcher, sectionKeys: ["risk"] })).resolves.toMatchObject({ ok: true });
      resume();

      await expect(oldRun).rejects.toThrow(/lease/i);
      expect(globalWrites).toEqual(["标普500"]);
      expect(sectionWrites).toEqual([{ key: "risk", status: "complete", model: "qwen-plus" }]);
      expect(aggregateWrites).toEqual(["qwen-plus"]);
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
        const key = BRIEF_SECTION_DEFINITIONS.find((item) => JSON.parse(String(init?.body)).input.messages[1].content.includes(`key 必须为 "${item.key}"`))!.key;
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
      expect(sectionWrites).toEqual([{ key: "risk", status: "complete", model: "qwen-plus" }]);
      expect(aggregateWrites).toEqual(["qwen-plus"]);
    } finally { vi.useRealTimers(); }
  });

  it("keeps an active morning lease through a stale release so an overlap cannot take its writes", async () => {
    let lease: { token: string; expiresAt: string } | null = null;
    const db = {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...bound: unknown[]) { values = bound; return this; },
          async first() {
            if (!sql.includes("job_leases")) return null;
            const [,, token,, expiresAt, now] = values as string[];
            if (lease && lease.expiresAt > now) return null;
            lease = { token, expiresAt };
            return { token };
          },
          async run() {
            if (sql.startsWith("DELETE") && lease?.token === values[2]) lease = null;
            return {};
          },
        };
      },
    } as unknown as D1Database;
    const first = await acquireJobLease(db, "morning-brief", "2026-07-23", new Date("2026-07-22T23:00:00Z"));
    const overlapping = await acquireJobLease(db, "morning-brief", "2026-07-23", new Date("2026-07-22T23:01:00Z"));

    expect(first).toBeTruthy();
    expect(overlapping).toBeNull();
    await releaseJobLease(db, "morning-brief", "2026-07-23", "stale-token");
    expect(lease?.token).toBe(first);
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
  });

  it("prefers Qwen and keeps OpenAI as an optional fallback", () => {
    expect(resolveMorningBriefProvider({ DASHSCOPE_API_KEY: "qwen", OPENAI_API_KEY: "openai" })).toMatchObject({
      provider: "qwen",
      apiKey: "qwen",
      model: "qwen-plus",
    });
    expect(resolveMorningBriefProvider({ OPENAI_API_KEY: "openai" })).toMatchObject({
      provider: "openai",
      apiKey: "openai",
      model: "gpt-5.6-terra",
    });
    expect(() => resolveMorningBriefProvider({})).toThrow("DASHSCOPE_API_KEY");
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
      high120: 4,
      allTimeHigh: 2,
      source: "东方财富",
    });
    expect(review.metrics).toMatchObject({ limitUp: 1, limitDown: 1, consecutive: 1, largeRise: 1, high120: 4, allTimeHigh: 2 });
    expect(review.ladder.second[0].symbol).toBe("A");
    expect(review.leaders[0].symbol).toBe("A");
    expect(review.status).toBe("complete");
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

  it("derives a 15:00 breadth snapshot when close review has no intraday rows", () => {
    const review = buildDailyReview({
      date: "2026-07-23", quotes: [q("A", 1), q("B", -1), q("C", 0)], limitPool: [], breadth: [],
      marginBalance: null, high120: null, allTimeHigh: null, source: "东方财富",
    });
    expect(review.breadth).toEqual([{ time: "15:00", rising: 1, falling: 1, flat: 1 }]);
  });

  it("persists a partial morning job run and names its failed module", async () => {
    const { db, fetcher, jobUpdates } = morningBriefJobHarness(["mapping"]);

    await expect(runPanLayerJob({ type: "morning-brief" }, new Date("2026-07-22T23:15:00Z"), { DB: db, DASHSCOPE_API_KEY: "qwen" }, { fetcher }))
      .resolves.toMatchObject({ ok: true, message: expect.stringContaining("partial") });

    expect(jobUpdates.at(-1)).toEqual({ status: "partial", message: "failed modules: mapping" });
  });

  it("persists a failed morning job run and names every failed module", async () => {
    const failedKeys = BRIEF_SECTION_DEFINITIONS.map((item) => item.key);
    const { db, fetcher, jobUpdates } = morningBriefJobHarness(failedKeys);

    await expect(runPanLayerJob({ type: "morning-brief" }, new Date("2026-07-22T23:15:00Z"), { DB: db, DASHSCOPE_API_KEY: "qwen" }, { fetcher }))
      .resolves.toMatchObject({ ok: false, message: expect.stringContaining("failed") });

    expect(jobUpdates.at(-1)).toEqual({ status: "failed", message: `failed modules: ${failedKeys.join(", ")}` });
  });
});
