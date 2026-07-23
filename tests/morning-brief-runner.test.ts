import { describe, expect, it, vi } from "vitest";
import { BRIEF_SECTION_DEFINITIONS, type BriefSection, type BriefSectionKey } from "../lib/ai/morning-brief-contract";
import type { BriefSectionGenerator, GeneratedBriefSection } from "../lib/ai/morning-brief-providers";
import { generateFullMorningBrief } from "../lib/jobs/runner";

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
            const [date] = call.values;
            return briefs.get(String(date)) ?? null;
          },
        };
      },
    } as unknown as D1Database,
  };
}

describe("full morning brief runner", () => {
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
    const generator: BriefSectionGenerator = async ({ key }) => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient provider timeout");
      return generated(key);
    };

    await generateFullMorningBrief({ date: DATE, model: "qwen-plus", sectionKeys: ["risk"], generator, db, retries: 2 });

    expect(attempts).toBe(3);
    expect(sections.get(`${DATE}:risk`)).toMatchObject({ status: "complete", attempts: 3, error: "" });
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
