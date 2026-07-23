import { describe, expect, it } from "vitest";
import type { BriefSectionKey } from "../lib/ai/morning-brief-contract";
import { generateOpenAIBriefSection, generateQwenBriefSection } from "../lib/ai/morning-brief-providers";

function modelSection(key: BriefSectionKey) {
  const definitions: Record<BriefSectionKey, { title: string; terms: string[] }> = {
    "global-markets": { title: "全球外围市场全景", terms: ["道琼斯", "标普", "纳斯达克", "费城半导体", "英伟达", "美光", "中概", "A50", "人民币", "美债", "原油", "黄金", "工业金属"] },
    "global-industry": { title: "全球产业重大催化", terms: ["Kimi", "DeepSeek", "GPT", "存储", "人形机器人", "算力", "光模块", "钠离子电池", "新能源车", "医药"] },
    domestic: { title: "国内隔夜重磅信息", terms: ["宏观", "政策", "产业", "公告", "央行", "流动性"] },
    mapping: { title: "板块利好、利空与内需映射", terms: ["指数", "成交额", "涨跌停", "连板", "资金", "ETF", "利好", "利空", "内需"] },
    risk: { title: "盘前情绪、观察方向与风险", terms: ["情绪", "观察", "持续性", "风险", "关键"] },
  };
  const definition = definitions[key];
  return {
    key,
    title: definition.title,
    summary: "最多三行摘要",
    tags: ["测试"],
    blocks: [
      { type: "heading", text: "事实梳理" },
      { type: "paragraph", text: `${definition.terms.join("、")}。${"客观事实与盘面映射。".repeat(130)}`, sourceIds: ["ref_1"] },
    ],
  };
}

function openAIModelSection(key: BriefSectionKey, urls: [string, string]) {
  const section = modelSection(key);
  return {
    ...section,
    blocks: [
      { type: "heading", text: "事实梳理" },
      { type: "paragraph", text: `${section.blocks[1].text.slice(0, -1)}${"事实。".repeat(15)}`, sourceUrls: [urls[1]] },
      { type: "paragraph", text: "第二条来源事实。".repeat(16), sourceUrls: [urls[0]] },
    ],
  };
}

