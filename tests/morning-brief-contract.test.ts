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
