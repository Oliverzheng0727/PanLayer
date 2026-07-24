import { describe, expect, it } from "vitest";
import { collectTier2News, detectTier2Gaps, verifyTier2Candidates } from "../lib/ai/news-intake/tier2";
import type { NewsBundle } from "../lib/ai/news-intake/types";
import type { FirecrawlBriefSource } from "../lib/ai/firecrawl-brief-fallback";

const emptyBundle: NewsBundle = {
  fetchDate: "2026-07-24",
  collectedAt: "2026-07-24T06:50:00+08:00",
  status: "complete",
  items: [],
};

const source = (title: string, url: string): FirecrawlBriefSource => ({
  id: `source-${url}`,
  title,
  url,
  publishedAt: "2026-07-23T23:00:00.000Z",
  retrievedAt: "2026-07-24T06:55:00+08:00",
  content: "可靠事实内容。".repeat(30),
});

describe("tier-2 news enrichment", () => {
  it("detects required-term gaps from the tier-1 bundle", () => {
    const gaps = detectTier2Gaps(emptyBundle);
    expect(gaps).toContainEqual(expect.objectContaining({
      sectionKey: "global-markets",
      requiredTerms: expect.arrayContaining(["美债"]),
    }));
    expect(gaps).toHaveLength(5);
  });

  it("keeps a single unofficial source unverified", () => {
    const [item] = verifyTier2Candidates({
      date: "2026-07-24",
      sectionKey: "global-industry",
      candidates: [source("存储芯片价格上调", "https://small-media.example/a")],
    });
    expect(item.verification).toBe("unverified");
  });

  it("verifies an official source directly and unofficial facts through two domains", () => {
    const official = verifyTier2Candidates({
      date: "2026-07-24",
      sectionKey: "domestic",
      candidates: [source("央行发布最新公告", "https://www.pbc.gov.cn/a")],
    });
    const corroborated = verifyTier2Candidates({
      date: "2026-07-24",
      sectionKey: "global-industry",
      candidates: [
        source("存储芯片价格上调", "https://media-one.example/a"),
        source("存储芯片：价格上调！", "https://media-two.example/b"),
      ],
    });
    expect(official[0].verification).toBe("verified");
    expect(corroborated[0]).toMatchObject({
      verification: "verified",
      corroboratingUrls: ["https://media-one.example/a", "https://media-two.example/b"],
    });
  });

  it("collects one bounded Firecrawl query per gap and returns partial when a query fails", async () => {
    const queries: string[] = [];
    const result = await collectTier2News({
      date: "2026-07-24",
      bundle: emptyBundle,
      apiKey: "secret",
      searcher: async (input) => {
        queries.push(input.query ?? "");
        if (input.key === "risk") throw new Error("search unavailable");
        return [source(`${input.key} 官方更新`, `https://www.gov.cn/${input.key}`)];
      },
      now: new Date("2026-07-23T22:55:00Z"),
    });
    expect(queries).toHaveLength(5);
    expect(result.status).toBe("partial");
    expect(result.items.every((item) => item.runId === result.runId)).toBe(true);
    expect(result.sourceSuccess).toBe(4);
  });
});
