import { describe, expect, it } from "vitest";
import { BRIEF_SECTION_DEFINITIONS, type MorningBrief } from "../lib/ai/morning-brief-contract";
import { demoBrief } from "../lib/data/demo";
import { readLatestBriefFromDatabase } from "../lib/data/repository";
import { selectDashboardBrief } from "../lib/data/brief-selection";

describe("latest valid morning brief fallback", () => {
  it("skips malformed newer rows and returns the latest valid persisted brief", async () => {
    const valid: MorningBrief = {
      schemaVersion: 2,
      date: "2026-07-24",
      status: "complete",
      generatedAt: "2026-07-24T07:15:00+08:00",
      sections: BRIEF_SECTION_DEFINITIONS.map((definition, index) => ({
        key: definition.key,
        title: definition.title,
        summary: "三行以内摘要",
        tags: ["重点"],
        status: "complete",
        generatedAt: "2026-07-24T07:15:00+08:00",
        blocks: [{
          type: "paragraph",
          text: `${definition.requiredTerms.join("、")}。${"市场事实与影响解读。".repeat(100)}`,
          sourceIds: [`s${index}`],
        }],
        sourceIds: [`s${index}`],
      })),
      sources: BRIEF_SECTION_DEFINITIONS.map((_, index) => ({
        id: `s${index}`,
        title: `来源${index}`,
        url: `https://example.com/${index}`,
        publishedAt: "2026-07-24T06:00:00+08:00",
        retrievedAt: "2026-07-24T07:15:00+08:00",
      })),
      disclaimer: "仅供市场复盘，不构成投资建议。",
    };
    const bound: unknown[][] = [];
    const db = {
      prepare(sql: string) {
        expect(sql).toContain("trade_date <= ?");
        expect(sql).toContain("ORDER BY trade_date DESC");
        return {
          bind(...values: unknown[]) {
            bound.push(values);
            return this;
          },
          async all() {
            return {
              results: [
                { payload: "{not-json" },
                { payload: JSON.stringify(valid) },
              ],
            };
          },
        };
      },
    } as unknown as D1Database;

    await expect(readLatestBriefFromDatabase(db, "2026-07-25")).resolves.toEqual(valid);
    expect(bound).toEqual([["2026-07-25"]]);
  });

  it("uses the exact-date brief first and otherwise keeps the fallback brief's real date", () => {
    const exact = { ...structuredClone(demoBrief), date: "2026-07-25" } as MorningBrief;
    const latest = { ...structuredClone(demoBrief), date: "2026-07-24" } as MorningBrief;

    expect(selectDashboardBrief(exact, latest)).toBe(exact);
    expect(selectDashboardBrief(null, latest)).toBe(latest);
    expect(selectDashboardBrief(null, latest)?.date).toBe("2026-07-24");
  });
});
