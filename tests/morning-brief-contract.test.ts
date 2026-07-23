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
    retrievedAt: "2026-07-23T07:15:00+08:00",
  })),
  disclaimer: "仅供市场复盘，不构成投资建议。",
};

describe("V2 morning brief contract", () => {
  it("accepts a five-module sourced brief and counts rendered text", () => {
    expect(briefTextLength(brief.sections[0])).toBeGreaterThanOrEqual(1000);
    expect(validateMorningBrief(brief).ok).toBe(true);
  });

  it("excludes server snapshot blocks from section and full narrative limits while retaining them for coverage", () => {
    const withSnapshots = structuredClone(brief);
    const before = briefTextLength(withSnapshots.sections[0]);
    withSnapshots.sections[0].blocks.push({
      type: "table",
      columns: ["ETF", "映射"],
      rows: Array.from({ length: 120 }, (_, index) => [`ETF${index}`, "服务端映射".repeat(20)]),
      sourceIds: [],
      provenance: { kind: "snapshot", label: "服务端ETF映射", marketTime: "2026-07-22T00:00:00+08:00", providers: ["服务端ETF快照"], receivedAt: "2026-07-22T07:00:00Z" },
    });
    withSnapshots.sections[0].blocks.push({
      type: "callout",
      tone: "missing",
      text: "服务端市场快照时间暂缺。".repeat(120),
      sourceIds: [],
      provenance: { kind: "unavailable", label: "服务端市场快照" },
    });
    expect(briefTextLength(withSnapshots.sections[0])).toBe(before);
    expect(validateMorningBrief(withSnapshots).ok).toBe(true);
  });

  it("rejects missing coverage, missing sources and recommendation language", () => {
    const invalid = structuredClone(brief);
    invalid.sections[1].blocks = [{ type: "paragraph", text: "建议买入并加仓", sourceIds: [] }];
    const result = validateBriefSection(invalid.sections[1], new Set(invalid.sources.map((item) => item.id)));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/来源|投资建议|字数|覆盖/);
  });

  it("reports the actual narrative length when a complete module is too short", () => {
    const invalid = structuredClone(brief.sections[1]);
    invalid.blocks = [{ type: "paragraph", text: BRIEF_SECTION_DEFINITIONS[1].requiredTerms.join("、"), sourceIds: ["s1"] }];
    const result = validateBriefSection(invalid, new Set(["s1"]));
    expect(result.errors.join(" ")).toContain(`实际 ${briefTextLength(invalid)} 字符`);
  });

  it("requires complete sections and complete missing callouts to cite a valid source", () => {
    const invalid = structuredClone(brief);
    invalid.sections[0].blocks = [{
      type: "callout",
      tone: "missing",
      text: `${BRIEF_SECTION_DEFINITIONS[0].requiredTerms.join("、")}。${"未查到可靠更新。".repeat(120)}`,
      sourceIds: [],
    }];
    invalid.sections[0].sourceIds = [];
    const result = validateBriefSection(invalid.sections[0], new Set(invalid.sources.map((item) => item.id)));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/来源|有效来源/);

    invalid.sections[0].status = "failed";
    expect(validateBriefSection(invalid.sections[0], new Set(invalid.sources.map((item) => item.id))).ok).toBe(true);
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
    invalid.sources[0] = { id: "s0", title: "", url: "ftp://example.com", publishedAt: "not-a-date", retrievedAt: "2026-07-23T07:15:00Z" };
    invalid.sources[1].id = "s0";
    const result = validateMorningBrief(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/缺少标题|URL|发布时间|获取时间|ID重复/);
  });

  it("accepts explicit missing publication times but requires Beijing retrieval times", () => {
    const valid = structuredClone(brief);
    valid.sources[0].publishedAt = null;
    expect(validateMorningBrief(valid).ok).toBe(true);

    valid.sources[0].retrievedAt = "2026-07-23T07:15:00Z";
    expect(validateMorningBrief(valid).errors.join(" ")).toContain("获取时间");
  });

  it("requires snapshot tables to identify a Beijing market snapshot", () => {
    const invalid = structuredClone(brief);
    invalid.sections[0].blocks = [{
      type: "table",
      columns: ["指标"],
      rows: [["100"]],
      sourceIds: [],
      provenance: { kind: "snapshot", label: " ", marketTime: "2026-07-23T07:15:00Z", providers: [], receivedAt: "not-a-time" },
    }] as BriefSection["blocks"];
    const result = validateBriefSection(invalid.sections[0], new Set(invalid.sources.map((item) => item.id)));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/快照来源|北京时间|提供方|接收时间/);
  });

  it("requires snapshot provenance to retain providers and the received timestamp", () => {
    const valid = structuredClone(brief);
    valid.sections[0].blocks.push({
      type: "table",
      columns: ["指标"],
      rows: [["100"]],
      sourceIds: [],
      provenance: {
        kind: "snapshot",
        label: "标普500",
        marketTime: "2026-07-23T07:15:00+08:00",
        providers: ["Twelve Data", "Alpha Vantage"],
        receivedAt: "2026-07-23T00:00:00Z",
      },
    });
    expect(validateBriefSection(valid.sections[0], new Set(valid.sources.map((item) => item.id))).ok).toBe(true);

    const invalid = structuredClone(valid);
    const snapshot = invalid.sections[0].blocks.at(-1);
    if (snapshot?.type === "table" && snapshot.provenance.kind === "snapshot") {
      snapshot.provenance.providers = [];
      snapshot.provenance.receivedAt = "2026-02-30T00:00:00Z";
    }
    expect(validateBriefSection(invalid.sections[0], new Set(invalid.sources.map((item) => item.id))).errors.join(" "))
      .toMatch(/提供方|接收时间/);
  });

  it("requires Beijing run timestamps and a V2 schema with legal statuses", () => {
    const invalid = structuredClone(brief);
    invalid.schemaVersion = 1 as 2;
    invalid.status = "ready" as never;
    invalid.date = "2026/07/23";
    invalid.generatedAt = "2026-07-23T07:15:00Z";
    invalid.sections[0].generatedAt = "2026-07-23T07:15:00Z";
    invalid.sections[1].status = "ready" as never;
    const result = validateMorningBrief(invalid);
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

  it("rejects direct individual-stock attention prompts but permits factual rating coverage", () => {
    const direct = structuredClone(brief);
    direct.sections[0].blocks = [{
      type: "paragraph",
      text: "重点关注英伟达，并推荐英伟达。",
      sourceIds: ["s0"],
    }];
    expect(validateBriefSection(direct.sections[0], new Set(direct.sources.map((item) => item.id))).errors.join(" "))
      .toContain("投资建议");

    const factual = structuredClone(brief);
    const firstBlock = factual.sections[0].blocks[0];
    if (firstBlock.type === "paragraph") firstBlock.text += "券商推荐评级下调。";
    expect(validateBriefSection(factual.sections[0], new Set(factual.sources.map((item) => item.id))).errors.join(" "))
      .not.toContain("投资建议");
  });

  it("rejects calendar-impossible brief dates", () => {
    const invalid = structuredClone(brief);
    invalid.date = "2026-02-31";
    expect(validateMorningBrief(invalid).errors.join(" ")).toContain("日期");
  });

  it("rejects qualified reader-directed investment instructions", () => {
    const instructions = [
      "建议考虑买入英伟达",
      "建议投资者逢低逐步布局英伟达",
      "可以适当加仓",
      "不妨关注并配置",
      "建议投资者降低持仓至三成",
      "建议投资者空仓观望",
    ];

    instructions.forEach((text) => {
      const invalid = structuredClone(brief);
      invalid.sections[0].blocks = [{ type: "paragraph", text, sourceIds: ["s0"] }];
      expect(validateBriefSection(invalid.sections[0], new Set(invalid.sources.map((item) => item.id))).errors.join(" "))
        .toContain("投资建议");
    });
  });

  it("rejects reader directives and investment actions separated by long factual context", () => {
    const longGap = structuredClone(brief);
    longGap.sections[0].blocks = [{
      type: "paragraph",
      text: `建议投资者先阅读市场背景。${"全球宏观与公司基本面事实。".repeat(20)}随后买入英伟达。`,
      sourceIds: ["s0"],
    }];
    expect(validateBriefSection(longGap.sections[0], new Set(longGap.sources.map((item) => item.id))).errors.join(" "))
      .toContain("投资建议");

    const factual = structuredClone(brief);
    const firstBlock = factual.sections[0].blocks[0];
    if (firstBlock.type === "paragraph") firstBlock.text += "北向资金买入额上升。";
    expect(validateBriefSection(factual.sections[0], new Set(factual.sources.map((item) => item.id))).errors.join(" "))
      .not.toContain("投资建议");
  });

  it("checks investment advice within each bullet item instead of joining separate facts", () => {
    const factual = structuredClone(brief);
    factual.sections[0].blocks = [{
      type: "bullets",
      items: [
        { text: "建议评估政策变化及其传导路径。", sourceIds: ["s0"] },
        { text: "北向资金买入额上升属于客观资金流向记录。", sourceIds: ["s0"] },
      ],
    }];
    expect(validateBriefSection(factual.sections[0], new Set(factual.sources.map((item) => item.id))).errors.join(" "))
      .not.toContain("投资建议");

    factual.sections[0].blocks = [{ type: "bullets", items: [{ text: "建议买入相关标的。", sourceIds: ["s0"] }] }];
    expect(validateBriefSection(factual.sections[0], new Set(factual.sources.map((item) => item.id))).errors.join(" "))
      .toContain("投资建议");
  });

  it("checks summary and each tag for investment advice without joining semantic units", () => {
    const invalidSummary = structuredClone(brief.sections[0]);
    invalidSummary.summary = "建议买入相关标的。";
    expect(validateBriefSection(invalidSummary, new Set(["s0"])).errors.join(" "))
      .toContain("投资建议");

    const invalidTag = structuredClone(brief.sections[0]);
    invalidTag.tags = ["建议买入相关标的"];
    expect(validateBriefSection(invalidTag, new Set(["s0"])).errors.join(" "))
      .toContain("投资建议");

    const factual = structuredClone(brief.sections[0]);
    factual.summary = "建议评估政策变化及其传导路径。";
    factual.tags = ["北向资金买入额上升"];
    expect(validateBriefSection(factual, new Set(["s0"])).errors.join(" "))
      .not.toContain("投资建议");
  });

  it("rejects no-gap return promises while permitting neutral return facts", () => {
    ["本策略保证收益", "保本并实现年化回报"].forEach((text) => {
      const invalid = structuredClone(brief);
      invalid.sections[0].blocks = [{ type: "paragraph", text, sourceIds: ["s0"] }];
      expect(validateBriefSection(invalid.sections[0], new Set(invalid.sources.map((item) => item.id))).errors.join(" "))
        .toContain("投资建议");
    });

    const factual = structuredClone(brief);
    const firstBlock = factual.sections[0].blocks[0];
    if (firstBlock.type === "paragraph") firstBlock.text += "该公司年化盈利增速回落。";
    expect(validateBriefSection(factual.sections[0], new Set(factual.sources.map((item) => item.id))).errors.join(" "))
      .not.toContain("投资建议");
  });

  it("rejects calendar-impossible ISO timestamps for runs, sources, and snapshots", () => {
    const invalid = structuredClone(brief);
    invalid.sections[0].generatedAt = "2026-02-30T07:15:00+08:00";
    invalid.sources[0].publishedAt = "2026-02-30T07:15:00-05:00";
    invalid.sections[1].blocks.push({
      type: "table",
      columns: ["指标"],
      rows: [["100"]],
      sourceIds: [],
      provenance: { kind: "snapshot", label: "全球行情快照", marketTime: "2026-02-30T25:61:61+08:00", providers: ["来源"], receivedAt: "2026-07-23T00:00:00Z" },
    });
    const result = validateMorningBrief(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/生成时间.*发布时间|发布时间.*生成时间/);
    expect(result.errors.join(" ")).toContain("市场时间");
  });
});
