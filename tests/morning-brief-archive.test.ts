import { describe, expect, it } from "vitest";
import { pruneBriefArchive, summarizeMorningBrief } from "../lib/ai/morning-brief-archive";
import type { MorningBrief } from "../lib/ai/morning-brief-contract";

function createBrief(date: string): MorningBrief {
  return {
    schemaVersion: 3,
    date,
    status: "partial",
    generatedAt: `${date}T07:15:00+08:00`,
    disclaimer: "不构成投资建议",
    sources: [
      { id: "s1", title: "来源", url: "https://example.com", publishedAt: null, retrievedAt: `${date}T07:00:00+08:00` },
    ],
    sections: [
      {
        key: "global-markets",
        title: "全球外围与跨资产全景",
        summary: "摘要",
        tags: [],
        status: "complete",
        generatedAt: `${date}T07:15:00+08:00`,
        sourceIds: ["s1"],
        blocks: [
          { type: "heading", text: "市场" },
          { type: "bullets", items: [{ text: "一", sourceIds: ["s1"] }, { text: "二", sourceIds: ["s1"] }] },
        ],
      },
      {
        key: "risk",
        title: "盘前情景预判、观察信号与风险",
        summary: "风险",
        tags: [],
        status: "failed",
        generatedAt: `${date}T07:15:00+08:00`,
        sourceIds: [],
        blocks: [{ type: "callout", tone: "missing", text: "暂缺", sourceIds: [] }],
      },
    ],
  };
}

describe("morning brief archive", () => {
  it("summarizes module content and source counts for the history profile", () => {
    const summary = summarizeMorningBrief(createBrief("2026-07-28"));
    expect(summary.completeModules).toBe(1);
    expect(summary.failedModules).toBe(1);
    expect(summary.modules[0]).toMatchObject({ itemCount: 2, sourceCount: 1 });
  });

  it("keeps only the rolling local archive window and sorts newest first", () => {
    const result = pruneBriefArchive([
      createBrief("2026-04-01"),
      createBrief("2026-07-27"),
      createBrief("2026-07-28"),
    ], "2026-04-27");
    expect(result.map((item) => item.date)).toEqual(["2026-07-28", "2026-07-27"]);
  });
});
