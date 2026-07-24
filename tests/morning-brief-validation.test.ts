import { describe, expect, it } from "vitest";
import type { MorningBrief } from "../lib/ai/morning-brief-contract";
import { validateBriefPublication } from "../lib/ai/morning-brief-validation";

function briefWithTexts(...texts: string[]): MorningBrief {
  return {
    schemaVersion: 2,
    date: "2026-07-24",
    status: "complete",
    generatedAt: "2026-07-24T07:20:00+08:00",
    sections: texts.map((text, index) => ({
      key: ["global-markets", "global-industry", "domestic", "mapping", "risk"][index] as MorningBrief["sections"][number]["key"],
      title: `模块${index}`,
      summary: text,
      tags: [],
      status: "complete",
      generatedAt: "2026-07-24T07:20:00+08:00",
      blocks: [{ type: "paragraph", text, sourceIds: ["source-1"] }],
      sourceIds: ["source-1"],
    })),
    sources: [{
      id: "source-1",
      title: "可靠来源",
      url: "https://example.com/news",
      publishedAt: "2026-07-24T05:00:00+08:00",
      retrievedAt: "2026-07-24T07:10:00+08:00",
    }],
    disclaimer: "不构成投资建议",
  };
}

describe("morning brief publication validation", () => {
  it("detects conflicting directions for the same market subject", () => {
    const result = validateBriefPublication(
      briefWithTexts("费城半导体指数领涨并创出新高。", "费城半导体指数暴跌，科技股重挫。"),
      new Date("2026-07-24T00:20:00Z"),
    );

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "direction-conflict")).toBe(true);
  });

  it("marks a completed brief late after 07:30 Beijing", () => {
    const result = validateBriefPublication(
      briefWithTexts("外围市场信息已核验。"),
      new Date("2026-07-24T00:40:00Z"),
    );

    expect(result.timeliness).toBe("late");
  });

  it("rejects stale sources older than 36 hours", () => {
    const brief = briefWithTexts("外围市场信息已核验。");
    brief.sources[0].publishedAt = "2026-07-21T18:00:00+08:00";

    const result = validateBriefPublication(brief, new Date("2026-07-24T00:20:00Z"));

    expect(result.issues.some((issue) => issue.code === "stale-source")).toBe(true);
  });
});
