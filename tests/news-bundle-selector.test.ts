import { describe, expect, it } from "vitest";
import { selectBriefSourceBundle } from "../lib/ai/news-intake/bundle-selector";
import type { NewsBundle, NormalizedNewsItem } from "../lib/ai/news-intake/types";

function item(index: number, tier: 1 | 2, verification: NormalizedNewsItem["verification"] = "verified"): NormalizedNewsItem {
  return {
    id: `item-${tier}-${index}`,
    canonicalUrl: `https://source${index}.example/article-${tier}-${index}`,
    title: `${tier === 1 ? "AI 大模型" : "存储 芯片"} 更新 ${index}`,
    excerpt: "可靠内容".repeat(400),
    publishedAt: `2026-07-23T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
    receivedAt: "2026-07-24T06:55:00+08:00",
    fetchDate: "2026-07-24",
    sourceIds: [`source-${tier}-${index}`],
    sourceNames: [`Source ${tier}-${index}`],
    industries: tier === 1 ? ["ai"] : ["semi"],
    tier,
    verification,
    corroboratingUrls: [],
    filterReason: null,
  };
}

describe("brief source bundle selector", () => {
  it("selects only verified sources with tier limits and bounded content", () => {
    const bundle: NewsBundle = {
      fetchDate: "2026-07-24",
      collectedAt: "2026-07-24T06:55:00+08:00",
      status: "complete",
      items: [
        ...Array.from({ length: 15 }, (_, index) => item(index, 1)),
        ...Array.from({ length: 9 }, (_, index) => item(index + 20, 2)),
        item(99, 2, "unverified"),
        item(100, 1, "filtered"),
      ],
    };

    const selected = selectBriefSourceBundle(bundle, "global-industry");
    expect(selected.filter((source) => source.tier === 1)).toHaveLength(12);
    expect(selected.filter((source) => source.tier === 2)).toHaveLength(6);
    expect(selected.every((source) => source.verification === "verified")).toBe(true);
    expect(selected.every((source) => source.content.length <= 900)).toBe(true);
    expect(new Set(selected.map((source) => source.id)).size).toBe(selected.length);
  });

  it("does not leak an old-date bundle into the current brief", () => {
    const bundle: NewsBundle = {
      fetchDate: "2026-07-23",
      collectedAt: "2026-07-23T06:55:00+08:00",
      status: "complete",
      items: [item(1, 1)],
    };
    expect(selectBriefSourceBundle(bundle, "global-industry", "2026-07-24")).toEqual([]);
  });
});
