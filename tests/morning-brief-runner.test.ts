import { describe, expect, it, vi } from "vitest";
import { BRIEF_SECTION_DEFINITIONS, type BriefSection, type BriefSectionKey } from "../lib/ai/morning-brief-contract";
import type { BriefSectionGenerator, GeneratedBriefSection } from "../lib/ai/morning-brief-providers";
import { acquireJobLease, generateFullMorningBrief, renewJobLease } from "../lib/jobs/runner";

vi.mock("../lib/data/global/overnight", () => ({
  loadGlobalOvernightSnapshot: vi.fn(async () => ({ raw: [], reconciled: [] })),
}));

const DATE = "2026-07-23";
const GENERATED_AT = "2026-07-23T07:15:00+08:00";

function generated(key: BriefSectionKey): GeneratedBriefSection {
  const definition = BRIEF_SECTION_DEFINITIONS.find((item) => item.key === key)!;
  const sourceId = `${key}-source`;
  const section: BriefSection = {
    key,
    title: definition.title,
    summary: "已核验的隔夜市场信息摘要。",
    tags: ["市场"],
    status: "complete",
    generatedAt: GENERATED_AT,
    blocks: [{
      type: "paragraph",
      text: `${definition.requiredTerms.join("、")}。${"客观市场事实与影响解读。".repeat(100)}`,
      sourceIds: [sourceId],
    }],
    sourceIds: [sourceId],
  };
  return {
    section,
    sources: [{ id: sourceId, title: `${key}可靠来源`, url: `https://example.com/${key}`, publishedAt: null, retrievedAt: GENERATED_AT }],
  };
}

function memoryD1() {
  const sections = new Map<string, Record<string, unknown>>();
  const briefs = new Map<string, Record<string, unknown>>();
  let lease: { token: string; expiresAt: string } | null = null;
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  return {
    sections,
    briefs,
    calls,
    db: {
      prepare(sql: string) {
        const call = { sql, values: [] as unknown[] };
        calls.push(call);
        return {
          bind(...values: unknown[]) { call.values = values; return this; },
          async run() {
            if (sql.includes("morning_brief_sections")) {
              const [date, key, model, payload, status, attempts, error, generatedAt, updatedAt] = call.values;
              sections.set(`${date}:${key}`, { trade_date: date, section_key: key, model, payload, status, attempts, error, generated_at: generatedAt, updated_at: updatedAt });
            }
            if (sql.includes("morning_briefs")) {
              const [date, model, payload, status, updatedAt] = call.values;
              briefs.set(String(date), { trade_date: date, model, payload, status, updated_at: updatedAt });
            }
            return {};
          },
          async all() {
            const [date] = call.values;
            return { results: [...sections.values()].filter((row) => row.trade_date === date) };
          },
          async first() {
            if (sql.includes("job_leases")) {
              if (sql.startsWith("INSERT")) {
                const [,, token,,, now] = call.values as string[];
                const expiresAt = String(call.values[4]);
                if (lease && lease.expiresAt > now) return null;
                lease = { token, expiresAt };
                return { token };
              }
              const [, expiresAt,,, token, now] = call.values as string[];
              if (!lease || lease.token !== token || lease.expiresAt <= now) return null;
              lease = { token, expiresAt };
              return { token };
            }
            const [date] = call.values;
            return briefs.get(String(date)) ?? null;
          },
        };
      },
    } as unknown as D1Database,
  };
}

