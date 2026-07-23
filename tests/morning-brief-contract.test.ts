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
import { validateMorningBrief as validateFacadeMorningBrief } from "../lib/ai/morning-brief";

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

  it("exposes the V2 validator from the compatibility facade", () => {
    expect(validateFacadeMorningBrief(brief).ok).toBe(true);
  });

  it("rejects malformed, duplicate, and unreferencable source records", () => {
    const invalid = structuredClone(brief);
    invalid.sources[0] = { id: "s0", title: "", url: "ftp://example.com", publishedAt: "not-a-date" };
    invalid.sources[1].id = "s0";
    const result = validateMorningBrief(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/缺少标题|URL|发布时间|ID重复/);
  });

  it("requires snapshot tables to identify a Beijing market snapshot", () => {
    const invalid = structuredClone(brief);
    invalid.sections[0].blocks = [{
      type: "table",
      columns: ["指标"],
      rows: [["100"]],
      sourceIds: [],
      provenance: { kind: "snapshot", label: " ", marketTime: "2026-07-23T07:15:00Z" },
    }] as BriefSection["blocks"];
    const result = validateBriefSection(invalid.sections[0], new Set(invalid.sources.map((item) => item.id)));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/快照来源|北京时间/);
  });

  it("requires Beijing run timestamps and a V2 schema with legal statuses", () => {
    const invalid = structuredClone(brief) as any;
    invalid.schemaVersion = 1;
    invalid.status = "ready";
    invalid.date = "2026/07/23";
    invalid.generatedAt = "2026-07-23T07:15:00Z";
    invalid.sections[0].generatedAt = "2026-07-23T07:15:00Z";
    invalid.sections[1].status = "ready" as never;
    const result = validateMorningBrief(invalid as MorningBrief);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/schemaVersion|状态|日期|北京时间/);
  });

  it("allows explicit missing callouts for partial and failed sections only", () => {
    const partial = structuredClone(brief);
    partial.status = "partial";
    partial.sections[0].status = "failed";
    partial.sections[0].blocks = [{ type: "callout", tone: "missing", text: "数据暂缺，生成失败", sourceIds: [] }];
    expect(validateMorningBrief(partial).ok).toBe(true);

    partial.sections[0].blocks = [{ type: "callout", tone: "missing", text: "数据说明", sourceIds: [] }];
    expect(validateMorningBrief(partial).ok).toBe(false);
  });

  it("rejects direct recommendation language that bypasses 买入建议 wording", () => {
    const invalid = structuredClone(brief);
    invalid.sections[0].blocks = [{
      type: "paragraph",
      text: "可买入、推荐关注、逢低吸纳，并设置目标价和止损。",
      sourceIds: ["s0"],
    }];
    const result = validateBriefSection(invalid.sections[0], new Set(invalid.sources.map((item) => item.id)));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("投资建议");
  });
});
