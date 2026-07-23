import { describe, expect, it } from "vitest";
import {
  BRIEF_SECTION_DEFINITIONS,
  type BriefSection,
  type BriefSectionKey,
} from "../lib/ai/morning-brief-contract";
import { assembleMorningBrief } from "../lib/ai/morning-brief-assembly";

const generatedAt = "2026-07-23T07:15:00+08:00";

function complete(key: BriefSectionKey, url = `https://example.com/${key}#citation`) {
  const definition = BRIEF_SECTION_DEFINITIONS.find((item) => item.key === key)!;
  const section: BriefSection = {
    key,
    title: definition.title,
    summary: "已核验的隔夜市场信息摘要。",
    tags: ["市场"],
    status: "complete",
    generatedAt,
    blocks: [{
      type: "paragraph",
      text: `${definition.requiredTerms.join("、")}。${"客观市场事实与影响解读。".repeat(100)}`,
      sourceIds: ["local-source"],
    }],
    sourceIds: ["local-source"],
  };
  return {
    section,
    sources: [{
      id: "local-source",
      title: "可靠来源",
      url,
      publishedAt: null,
      retrievedAt: generatedAt,
    }],
  };
}

describe("morning brief assembly", () => {
  it("orders modules deterministically, de-duplicates canonical URLs, and remaps every citation", () => {
    const brief = assembleMorningBrief("2026-07-23", [
      complete("risk", "https://example.com/shared#risk"),
      complete("global-markets", "https://example.com/shared#markets"),
      complete("mapping"),
      complete("domestic"),
      complete("global-industry"),
    ], generatedAt);

    expect(brief.status).toBe("complete");
    expect(brief.sections.map((section) => section.key)).toEqual(BRIEF_SECTION_DEFINITIONS.map((item) => item.key));
    expect(brief.sources).toHaveLength(4);
    expect(brief.sources[0].url).toBe("https://example.com/shared");
    expect(brief.sections[0].sourceIds).toEqual(["source-1"]);
    expect(brief.sections[4].sourceIds).toEqual(["source-1"]);
    expect(brief.sections[0].blocks[0]).toMatchObject({ sourceIds: ["source-1"] });
    expect(brief.sections[4].blocks[0]).toMatchObject({ sourceIds: ["source-1"] });
  });

  it("renders a rejected module as an explicit missing callout and makes the brief partial", () => {
    const brief = assembleMorningBrief("2026-07-23", [
      complete("global-markets"),
      { key: "global-industry", error: "provider timeout" },
      complete("domestic"),
      complete("mapping"),
      complete("risk"),
    ], generatedAt);

    expect(brief.status).toBe("partial");
    expect(brief.sections.map((section) => section.key)).toEqual(BRIEF_SECTION_DEFINITIONS.map((item) => item.key));
    expect(brief.sections[1]).toMatchObject({ key: "global-industry", status: "failed" });
    expect(brief.sections[1].blocks).toMatchObject([{ type: "callout", tone: "missing", sourceIds: [] }]);
  });

  it("marks the complete brief failed when every module is rejected", () => {
    const brief = assembleMorningBrief("2026-07-23", BRIEF_SECTION_DEFINITIONS.map(({ key }) => ({ key, error: "provider timeout" })), generatedAt);

    expect(brief.status).toBe("failed");
    expect(brief.sections.every((section) => section.status === "failed")).toBe(true);
  });
});