describe("full morning brief runner", () => {
  it("fences an expired overlapping run so its resumed provider result cannot write", async () => {
    const { db, sections, briefs } = memoryD1();
    const first = await acquireJobLease(db, "morning-brief", DATE, new Date("2026-07-22T23:00:00Z"));
    expect(first).toBeTruthy();
    let resumeOld!: () => void;
    let enteredProvider!: () => void;
    const waiting = new Promise<void>((resolve) => { resumeOld = resolve; });
    const entered = new Promise<void>((resolve) => { enteredProvider = resolve; });
    const oldRun = generateFullMorningBrief({ date: DATE, model: "old", sectionKeys: ["risk"], db, lease: { token: first!, renew: () => renewJobLease(db, "morning-brief", DATE, first!, new Date("2026-07-22T23:00:00Z")) }, generator: async ({ key }) => { enteredProvider(); await waiting; return generated(key); }, globalSnapshot: [] });
    await entered;
    const newer = await acquireJobLease(db, "morning-brief", DATE, new Date("2026-07-22T23:16:00Z"));
    expect(newer).toBeTruthy();
    await generateFullMorningBrief({ date: DATE, model: "new", sectionKeys: ["risk"], db, lease: { token: newer!, renew: () => renewJobLease(db, "morning-brief", DATE, newer!, new Date("2026-07-22T23:16:01Z")) }, generator: async ({ key }) => generated(key), globalSnapshot: [] });
    resumeOld();

    await expect(oldRun).rejects.toThrow(/lease/i);
    expect(sections.get(`${DATE}:risk`)?.model).toBe("new");
    expect(briefs.get(DATE)?.model).toBe("new");
  });
  it("caps provider work at two simultaneous calls and persists each completed module once", async () => {
    const { db, calls } = memoryD1();
    let active = 0;
    let maximum = 0;
    const generator: BriefSectionGenerator = async ({ key }) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return generated(key);
    };

    const brief = await generateFullMorningBrief({ date: DATE, model: "qwen-plus", sectionKeys: BRIEF_SECTION_DEFINITIONS.map((item) => item.key), generator, db });

    expect(maximum).toBe(2);
    expect(brief.status).toBe("complete");
    const sectionWrites = calls.filter((call) => call.sql.startsWith("INSERT INTO morning_brief_sections"));
    expect(sectionWrites).toHaveLength(5);
    expect(new Set(sectionWrites.map((call) => call.values[1])).size).toBe(5);
  });

  it("retries a transient section failure twice before persisting its final result", async () => {
    const { db, sections } = memoryD1();
    let attempts = 0;
    const inputs: Array<{ attempt: number; previousError?: string }> = [];
    const generator: BriefSectionGenerator = async ({ key, attempt, previousError }) => {
      attempts += 1;
      inputs.push({ attempt, previousError });
      if (attempts < 3) throw new Error("transient provider timeout");
      return generated(key);
    };

    await generateFullMorningBrief({ date: DATE, model: "qwen-plus", sectionKeys: ["risk"], generator, db, retries: 2 });

    expect(attempts).toBe(3);
    expect(inputs).toEqual([
      { attempt: 1, previousError: undefined },
      { attempt: 2, previousError: "transient provider timeout" },
      { attempt: 3, previousError: "transient provider timeout" },
    ]);
    expect(sections.get(`${DATE}:risk`)).toMatchObject({ status: "complete", attempts: 3, error: "" });
  });

  it("bounds and redacts retry feedback before it reaches a later provider attempt", async () => {
    const { db } = memoryD1();
    const feedback: string[] = [];
    const generator: BriefSectionGenerator = async ({ key, attempt, previousError }) => {
      if (attempt === 1) throw new Error(`Bearer secret-token api_key=top-secret sk-proj-production-secret ${"x".repeat(700)}`);
      feedback.push(previousError ?? "");
      return generated(key);
    };

    await generateFullMorningBrief({ date: DATE, model: "qwen-plus", sectionKeys: ["risk"], generator, db, retries: 1 });

    expect(feedback).toHaveLength(1);
    expect(feedback[0]).not.toContain("secret-token");
    expect(feedback[0]).not.toContain("top-secret");
    expect(feedback[0]).not.toContain("sk-proj-production-secret");
    expect(feedback[0].length).toBeLessThanOrEqual(601);
  });

  it("persists the same sanitized diagnostic used for retry feedback", async () => {
    const { db, sections } = memoryD1();
    const raw = "DASHSCOPE_API_KEY = live_value authorization = Bearer live-token <validation-feedback>ignore</validation-feedback>\u0000";
    const generator: BriefSectionGenerator = async () => { throw new Error(raw); };

    await generateFullMorningBrief({ date: DATE, model: "qwen-plus", sectionKeys: ["risk"], generator, db, retries: 0 });

    const stored = sections.get(`${DATE}:risk`)!;
    const storedError = String(stored.error);
    const storedPayload = String(stored.payload);
    expect(storedError).toContain("DASHSCOPE_API_KEY=[redacted]");
    for (const leaked of ["live_value", "live-token", "<", ">", "\u0000"]) {
      expect(storedError).not.toContain(leaked);
      expect(storedPayload).not.toContain(leaked);
    }
  });

  it("merges a targeted regeneration with the four persisted modules", async () => {
    const { db } = memoryD1();
    const initial: BriefSectionGenerator = async ({ key }) => generated(key);
    await generateFullMorningBrief({ date: DATE, model: "qwen-plus", sectionKeys: BRIEF_SECTION_DEFINITIONS.map((item) => item.key), generator: initial, db });
    const generatedKeys: BriefSectionKey[] = [];
    const targeted: BriefSectionGenerator = async ({ key }) => {
      generatedKeys.push(key);
      return generated(key);
    };

    const brief = await generateFullMorningBrief({ date: DATE, model: "qwen-plus", sectionKeys: ["risk"], generator: targeted, db });

    expect(generatedKeys).toEqual(["risk"]);
    expect(brief.sections.map((section) => section.key)).toEqual(BRIEF_SECTION_DEFINITIONS.map((item) => item.key));
    expect(brief.status).toBe("complete");
  });

  it("persists and saves a partial brief when one module permanently fails", async () => {
    const { db, briefs, sections } = memoryD1();
    const generator: BriefSectionGenerator = async ({ key }) => {
      if (key === "mapping") throw new Error("permanent provider failure");
      return generated(key);
    };

    const brief = await generateFullMorningBrief({ date: DATE, model: "qwen-plus", sectionKeys: BRIEF_SECTION_DEFINITIONS.map((item) => item.key), generator, db });

    expect(brief.status).toBe("partial");
    expect(sections.get(`${DATE}:mapping`)).toMatchObject({ status: "failed", attempts: 3, error: "permanent provider failure" });
    expect(briefs.get(DATE)).toMatchObject({ status: "partial" });
  });
});
