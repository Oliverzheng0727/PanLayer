import { describe, expect, it } from "vitest";
import { failedBriefSection, persistBriefSection, readPersistedBriefSections } from "../lib/ai/morning-brief-assembly";

function memoryD1() {
  const rows = new Map<string, Record<string, unknown>>();
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  return {
    rows,
    calls,
    db: {
      prepare(sql: string) {
        const call = { sql, values: [] as unknown[] };
        calls.push(call);
        return {
          bind(...values: unknown[]) {
            call.values = values;
            return this;
          },
          async run() {
            const [date, key, model, payload, status, attempts, error, generatedAt, updatedAt] = call.values;
            rows.set(`${date}:${key}`, { trade_date: date, section_key: key, model, payload, status, attempts, error, generated_at: generatedAt, updated_at: updatedAt });
            return {};
          },
          async all() {
            const [date] = call.values;
            return { results: [...rows.values()].filter((row) => row.trade_date === date) };
          },
        };
      },
    } as never,
  };
}

describe("morning brief section persistence", () => {
  it("upserts a section by trade date and section key and reads it back", async () => {
    const { db, calls } = memoryD1();
    const date = "2026-07-23";
    const first = failedBriefSection("risk", "first failure", "2026-07-23T07:15:00+08:00");
    const second = failedBriefSection("risk", "second failure", "2026-07-23T07:16:00+08:00");

    await persistBriefSection(db, date, "qwen-plus", first, 1, "first failure");
    await persistBriefSection(db, date, "qwen-plus", second, 2, "second failure");

    expect(calls[0].sql).toContain("ON CONFLICT(trade_date, section_key)");
    expect(calls[0].values).toEqual(expect.arrayContaining([date, "risk", "qwen-plus", 1, "first failure"]));
    await expect(readPersistedBriefSections(db, date)).resolves.toEqual([second]);
  });

  it("ignores malformed JSON payloads", async () => {
    const { db, rows } = memoryD1();
    rows.set("2026-07-23:risk", {
      trade_date: "2026-07-23",
      section_key: "risk",
      status: "failed",
      payload: "{not valid JSON",
    });

    await expect(readPersistedBriefSections(db, "2026-07-23")).resolves.toEqual([]);
  });

  it("ignores persisted sections with malformed tags", async () => {
    const { db, rows } = memoryD1();
    const section = failedBriefSection("risk", "provider timeout", "2026-07-23T07:15:00+08:00");
    rows.set("2026-07-23:risk", {
      trade_date: "2026-07-23",
      section_key: "risk",
      status: "failed",
      payload: JSON.stringify({ ...section, tags: [42] }),
    });

    await expect(readPersistedBriefSections(db, "2026-07-23")).resolves.toEqual([]);
  });

  it("ignores rows whose key or status disagrees with the payload", async () => {
    const { db, rows } = memoryD1();
    const section = failedBriefSection("risk", "provider timeout", "2026-07-23T07:15:00+08:00");
    rows.set("2026-07-23:domestic", {
      trade_date: "2026-07-23",
      section_key: "domestic",
      status: "failed",
      payload: JSON.stringify(section),
    });
    rows.set("2026-07-23:risk", {
      trade_date: "2026-07-23",
      section_key: "risk",
      status: "partial",
      payload: JSON.stringify(section),
    });

    await expect(readPersistedBriefSections(db, "2026-07-23")).resolves.toEqual([]);
  });
});
