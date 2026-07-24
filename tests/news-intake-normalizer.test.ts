import { describe, expect, it } from "vitest";
import { canonicalizeNewsUrl, normalizeFeedItems } from "../lib/ai/news-intake/normalizer";

describe("news feed normalizer", () => {
  it("canonicalizes URLs and strips tracking parameters", () => {
    expect(canonicalizeNewsUrl("https://EXAMPLE.com/a/?utm_source=x&b=2#top"))
      .toBe("https://example.com/a?b=2");
    expect(canonicalizeNewsUrl("javascript:alert(1)")).toBeNull();
  });

  it("merges the same article across industries and removes near-duplicate titles", () => {
    const items = normalizeFeedItems({
      fetchDate: "2026-07-24",
      receivedAt: "2026-07-24T06:50:00+08:00",
      recentDays: 7,
      redlineKeywords: [],
      feeds: [
        {
          sourceId: "one",
          sourceName: "One",
          industries: ["ai"],
          items: [{
            title: "DeepSeek 发布全新推理模型",
            url: "https://example.com/deepseek?utm_source=rss",
            excerpt: "模型能力更新",
            publishedAt: "2026-07-23T23:00:00.000Z",
          }],
        },
        {
          sourceId: "two",
          sourceName: "Two",
          industries: ["tech"],
          items: [{
            title: "DeepSeek：发布全新推理模型！",
            url: "https://example.com/deepseek",
            excerpt: "另一来源报道",
            publishedAt: "2026-07-23T23:10:00.000Z",
          }],
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      canonicalUrl: "https://example.com/deepseek",
      sourceIds: ["one", "two"],
      industries: ["ai", "tech"],
      tier: 1,
      verification: "verified",
    });
  });

  it("filters redline content and old publications without fabricating dates", () => {
    const result = normalizeFeedItems({
      fetchDate: "2026-07-24",
      receivedAt: "2026-07-24T06:50:00+08:00",
      recentDays: 7,
      redlineKeywords: ["crypto"],
      feeds: [{
        sourceId: "one",
        sourceName: "One",
        industries: ["macro"],
        items: [
          { title: "Crypto market", url: "https://example.com/blocked", excerpt: null, publishedAt: null },
          { title: "Old macro", url: "https://example.com/old", excerpt: null, publishedAt: "2026-07-01T00:00:00.000Z" },
          { title: "No date macro", url: "https://example.com/no-date", excerpt: null, publishedAt: null },
        ],
      }],
    });

    expect(result.map((item) => item.title)).toEqual(["Crypto market", "No date macro"]);
    expect(result[0]).toMatchObject({ verification: "filtered", filterReason: "redline:crypto" });
    expect(result[1].publishedAt).toBeNull();
  });
});
