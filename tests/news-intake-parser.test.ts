import { describe, expect, it } from "vitest";
import { parseFeedXml } from "../lib/ai/news-intake/parser";

describe("news feed parser", () => {
  it("parses RSS 2.0 items and decodes entities and CDATA", () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><item>
        <title><![CDATA[存储价格 &amp; 产能更新]]></title>
        <link>https://example.com/a?utm_source=rss</link>
        <description><![CDATA[<p>供应链出现新变化。</p>]]></description>
        <pubDate>Fri, 24 Jul 2026 01:30:00 GMT</pubDate>
      </item></channel></rss>`;

    expect(parseFeedXml(xml)).toEqual([{
      title: "存储价格 & 产能更新",
      url: "https://example.com/a?utm_source=rss",
      excerpt: "供应链出现新变化。",
      publishedAt: "2026-07-24T01:30:00.000Z",
    }]);
  });

  it("parses Atom entries and prefers the alternate link", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <title>Robot launch</title>
      <link rel="self" href="https://example.com/feed-entry"/>
      <link rel="alternate" href="https://example.com/robot"/>
      <summary>New robot platform.</summary>
      <updated>2026-07-24T02:30:00Z</updated>
    </entry></feed>`;

    expect(parseFeedXml(xml)[0]).toEqual({
      title: "Robot launch",
      url: "https://example.com/robot",
      excerpt: "New robot platform.",
      publishedAt: "2026-07-24T02:30:00.000Z",
    });
  });

  it("rejects XML documents that declare entities", () => {
    expect(() => parseFeedXml(`<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss/>`))
      .toThrow(/DTD|entity/i);
  });
});