describe("independent morning-brief section providers", () => {
  it("asks Qwen for exactly one sourced section and namespaces its search references", async () => {
    let request: { parameters?: { enable_search?: boolean }; input?: { messages?: Array<{ content?: string }> } } = {};
    const fetcher: typeof fetch = async (_input, init) => {
      request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        output: {
          choices: [{ message: { content: JSON.stringify(modelSection("global-industry")) } }],
          search_info: { search_results: [{ index: 1, title: "可信来源", url: "https://example.com/source", published_time: "2026-07-23T07:15:00+08:00" }] },
        },
      }));
    };

    const result = await generateQwenBriefSection({
      date: "2026-07-23",
      key: "global-industry",
      apiKey: "secret",
      globalSnapshot: [],
      fetcher,
    });

    expect(request.parameters?.enable_search).toBe(true);
    expect(request.input?.messages?.[1]?.content).toContain("global-industry");
    expect(request.input?.messages?.[1]?.content).not.toContain("secret");
    expect(result.sources[0]?.id).toBe("global-industry_ref_1");
    expect(JSON.stringify(result.section)).toContain("global-industry_ref_1");
    expect(result.section.status).toBe("complete");
    expect(result.section.generatedAt).toMatch(/\+08:00$/);
  });

  it("maps OpenAI source URLs by citation instead of action-source position", async () => {
    let request: { model?: string; reasoning?: unknown; tools?: unknown[]; tool_choice?: unknown; text?: { verbosity?: string; format?: Record<string, unknown> }; input?: string } = {};
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input) === "https://example.com/alpha") {
        return new Response('<meta property="article:published_time" content="2026-07-23T07:15:00+08:00">');
      }
      if (String(input) === "https://example.com/beta") return new Response('<meta itemprop="datePublished" content="2026-07-23T06:15:00+08:00">');
      request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        output: [
          { type: "web_search_call", action: { sources: [{ type: "url", url: "https://example.com/alpha" }, { type: "url", url: "https://example.com/beta" }] } },
          {
            type: "message",
            content: [{
              type: "output_text",
              text: JSON.stringify(openAIModelSection("risk", ["https://example.com/alpha", "https://example.com/beta"])),
              annotations: [
                { type: "url_citation", title: "甲来源", url: "https://example.com/alpha" },
                { type: "url_citation", title: "乙来源", url: "https://example.com/beta" },
              ],
            }],
          },
        ],
      }));
    };

    const result = await generateOpenAIBriefSection({
      date: "2026-07-23",
      key: "risk",
      apiKey: "secret",
      globalSnapshot: [],
      fetcher,
    });

    expect(request.model).toBe("gpt-5.6-terra");
    expect(request.reasoning).toEqual({ effort: "medium" });
    expect(request.tools).toContainEqual({ type: "web_search", search_context_size: "medium" });
    expect(request.tool_choice).toBe("required");
    expect(request.text?.verbosity).toBe("high");
    expect(request.text?.format).toMatchObject({ type: "json_schema", name: "panlayer_morning_brief_section", strict: true });
    expect(request.text?.format?.schema).toMatchObject({ type: "object", additionalProperties: false });
    expect(JSON.stringify(request.text?.format?.schema)).toContain('"const":"risk"');
    expect(JSON.stringify(request.text?.format?.schema)).toContain("sourceUrls");
    expect(request.input).toContain("risk");
    expect(request.input).not.toContain("secret");
    expect(result.sources).toEqual([
      { id: "risk_ref_1", title: "甲来源", url: "https://example.com/alpha", publishedAt: "2026-07-23T07:15:00+08:00" },
      { id: "risk_ref_2", title: "乙来源", url: "https://example.com/beta", publishedAt: "2026-07-23T06:15:00+08:00" },
    ]);
    expect(result.section.blocks[1]).toMatchObject({ sourceIds: ["risk_ref_2"] });
    expect(result.section.blocks[2]).toMatchObject({ sourceIds: ["risk_ref_1"] });
  });

  it("builds snapshot tables from the supplied reconciled data instead of model output", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: {
        choices: [{ message: { content: JSON.stringify(modelSection("global-markets")) } }],
        search_info: { search_results: [{ index: 1, title: "可信来源", url: "https://example.com/source", published_time: "2026-07-23T07:15:00+08:00" }] },
      },
    }));

    const result = await generateQwenBriefSection({
      date: "2026-07-23",
      key: "global-markets",
      apiKey: "secret",
      fetcher,
      globalSnapshot: [{
        key: "sp500",
        label: "标普500",
        value: 630.2,
        previousClose: 625.1,
        pctChange: 0.8159,
        marketTime: "2026-07-22",
        receivedAt: "2026-07-23T00:00:00Z",
        period: "daily",
        providers: ["Twelve Data", "Alpha Vantage"],
        status: "cross-checked",
        message: "双源一致",
      }],
    });

    expect(result.section.blocks).toContainEqual({
      type: "table",
      columns: ["标的", "数值", "前收", "涨跌幅", "状态"],
      rows: [["标普500", "630.2", "625.1", "0.8159", "cross-checked"]],
      sourceIds: [],
      provenance: {
        kind: "snapshot",
        label: "标普500",
        marketTime: "2026-07-22T00:00:00+08:00",
        providers: ["Twelve Data", "Alpha Vantage"],
        receivedAt: "2026-07-23T00:00:00Z",
      },
    });
  });

  it("rejects provider metadata with an invalid source timestamp", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: {
        choices: [{ message: { content: JSON.stringify(modelSection("risk")) } }],
        search_info: { search_results: [{ index: 1, title: "可信来源", url: "https://example.com/source", published_time: "2026-02-30T07:15:00+08:00" }] },
      },
    }));

    await expect(generateQwenBriefSection({
      date: "2026-07-23",
      key: "risk",
      apiKey: "secret",
      fetcher,
      globalSnapshot: [],
    })).rejects.toThrow("source validation");
  });

  it("fails explicitly when a cited OpenAI URL has no verifiable publication metadata", async () => {
    const fetcher: typeof fetch = async (input) => {
      if (String(input) === "https://example.com/openai") {
        return new Response('<time datetime="2026-07-23T07:15:00+08:00">updated</time>', { headers: { "last-modified": "Wed, 23 Jul 2026 00:00:00 GMT" } });
      }
      return new Response(JSON.stringify({
        output: [
          { type: "web_search_call", action: { sources: [{ type: "url", url: "https://example.com/openai" }] } },
          {
            type: "message",
            content: [{
              type: "output_text",
              text: JSON.stringify(openAIModelSection("risk", ["https://example.com/openai", "https://example.com/openai"])),
              annotations: [{ type: "url_citation", title: "搜索来源", url: "https://example.com/openai" }],
            }],
          },
        ],
      }));
    };

    await expect(generateOpenAIBriefSection({
      date: "2026-07-23",
      key: "risk",
      apiKey: "secret",
      fetcher,
      globalSnapshot: [],
    })).rejects.toThrow("cited source could not be validated");
  });

  it("blocks private cited URLs before any metadata request", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({
        output: [
          { type: "web_search_call", action: { sources: [{ type: "url", url: "http://127.0.0.1/private" }] } },
          { type: "message", content: [{ type: "output_text", text: JSON.stringify(openAIModelSection("risk", ["http://127.0.0.1/private", "http://127.0.0.1/private"])), annotations: [{ type: "url_citation", title: "内网", url: "http://127.0.0.1/private" }] }] },
        ],
      }));
    };

    await expect(generateOpenAIBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher, globalSnapshot: [] }))
      .rejects.toThrow("outbound URL policy");
    expect(calls).toEqual(["https://api.openai.com/v1/responses"]);
  });

  it("blocks IPv4-mapped IPv6 loopback citation URLs before any metadata request", async () => {
    const privateUrl = "http://[::ffff:127.0.0.1]/private";
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({
        output: [
          { type: "web_search_call", action: { sources: [{ type: "url", url: privateUrl }] } },
          { type: "message", content: [{ type: "output_text", text: JSON.stringify(openAIModelSection("risk", [privateUrl, privateUrl])), annotations: [{ type: "url_citation", title: "内网", url: privateUrl }] }] },
        ],
      }));
    };

    await expect(generateOpenAIBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher, globalSnapshot: [] }))
      .rejects.toThrow("outbound URL policy");
    expect(calls).toEqual(["https://api.openai.com/v1/responses"]);
  });

  it("blocks a public citation redirect to a private destination", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push(String(input));
      if (String(input) === "https://example.com/redirect") {
        expect(init?.redirect).toBe("manual");
        return new Response("", { status: 302, headers: { location: "http://127.0.0.1/private" } });
      }
      return new Response(JSON.stringify({
        output: [
          { type: "web_search_call", action: { sources: [{ type: "url", url: "https://example.com/redirect" }] } },
          { type: "message", content: [{ type: "output_text", text: JSON.stringify(openAIModelSection("risk", ["https://example.com/redirect", "https://example.com/redirect"])), annotations: [{ type: "url_citation", title: "重定向来源", url: "https://example.com/redirect" }] }] },
        ],
      }));
    };

    await expect(generateOpenAIBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher, globalSnapshot: [] }))
      .rejects.toThrow("outbound URL policy");
    expect(calls).toEqual(["https://api.openai.com/v1/responses", "https://example.com/redirect"]);
  });
});
