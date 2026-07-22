import { describe, expect, it } from "vitest";
import { generateMorningBrief, validateMorningBrief } from "../lib/ai/morning-brief";

const validBrief = {
  date: "2026-07-22",
  sections: [
    "全球外围市场全景",
    "全球产业重大催化",
    "国内隔夜重磅信息",
    "板块利好、利空与内需映射",
    "盘前情绪、观察方向与风险",
  ].map((title, index) => ({
    title,
    items: [{ text: `内容${index}`, sourceIds: [`s${index}`] }],
  })),
  sources: Array.from({ length: 5 }, (_, index) => ({
    id: `s${index}`,
    title: `来源${index}`,
    url: `https://example.com/${index}`,
    publishedAt: "2026-07-22T06:00:00+08:00",
  })),
  disclaimer: "只做客观市场复盘，不构成投资建议。",
};

describe("morning brief contract", () => {
  it("accepts five sourced sections and the required disclaimer", () => {
    expect(validateMorningBrief(validBrief)).toEqual({ ok: true, errors: [] });
  });

  it("rejects unsourced claims and recommendation language", () => {
    const invalid = structuredClone(validBrief);
    invalid.sections[0].items[0].sourceIds = [];
    invalid.sections[1].items[0].text = "建议买入并加仓";
    const result = validateMorningBrief(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("来源");
    expect(result.errors.join(" ")).toContain("投资建议");
  });
});

describe("OpenAI morning brief generation", () => {
  it("uses Responses API web search, medium reasoning and strict structured output", async () => {
    let requestBody: {
      model?: string;
      reasoning?: unknown;
      tools?: unknown[];
      input?: string;
      text?: { format?: unknown };
    } = {};
    const fetcher: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(validBrief) }] }],
      }));
    };
    const result = await generateMorningBrief({
      date: "2026-07-22",
      apiKey: "test-key",
      fetcher,
      globalSnapshot: [{
        key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: .8159,
        marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily",
        providers: ["Twelve Data", "Alpha Vantage"], status: "cross-checked", message: "双源一致",
      }],
    });
    expect(result.date).toBe("2026-07-22");
    expect(requestBody.model).toBe("gpt-5.6-terra");
    expect(requestBody.reasoning).toEqual({ effort: "medium" });
    expect(requestBody.tools).toContainEqual({ type: "web_search", search_context_size: "medium" });
    expect(requestBody.text?.format).toMatchObject({ type: "json_schema", name: "panlayer_morning_brief", strict: true });
    expect(requestBody.input).toContain('"key":"sp500"');
    expect(requestBody.input).toContain("数值只能使用以上结构化快照");
    expect(requestBody.input).not.toContain("test-key");
  });
});
