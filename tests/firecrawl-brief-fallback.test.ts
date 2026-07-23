import { describe, expect, it, vi } from "vitest";
import {
  buildFirecrawlBriefQuery,
  searchFirecrawlBriefSources,
} from "../lib/ai/firecrawl-brief-fallback";

describe("Firecrawl morning brief fallback", () => {
  it("builds a stable query with the date, title, and every required term", () => {
    const query = buildFirecrawlBriefQuery("2026-07-23", "global-markets");

    expect(query).toContain("2026-07-23");
    expect(query).toContain("全球外围市场全景");
    for (const term of ["道琼斯", "纳斯达克", "标普", "费城半导体", "英伟达", "美光"]) {
      expect(query).toContain(term);
    }
    expect(query.length).toBeLessThanOrEqual(500);
  });

  it("posts a bounded hydrated search without exposing the key in results", async () => {
    let request: RequestInit | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      request = init;
      return Response.json({
        success: true,
        data: {
          news: [{
            title: "Official market recap",
            url: "https://www.nasdaq.com/articles/market-recap",
            markdown: "Verified market context. ".repeat(40),
            metadata: { publishedTime: "2026-07-23T00:10:00Z" },
          }],
          web: [],
        },
      });
    };

    const sources = await searchFirecrawlBriefSources({
      date: "2026-07-23",
      key: "global-markets",
      apiKey: "firecrawl-secret",
      fetcher,
      deadlineAt: Date.now() + 40_000,
    });

    expect(new Headers(request?.headers).get("authorization")).toBe("Bearer firecrawl-secret");
    expect(JSON.parse(String(request?.body))).toMatchObject({
      sources: [{ type: "news" }, { type: "web" }],
      limit: 5,
      ignoreInvalidURLs: true,
      timeout: 9_000,
      scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      id: "firecrawl_global-markets_1",
      publishedAt: "2026-07-23T00:10:00.000Z",
    });
    expect(sources[0].retrievedAt).toMatch(/\+08:00$/);
    expect(JSON.stringify(sources)).not.toContain("firecrawl-secret");
  });

  it("accepts a self-hosted Firecrawl base URL", async () => {
    let requestUrl = "";
    const fetcher: typeof fetch = async (input) => {
      requestUrl = String(input);
      return Response.json({ success: true, data: { news: [], web: [] } });
    };

    await searchFirecrawlBriefSources({
      date: "2026-07-23",
      key: "global-markets",
      apiKey: "secret",
      fetcher,
      endpoint: "https://firecrawl.example/",
      deadlineAt: Date.now() + 40_000,
    });

    expect(requestUrl).toBe("https://firecrawl.example/v2/search");
  });

  it("deduplicates, quality-orders, and rejects unsafe or empty pages", async () => {
    const fetcher: typeof fetch = async () => Response.json({
      success: true,
      data: {
        web: [
          { title: "Generic", url: "https://example.com/article", markdown: "A".repeat(500) },
          { title: "Official", url: "https://www.sec.gov/news/statement", markdown: "B".repeat(500) },
          { title: "Duplicate", url: "https://example.com/article#fragment", markdown: "C".repeat(500) },
          { title: "Social", url: "https://x.com/example/status/1", markdown: "D".repeat(500) },
          { title: "Redirect", url: "https://www.google.com/goto?url=abc", markdown: "E".repeat(500) },
          { title: "Forum", url: "https://guba.eastmoney.com/news,1.html", markdown: "F".repeat(500) },
          { title: "Empty", url: "https://example.com/empty", markdown: "" },
          { title: "Bad", url: "javascript:alert(1)", markdown: "G".repeat(500) },
        ],
      },
    });

    const sources = await searchFirecrawlBriefSources({
      date: "2026-07-23",
      key: "global-markets",
      apiKey: "secret",
      fetcher,
      deadlineAt: Date.now() + 40_000,
    });

    expect(sources.map((source) => source.url)).toEqual([
      "https://www.sec.gov/news/statement",
      "https://example.com/article",
    ]);
  });

  it("caps each page at 6000 characters and the bundle at 24000 characters", async () => {
    const fetcher: typeof fetch = async () => Response.json({
      success: true,
      data: {
        news: Array.from({ length: 5 }, (_, index) => ({
          title: `Source ${index}`,
          url: `https://example${index}.com/article`,
          markdown: "正文".repeat(10_000),
        })),
      },
    });

    const sources = await searchFirecrawlBriefSources({
      date: "2026-07-23",
      key: "global-markets",
      apiKey: "secret",
      fetcher,
      deadlineAt: Date.now() + 40_000,
    });

    expect(sources.every((source) => source.content.length <= 6_000)).toBe(true);
    expect(sources.reduce((sum, source) => sum + source.content.length, 0)).toBeLessThanOrEqual(24_000);
  });

  it("bounds a request that never returns headers and clears its timer", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
      const pending = searchFirecrawlBriefSources({
        date: "2026-07-23",
        key: "risk",
        apiKey: "secret",
        fetcher,
      });
      const rejected = expect(pending).rejects.toThrow(/Firecrawl request timed out after 10000ms/);

      await vi.advanceTimersByTimeAsync(10_000);

      await rejected;
      expect(aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds response body parsing and never leaks the key in the error", async () => {
    vi.useFakeTimers();
    try {
      const fetcher: typeof fetch = async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"success":true,"data":'));
        },
      }), { headers: { "content-type": "application/json" } });
      const pending = searchFirecrawlBriefSources({
        date: "2026-07-23",
        key: "risk",
        apiKey: "secret-key-must-not-leak",
        fetcher,
      });
      const rejected = expect(pending).rejects.toThrow(/Firecrawl request timed out after 10000ms/);

      await vi.advanceTimersByTimeAsync(10_000);

      await rejected;
      await pending.catch((error) => expect(String(error)).not.toContain("secret-key-must-not-leak"));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
