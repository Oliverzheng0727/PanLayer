import { describe, expect, it } from "vitest";
import { collectTier1News } from "../lib/ai/news-intake/collector";
import type { Tier1NewsConfig } from "../lib/ai/news-intake/types";

const config: Tier1NewsConfig = {
  fetch: { perSource: 6, timeoutMs: 100, recentDays: 7 },
  industries: [{ key: "ai", name: "AI", accent: "#fff" }],
  redlineKeywords: [],
  sources: [
    { id: "ok", name: "OK", url: "https://ok.example/feed", type: "rss", industries: ["ai"] },
    { id: "bad", name: "Bad", url: "https://bad.example/feed", type: "rss", industries: ["ai"] },
  ],
};

describe("tier-1 RSS collector", () => {
  it("keeps successful feeds when another source fails", async () => {
    let badAttempts = 0;
    const fetcher: typeof fetch = async (input) => {
      if (String(input).includes("bad.example")) {
        badAttempts += 1;
        return new Response("down", { status: 503 });
      }
      return new Response(`<rss><channel><item><title>AI update</title><link>https://news.example/a</link><pubDate>Fri, 24 Jul 2026 00:00:00 GMT</pubDate></item></channel></rss>`, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });
    };

    const result = await collectTier1News({
      date: "2026-07-24",
      config,
      fetcher,
      now: new Date("2026-07-23T22:50:00Z"),
      concurrency: 2,
    });

    expect(result.status).toBe("partial");
    expect(result.sourceSuccess).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].runId).toBe(result.runId);
    expect(badAttempts).toBe(2);
  });

  it("rejects private source hosts without requesting them", async () => {
    let called = false;
    const result = await collectTier1News({
      date: "2026-07-24",
      config: {
        ...config,
        sources: [{ id: "private", name: "Private", url: "http://127.0.0.1/feed", type: "rss", industries: ["ai"] }],
      },
      fetcher: async () => { called = true; return new Response(""); },
      now: new Date("2026-07-23T22:50:00Z"),
    });

    expect(called).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.sourceHealth[0].error).toMatch(/private|local/i);
  });
});
