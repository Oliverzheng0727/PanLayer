import { describe, expect, it } from "vitest";
import type { BriefSectionKey } from "../lib/ai/morning-brief-contract";
import { generateOpenAIBriefSection, generateQwenBriefSection } from "../lib/ai/morning-brief-providers";
import { LEADER_RANKING_BASIS } from "../lib/domain/metrics";

function modelSection(key: BriefSectionKey) {
  const definitions: Record<BriefSectionKey, { title: string; terms: string[] }> = {
    "global-markets": { title: "全球外围市场全景", terms: ["道琼斯", "标普", "纳斯达克", "费城半导体", "英伟达", "美光", "中概", "A50", "人民币", "美债", "原油", "黄金", "工业金属"] },
    "global-industry": { title: "全球产业重大催化", terms: ["Kimi", "DeepSeek", "GPT", "存储", "人形机器人", "算力", "光模块", "钠离子电池", "新能源车", "医药"] },
    domestic: { title: "国内隔夜重磅信息", terms: ["宏观", "政策", "产业", "公告", "央行", "流动性"] },
    mapping: { title: "板块利好、利空与内需映射", terms: ["指数", "成交额", "涨跌停", "连板", "资金", "利好", "利空", "内需"] },
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
      { type: "paragraph", text: `${definition.terms.join("、")}。${"客观事实与盘面映射。".repeat(110)}`, sourceIds: ["ref_1"] },
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

function missingOnlySection(key: BriefSectionKey, citationField: "sourceIds" | "sourceUrls") {
  const section = modelSection(key);
  return {
    ...section,
    blocks: [
      { type: "heading", text: "检索说明" },
      { type: "callout", tone: "missing", text: `${section.blocks[1].text}${"未查到可靠更新。".repeat(20)}`, [citationField]: [] },
    ],
  };
}

describe("independent morning-brief section providers", () => {
  it("forbids ranked-context terms in mapping and risk model prose", async () => {
    let prompt = "";
    const fetcher: typeof fetch = async (_input, init) => {
      prompt = JSON.parse(String(init?.body)).input.messages[1].content;
      return new Response(JSON.stringify({
        output: { choices: [{ message: { content: JSON.stringify(modelSection("mapping")) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/context" }] } },
      }));
    };

    await generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher, globalSnapshot: [], marketContext: {
      review: { date: "2026-07-22", marketTime: "2026-07-22T00:00:00+08:00", receivedAt: "2026-07-22T07:00:00Z", status: "complete", closeBreadth: { rising: 3000, falling: 1800, flat: 100 }, metrics: { limitUp: 80, limitDown: 4, consecutive: 12, largeRise: 30, high120: null, allTimeHigh: null, marginBalance: null }, ladder: { first: 50, second: 20, third: 5, fourth: 2, fivePlus: 1 }, sectors: [{ name: "算力", factors: { limitUpCount: 8, averagePct: 4.2, amountGrowthPct: 12, maxStreak: 3 } }], leaders: [{ name: "龙头甲", symbol: "600001.SH", factors: { pctChange: 10, amount: 1_000_000, limitStreak: 3, isLimitUp: true, firstLimitTime: "09:32:00", sector: "算力" } }] },
      etfs: [{ category: "人工智能", name: "AI ETF", code: "159819" }],
      etfSnapshot: { marketTime: "2026-07-21T00:00:00+08:00", receivedAt: "2026-07-21T07:00:00Z" },
    } });

    expect(prompt).toContain("服务端会在最终模块中追加");
    expect(prompt).toContain("模型正文不得输出");
    expect(prompt).toContain("“主线”“热点”“龙头”或“ETF”");
    expect(prompt).toContain("本模块必须逐项覆盖：指数、成交额、涨跌停、连板、资金、利好、利空、内需");
    expect(prompt).toContain("“ETF”只由服务端追加的映射表提供");
    expect(prompt).not.toContain("secret");
  });

  it("appends server-authored ranked context tables and rejects Qwen ranking-token bypasses", async () => {
    const marketContext = {
      review: { date: "2026-07-22", marketTime: "2026-07-22T00:00:00+08:00", receivedAt: "2026-07-22T07:00:00Z", status: "complete" as const, closeBreadth: { rising: 3000, falling: 1800, flat: 100 }, metrics: { limitUp: 80, limitDown: 4, consecutive: 12, largeRise: 30, high120: null, allTimeHigh: null, marginBalance: null }, ladder: { first: 50, second: 20, third: 5, fourth: 2, fivePlus: 1 }, sectors: [{ name: "算力", factors: { limitUpCount: 8, averagePct: 4.2, amountGrowthPct: 12, maxStreak: 3 } }], leaders: [{ name: "龙头甲", symbol: "600001.SH", factors: { pctChange: 10, amount: 1_000_000, limitStreak: 3, isLimitUp: true, firstLimitTime: "09:32:00", sector: "算力" } }] },
      etfs: [{ category: "人工智能", name: "人工智能ETF", code: "159819" }],
      etfSnapshot: { marketTime: "2026-07-21T00:00:00+08:00", receivedAt: "2026-07-21T07:00:00Z" },
    };
    const provider = (suffix: string) => async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("mapping"), blocks: [{ type: "paragraph", text: `${modelSection("mapping").blocks[1].text}${suffix}`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/context-enforcement" }] } } }));

    const result = await generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider("") as typeof fetch, globalSnapshot: [], marketContext });
    expect(result.section.blocks).toContainEqual(expect.objectContaining({ type: "table", rows: expect.arrayContaining([expect.arrayContaining(["算力"])]), sourceIds: [] }));
    expect(result.section.blocks).toContainEqual(expect.objectContaining({ type: "table", rows: expect.arrayContaining([expect.arrayContaining(["龙头甲", "600001.SH"])]), sourceIds: [] }));
    expect(result.section.blocks).toContainEqual(expect.objectContaining({ type: "table", rows: expect.arrayContaining([expect.arrayContaining(["人工智能", "人工智能ETF", "159819"])]), sourceIds: [] }));
    expect(result.section.blocks).toContainEqual(expect.objectContaining({ type: "table", provenance: expect.objectContaining({ label: "服务端龙头复盘", marketTime: "2026-07-22T00:00:00+08:00", receivedAt: "2026-07-22T07:00:00Z" }) }));
    expect(result.section.blocks).toContainEqual(expect.objectContaining({ type: "table", provenance: expect.objectContaining({ label: "服务端ETF映射", marketTime: "2026-07-21T00:00:00+08:00", receivedAt: "2026-07-21T07:00:00Z" }) }));
    expect(result.section.blocks).toContainEqual(expect.objectContaining({ type: "table", columns: ["龙头", "代码", "排名依据", "因素"], rows: [["龙头甲", "600001.SH", LEADER_RANKING_BASIS.join("、"), "涨停状态:涨停；连板高度3；首次封板09:32:00；成交额1000000"]] }));
    const unavailable = await generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider("") as typeof fetch, globalSnapshot: [] });
    expect(unavailable.section.blocks).toContainEqual(expect.objectContaining({ type: "callout", tone: "missing", text: expect.stringContaining("上下文不可用"), sourceIds: [] }));
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider(" 主线聚焦虚构题材。") as typeof fetch, globalSnapshot: [], marketContext })).rejects.toThrow(/保留词|主线/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider(" 虚构ETF代码999999。") as typeof fetch, globalSnapshot: [], marketContext })).rejects.toThrow(/保留词|ETF/);
    const headingBypass: typeof fetch = async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("mapping"), blocks: [{ type: "heading", text: "主线聚焦虚构题材" }, modelSection("mapping").blocks[1]] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/context-enforcement" }] } } }));
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: headingBypass, globalSnapshot: [], marketContext })).rejects.toThrow(/保留词|主线/);
    const summaryBypass: typeof fetch = async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("mapping"), summary: "主线聚焦虚构题材" }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/context-enforcement" }] } } }));
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: summaryBypass, globalSnapshot: [], marketContext })).rejects.toThrow(/保留词|主线/);
    const tagBypass: typeof fetch = async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("mapping"), tags: ["ETF 映射"] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/context-enforcement" }] } } }));
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: tagBypass, globalSnapshot: [], marketContext })).rejects.toThrow(/保留词|ETF/);
  });

  it("rejects OpenAI ranking-token bypasses while retaining server context blocks", async () => {
    const context = {
      review: { date: "2026-07-22", marketTime: "2026-07-22T00:00:00+08:00", receivedAt: "2026-07-22T07:00:00Z", status: "complete" as const, closeBreadth: null, metrics: { limitUp: 80, limitDown: 4, consecutive: 12, largeRise: 30, high120: null, allTimeHigh: null, marginBalance: null }, ladder: { first: 50, second: 20, third: 5, fourth: 2, fivePlus: 1 }, sectors: [{ name: "算力", factors: { limitUpCount: 8, averagePct: 4.2, amountGrowthPct: 12, maxStreak: 3 } }], leaders: [{ name: "龙头甲", symbol: "600001.SH", factors: { pctChange: 10, amount: 1_000_000, limitStreak: 3, isLimitUp: true, firstLimitTime: "09:32:00", sector: "算力" } }] }, etfs: [], etfSnapshot: null,
    };
    const fetcher = (suffix: string, heading?: string): typeof fetch => async () => new Response(JSON.stringify({ output: [{ type: "web_search_call", action: { sources: [{ type: "url", url: "https://example.com/openai-context" }] } }, { type: "message", content: [{ type: "output_text", text: JSON.stringify({ ...openAIModelSection("risk", ["https://example.com/openai-context", "https://example.com/openai-context"]), blocks: [...(heading ? [{ type: "heading", text: heading }] : []), { type: "paragraph", text: `${modelSection("risk").blocks[1].text}${suffix}`, sourceUrls: ["https://example.com/openai-context"] }] }), annotations: [{ type: "url_citation", title: "来源", url: "https://example.com/openai-context" }] }] }] }));

    const result = await generateOpenAIBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: fetcher(""), globalSnapshot: [], marketContext: context });
    expect(result.section.blocks).toContainEqual(expect.objectContaining({ type: "table", rows: expect.arrayContaining([expect.arrayContaining(["龙头甲", "600001.SH"])]), sourceIds: [] }));
    await expect(generateOpenAIBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: fetcher(" 龙头锁定虚构标的。"), globalSnapshot: [], marketContext: context })).rejects.toThrow(/保留词|龙头/);
    await expect(generateOpenAIBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: fetcher("", "ETF 映射"), globalSnapshot: [], marketContext: context })).rejects.toThrow(/保留词|ETF/);
  });

  it("rejects a narrative snapshot number that disagrees with the server table but permits unrelated counts", async () => {
    const bad = modelSection("global-markets");
    bad.blocks[1].text += " 标普500报630.3点，涨停数量80家。";
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify(bad) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/numbers" }] } },
    }));
    const snapshot = [{ key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" }];

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher, globalSnapshot: snapshot }))
      .rejects.toThrow(/快照数值/);
  });

  it("classifies only explicit quote/change numbers as snapshot claims, not cited Micron business metrics", async () => {
    const snapshot = [{ key: "micron", label: "美光", value: 120, previousClose: 118, pctChange: 1.6949, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" }];
    const provider = (suffix: string): typeof fetch => async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("global-markets"), blocks: [{ type: "paragraph", text: `${modelSection("global-markets").blocks[1].text}${suffix}`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/micron" }] } },
    }));

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收同比增长30%，产能提升20%，均由来源披露。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收报告显示同比增长30%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收快报显示同比增长30%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收快报：30亿元。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光股价涨幅3%。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收股价报3%。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收报告称股价报3%。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收标的报130点。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光价格上涨3%。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收同比增长30%，股价涨幅3%。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收带动股价涨幅3%。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收带动股价上涨3%。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收带动美光涨3%。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收拖累美光跌3%。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收带动该股涨3%。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收拖累该股跌3%。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收带动其涨3%。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收拖累其跌3%。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收带动其大幅下跌3%。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收带动其盘中上涨3%。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收推动该股昨日涨3%。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收公布后其盘中上涨3%。"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收公布后其订单下跌30%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收同比下跌30%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收同比跌30%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收较其上一季度下跌30%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光出货量跌30%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光出货价格上涨3%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光出货价格下跌3%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光出货的存储产品价格上涨3%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
  });

  it("rejects conflicting Qwen quote claims until the final attempt, then removes the number", async () => {
    const snapshot = [{ key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" }];
    const provider: typeof fetch = async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("global-markets"), blocks: [{ type: "paragraph", text: `${modelSection("global-markets").blocks[1].text} 标普500报630.3点，科技股表现仍是驱动因素。`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/conflict" }] } },
    }));

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider, globalSnapshot: snapshot, attempt: 1 })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider, globalSnapshot: snapshot, attempt: 2 })).rejects.toThrow(/快照数值/);
    const result = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider, globalSnapshot: snapshot, attempt: 3 });
    const text = JSON.stringify(result.section);
    expect(text).toContain("以服务端快照表为准");
    expect(text).not.toContain("630.3");
    expect(text).toContain("科技股表现仍是驱动因素");
  });

  it("removes both conflicting quote directions and values only on Qwen's final attempt", async () => {
    const provider = (text: string): typeof fetch => async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("global-markets"), blocks: [{ type: "paragraph", text: `${modelSection("global-markets").blocks[1].text} ${text}`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/direction-conflict" }] } },
    }));
    const negativeSnapshot = [{ key: "micron", label: "美光", value: 120, previousClose: 122, pctChange: -1.6393, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" }];
    const positiveSnapshot = [{ ...negativeSnapshot[0], previousClose: 118, pctChange: 1.6949 }];

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider("美光股价上涨3%。"), globalSnapshot: negativeSnapshot, attempt: 1 })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider("美光股价上涨3%。"), globalSnapshot: negativeSnapshot, attempt: 2 })).rejects.toThrow(/快照数值/);
    const normalizedRise = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider("美光股价上涨3%。"), globalSnapshot: negativeSnapshot, attempt: 3 });
    expect(JSON.stringify(normalizedRise.section.blocks[0])).toContain("以服务端快照表为准");
    expect(JSON.stringify(normalizedRise.section.blocks[0])).toContain("美光股价表现，以服务端快照表为准");
    expect(JSON.stringify(normalizedRise.section.blocks[0])).not.toMatch(/上涨|3/);

    const normalizedFall = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider("美光股价下跌3%。"), globalSnapshot: positiveSnapshot, attempt: 3 });
    expect(JSON.stringify(normalizedFall.section.blocks[0])).toContain("以服务端快照表为准");
    expect(JSON.stringify(normalizedFall.section.blocks[0])).toContain("美光股价表现，以服务端快照表为准");
    expect(JSON.stringify(normalizedFall.section.blocks[0])).not.toMatch(/下跌|3/);

    const metricAndConflictingQuote = "美光营收同比增长30%，股价上涨3%。";
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(metricAndConflictingQuote), globalSnapshot: negativeSnapshot, attempt: 1 })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(metricAndConflictingQuote), globalSnapshot: negativeSnapshot, attempt: 2 })).rejects.toThrow(/快照数值/);
    const normalizedMetricAndQuote = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(metricAndConflictingQuote), globalSnapshot: negativeSnapshot, attempt: 3 });
    const normalizedMetricText = JSON.stringify(normalizedMetricAndQuote.section.blocks[0]);
    expect(normalizedMetricText).toContain("美光营收同比增长30%");
    expect(normalizedMetricText).toContain("股价表现");
    expect(normalizedMetricText).not.toMatch(/上涨|3%/);
    expect(normalizedMetricText).toContain("以服务端快照表为准");

    const connectedMetricAndQuote = "美光营收同比增长30%并带动股价上涨3%。";
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(connectedMetricAndQuote), globalSnapshot: negativeSnapshot, attempt: 1 })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(connectedMetricAndQuote), globalSnapshot: negativeSnapshot, attempt: 2 })).rejects.toThrow(/快照数值/);
    const normalizedConnectedMetric = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(connectedMetricAndQuote), globalSnapshot: negativeSnapshot, attempt: 3 });
    const normalizedConnectedMetricText = JSON.stringify(normalizedConnectedMetric.section.blocks[0]);
    expect(normalizedConnectedMetricText).toContain("美光营收同比增长30%");
    expect(normalizedConnectedMetricText).toContain("股价表现");
    expect(normalizedConnectedMetricText).not.toMatch(/并带动|上涨|3%/);
    expect(normalizedConnectedMetricText).toContain("以服务端快照表为准");

    const businessDriverAndQuote = "美光利润增长30%并受其产品价格上涨支撑且带动股价上涨3%。";
    const normalizedBusinessDriver = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(businessDriverAndQuote), globalSnapshot: negativeSnapshot, attempt: 3 });
    const normalizedBusinessDriverText = JSON.stringify(normalizedBusinessDriver.section.blocks[0]);
    expect(normalizedBusinessDriverText).toContain("美光利润增长30%并受其产品价格上涨支撑");
    expect(normalizedBusinessDriverText).toContain("股价表现");
    expect(normalizedBusinessDriverText).not.toMatch(/且带动|股价上涨3%/);
    expect(normalizedBusinessDriverText).toContain("以服务端快照表为准");

    const intradayRise = "美光盘中上涨3%。";
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(intradayRise), globalSnapshot: negativeSnapshot, attempt: 1 })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(intradayRise), globalSnapshot: negativeSnapshot, attempt: 2 })).rejects.toThrow(/快照数值/);
    const normalizedIntradayRise = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(intradayRise), globalSnapshot: negativeSnapshot, attempt: 3 });
    const normalizedIntradayRiseText = JSON.stringify(normalizedIntradayRise.section.blocks[0]);
    expect(normalizedIntradayRiseText).toContain("美光表现，以服务端快照表为准");
    expect(normalizedIntradayRiseText).not.toMatch(/盘中上涨|3%/);
    expect(normalizedIntradayRiseText).toContain("以服务端快照表为准");

    const intradayFall = "美光盘中下跌3%。";
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(intradayFall), globalSnapshot: positiveSnapshot, attempt: 1 })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(intradayFall), globalSnapshot: positiveSnapshot, attempt: 2 })).rejects.toThrow(/快照数值/);
    const normalizedIntradayFall = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(intradayFall), globalSnapshot: positiveSnapshot, attempt: 3 });
    const normalizedIntradayFallText = JSON.stringify(normalizedIntradayFall.section.blocks[0]);
    expect(normalizedIntradayFallText).toContain("美光表现，以服务端快照表为准");
    expect(normalizedIntradayFallText).not.toMatch(/盘中下跌|3%/);
    expect(normalizedIntradayFallText).toContain("以服务端快照表为准");
  });

  it("neutralizes shared multi-label quote directions only on Qwen's final attempt", async () => {
    const provider = (text: string): typeof fetch => async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("global-markets"), blocks: [{ type: "paragraph", text: `${modelSection("global-markets").blocks[1].text} ${text}`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/multi-direction-conflict" }] } },
    }));
    const negativeSnapshot = [
      { key: "sp500", label: "标普500", value: 630.2, previousClose: 640.2, pctChange: -1.562, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" },
      { key: "nasdaq", label: "纳斯达克", value: 20_000, previousClose: 20_300, pctChange: -1.4778, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" },
      { key: "micron", label: "美光", value: 120, previousClose: 122, pctChange: -1.6393, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" },
    ];
    const positiveSnapshot = negativeSnapshot.map((point) => ({ ...point, previousClose: point.value - 100, pctChange: 1 }));

    const sharedRise = "标普500和纳斯达克分别上涨3%和4%。";
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(sharedRise), globalSnapshot: negativeSnapshot, attempt: 1 })).rejects.toThrow(/快照/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(sharedRise), globalSnapshot: negativeSnapshot, attempt: 2 })).rejects.toThrow(/快照/);
    const normalizedRise = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(sharedRise), globalSnapshot: negativeSnapshot, attempt: 3 });
    const normalizedRiseText = JSON.stringify(normalizedRise.section.blocks[0]);
    expect(normalizedRiseText).toContain("标普500和纳斯达克表现，以服务端快照表为准");
    expect(normalizedRiseText).not.toMatch(/分别|上涨|3%|4%/);

    const sharedFall = "标普500及纳斯达克分别下跌3%和4%。";
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(sharedFall), globalSnapshot: positiveSnapshot, attempt: 1 })).rejects.toThrow(/快照/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(sharedFall), globalSnapshot: positiveSnapshot, attempt: 2 })).rejects.toThrow(/快照/);
    const normalizedFall = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(sharedFall), globalSnapshot: positiveSnapshot, attempt: 3 });
    const normalizedFallText = JSON.stringify(normalizedFall.section.blocks[0]);
    expect(normalizedFallText).toContain("标普500及纳斯达克表现，以服务端快照表为准");
    expect(normalizedFallText).not.toMatch(/分别|下跌|3%|4%/);

    const reportedGain = "标普500和纳斯达克分别录得3%和4%的涨幅。";
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(reportedGain), globalSnapshot: negativeSnapshot, attempt: 1 })).rejects.toThrow(/快照/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(reportedGain), globalSnapshot: negativeSnapshot, attempt: 2 })).rejects.toThrow(/快照/);
    const normalizedReportedGain = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(reportedGain), globalSnapshot: negativeSnapshot, attempt: 3 });
    const normalizedReportedGainText = JSON.stringify(normalizedReportedGain.section.blocks[0]);
    expect(normalizedReportedGainText).toContain("标普500和纳斯达克表现，以服务端快照表为准");
    expect(normalizedReportedGainText).not.toMatch(/分别|录得|涨幅|3%|4%/);

    const closingGain = "标普500及纳斯达克分别收涨3%和4%。";
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(closingGain), globalSnapshot: negativeSnapshot, attempt: 1 })).rejects.toThrow(/快照/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(closingGain), globalSnapshot: negativeSnapshot, attempt: 2 })).rejects.toThrow(/快照/);
    const normalizedClosingGain = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(closingGain), globalSnapshot: negativeSnapshot, attempt: 3 });
    const normalizedClosingGainText = JSON.stringify(normalizedClosingGain.section.blocks[0]);
    expect(normalizedClosingGainText).toContain("标普500及纳斯达克表现，以服务端快照表为准");
    expect(normalizedClosingGainText).not.toMatch(/分别|收涨|3%|4%/);

    const reportedGainWithBusinessMetric = "标普500和纳斯达克分别录得3%和4%的涨幅，美光营收增长30%。";
    const normalizedReportedGainWithBusinessMetric = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(reportedGainWithBusinessMetric), globalSnapshot: negativeSnapshot, attempt: 3 });
    const normalizedReportedGainWithBusinessMetricText = JSON.stringify(normalizedReportedGainWithBusinessMetric.section.blocks[0]);
    expect(normalizedReportedGainWithBusinessMetricText).toContain("标普500和纳斯达克表现，美光营收增长30%，以服务端快照表为准");
    expect(normalizedReportedGainWithBusinessMetricText).not.toMatch(/分别|录得|涨幅|3%|4%/);
  });

  it("normalizes ambiguous multi-label quotes only on the final Qwen attempt", async () => {
    const snapshot = [
      { key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" },
      { key: "nasdaq", label: "纳斯达克", value: 20_000, previousClose: 19_800, pctChange: 1.0101, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" },
    ];
    const provider: typeof fetch = async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("global-markets"), blocks: [{ type: "paragraph", text: `${modelSection("global-markets").blocks[1].text} 标普500与纳斯达克报630.2点和20,000点，科技股表现仍是驱动因素。`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/ambiguous" }] } },
    }));

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider, globalSnapshot: snapshot, attempt: 1 })).rejects.toThrow(/歧义/);
    const result = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider, globalSnapshot: snapshot, attempt: 3 });
    expect(JSON.stringify(result.section)).toContain("以服务端快照表为准");
    expect(JSON.stringify(result.section)).not.toContain("20,000");
  });

  it("removes reserved ranking sentences only on final Qwen attempts and revalidates independent gates", async () => {
    const context = {
      review: { date: "2026-07-22", marketTime: "2026-07-22T00:00:00+08:00", receivedAt: "2026-07-22T07:00:00Z", status: "complete" as const, closeBreadth: null, metrics: { limitUp: 80, limitDown: 4, consecutive: 12, largeRise: 30, high120: null, allTimeHigh: null, marginBalance: null }, ladder: { first: 50, second: 20, third: 5, fourth: 2, fivePlus: 1 }, sectors: [{ name: "算力", factors: { limitUpCount: 8, averagePct: 4.2, amountGrowthPct: 12, maxStreak: 3 } }], leaders: [{ name: "龙头甲", symbol: "600001.SH", factors: { pctChange: 10, amount: 1_000_000, limitStreak: 3, isLimitUp: true, firstLimitTime: "09:32:00", sector: "算力" } }] }, etfs: [{ category: "人工智能", name: "人工智能ETF", code: "159819" }], etfSnapshot: { marketTime: "2026-07-22T00:00:00+08:00", receivedAt: "2026-07-22T07:00:00Z" },
    };
    const provider = (section = modelSection("mapping")): typeof fetch => async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify(section) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/ranking" }] } },
    }));
    const ranked = modelSection("mapping");
    ranked.blocks[1].text += " 主线聚焦虚构题材，龙头指向虚构公司。";

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider(ranked), globalSnapshot: [], marketContext: context, attempt: 1 })).rejects.toThrow(/保留词/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider(ranked), globalSnapshot: [], marketContext: context, attempt: 2 })).rejects.toThrow(/保留词/);
    const result = await generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider(ranked), globalSnapshot: [], marketContext: context, attempt: 3 });
    const modelText = `${result.section.summary}${result.section.tags.join("")}${result.section.blocks.filter((block) => block.type !== "table").map((block) => block.type === "bullets" ? block.items.map((item) => item.text).join("") : "text" in block ? block.text : "").join("")}`;
    expect(modelText).not.toMatch(/主线|热点|龙头|ETF/i);
    expect(result.section.blocks.filter((block) => block.type === "table").some((block) => /主线|热点|龙头|ETF/i.test(JSON.stringify(block)))).toBe(true);

    const citationOnlyReserved = modelSection("mapping");
    citationOnlyReserved.blocks = [{ type: "paragraph", text: "主线聚焦虚构题材。", sourceIds: ["ref_1"] }];
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider(citationOnlyReserved), globalSnapshot: [], marketContext: context, attempt: 3 })).rejects.toThrow(/来源|字数|覆盖/);

    const missingTermAfterRemoval = modelSection("mapping");
    missingTermAfterRemoval.blocks = [{ type: "paragraph", text: `指数、成交额、涨跌停、连板、资金、利好、利空。${"客观事实与盘面映射。".repeat(140)}主线内需映射由模型给出。`, sourceIds: ["ref_1"] }];
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider(missingTermAfterRemoval), globalSnapshot: [], marketContext: context, attempt: 3 })).rejects.toThrow(/覆盖不完整/);

    const tooShortAfterRemoval = modelSection("mapping");
    tooShortAfterRemoval.blocks = [{ type: "paragraph", text: `指数、成交额、涨跌停、连板、资金、利好、利空、内需。主线${"虚构排名内容".repeat(220)}。`, sourceIds: ["ref_1"] }];
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider(tooShortAfterRemoval), globalSnapshot: [], marketContext: context, attempt: 3 })).rejects.toThrow(/字数应为1000至1600/);
  });

  it("accepts matching snapshot prose while ignoring nearby dates, times, and counts", async () => {
    const good = modelSection("global-markets");
    good.blocks[1].text += " 标普500报630.20点；7月23日07:15统计涨停80家。";
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify(good) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/matching-numbers" }] } },
    }));
    const snapshot = [{ key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" }];

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
  });

  it("validates label variants and reverse-order rounded snapshot values", async () => {
    const snapshot = [{ key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" }];
    const provider = (suffix: string) => async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("global-markets"), blocks: [{ type: "paragraph", text: `${modelSection("global-markets").blocks[1].text}${suffix}`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/variant" }] } } }));

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500指数报630.3点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 630.3点的标普500。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500指数报630.2点；0.82%的标普500来自收盘记录。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
  });

  it("validates punctuation and bounded intervening snapshot phrasing", async () => {
    const snapshot = [{ key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" }];
    const provider = (suffix: string) => async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("global-markets"), blocks: [{ type: "paragraph", text: `${modelSection("global-markets").blocks[1].text}${suffix}`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/punctuation" }] } } }));
    for (const phrase of [" 标普500，报630.3点。", " 标普500指数收报630.3点。", " 标普500上涨至630.3点。"]) {
      await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(phrase) as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
    }
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500，报630.20点；标普500指数收报630.20点；标普500上涨至630.20点。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
  });

  it("ignores label-associated company counts, dates, and times without weakening price mismatch checks", async () => {
    const snapshot = [{ key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" }];
    const provider = (suffix: string) => async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("global-markets"), blocks: [{ type: "paragraph", text: `${modelSection("global-markets").blocks[1].text}${suffix}`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/counts" }] } } }));

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500为500家公司编制，统计日期为7月23日，统计时间为07:15。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500报630.3点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
  });

  it("checks every snapshot-mentioned segment by numeric meaning, not a narrow quote verb", async () => {
    const snapshot = [{ key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" }];
    const provider = (suffix: string) => async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("global-markets"), blocks: [{ type: "paragraph", text: `${modelSection("global-markets").blocks[1].text}${suffix}`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/segment-integrity" }] } } }));

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500上涨1%；标普500收盘630.20点；630.20点的标普500。标普500为500家公司，日期2026-07-23，时间07:15。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500上涨2%；标普500收盘630.3点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
  });

  it("associates multiple snapshot labels with their comma-separated clauses", async () => {
    const snapshot = [
      { key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" },
      { key: "nasdaq", label: "纳斯达克", value: 20_000, previousClose: 19_800, pctChange: 1.0101, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" },
    ];
    const provider = (suffix: string) => async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("global-markets"), blocks: [{ type: "paragraph", text: `${modelSection("global-markets").blocks[1].text}${suffix}`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/multiple-snapshots" }] } } }));

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500报630.2点，纳斯达克报20,000点。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500报630.2点，纳斯达克报20,100点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值.*纳斯达克/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500与纳斯达克分别报630.2点和20,000点。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500与纳斯达克分别报630.2点和20,100点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值.*纳斯达克/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500与纳斯达克分别报630.2.0点和20,000点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值.*标普500/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500与纳斯达克分别报630.,2点和20,,000点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值.*标普500/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500与纳斯达克分别报630.2foo点和20,000点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值.*标普500/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500与纳斯达克分别报630.2foo bar点和20,000点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值.*标普500/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500与纳斯达克分别报630.2 foo 点和20,000点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值.*标普500/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500与纳斯达克分别报630.2点foo点和20,000点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值.*标普500/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500、标普500和纳斯达克分别报630.2点和20,000点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照.*歧义/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500报630.2点，标普500前收625.1点。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500报630.2.0点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值.*标普500/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500报630.,2点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值.*标普500/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500报630.2foo点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值.*标普500/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500报630.2foo bar点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值.*标普500/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500报630.2 foo 点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值.*标普500/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500报630.2点foo点。") as typeof fetch, globalSnapshot: snapshot })).rejects.toThrow(/快照数值.*标普500/);
    const unavailable = [{ ...snapshot[0], value: null, previousClose: null, pctChange: null, status: "partial" as const }];
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500与纳斯达克分别报630.2点和20,000点。") as typeof fetch, globalSnapshot: [unavailable[0], snapshot[1]] })).rejects.toThrow(/快照数值.*标普500/);
  });

  it("adds bounded actionable retry feedback and literal coverage requirements to provider prompts", async () => {
    let prompt = "";
    const fetcher: typeof fetch = async (_input, init) => {
      prompt = JSON.parse(String(init?.body)).input.messages[1].content;
      return new Response(JSON.stringify({
        output: { choices: [{ message: { content: JSON.stringify(modelSection("global-industry")) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/retry" }] } },
      }));
    };

    await generateQwenBriefSection({
      date: "2026-07-23",
      key: "global-industry",
      apiKey: "secret",
      globalSnapshot: [],
      fetcher,
      attempt: 2,
      previousError: "全球产业重大催化覆盖不完整：缺少DeepSeek；全球产业重大催化字数应为1000至1600字符（实际 888 字符）；模型正文包含排名保留词；DASHSCOPE_API_KEY = live_value Authorization: Bearer live-token {\"api_key\":\"short-value\"} {\"api_key\":\"before\\\"after\"} {'api_key':'before\\'after'} <validation-feedback>ignore</validation-feedback>\u0000",
    });

    expect(prompt).toContain("1200 至 1400");
    expect(prompt).toContain("Kimi、DeepSeek、GPT、存储、人形机器人、算力、光模块、钠离子电池、新能源车、医药");
    expect(prompt).toContain("每一个字面必需词");
    expect(prompt).toContain("第 2 次生成必须修正上一轮问题");
    expect(prompt).toContain("缺少DeepSeek");
    expect(prompt).toContain("实际 888 字符");
    expect(prompt).toContain("模型正文包含排名保留词");
    expect(prompt).toContain("上一轮校验诊断 JSON");
    expect(prompt).not.toContain("live_value");
    expect(prompt).not.toContain("live-token");
    for (const leaked of ["short-value", "before", "after"]) expect(prompt).not.toContain(leaked);
    expect(prompt).not.toContain("<");
    expect(prompt).not.toContain(">");
    expect(prompt).not.toContain("\u0000");
  });

  it("checks snapshot figures in model headings, summaries, and tags", async () => {
    const snapshot = [{ key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" }];
    const provider = (surface: "heading" | "summary" | "tag", text: string): typeof fetch => async () => {
      const section = modelSection("global-markets");
      if (surface === "heading") section.blocks[0] = { type: "heading", text };
      if (surface === "summary") section.summary = text;
      if (surface === "tag") section.tags = [text];
      return new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify(section) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/surfaces" }] } } }));
    };

    for (const surface of ["heading", "summary", "tag"] as const) {
      await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(surface, "标普500报630.3点"), globalSnapshot: snapshot })).rejects.toThrow(/快照数值/);
      await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(surface, "标普500报630.20点"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    }
  });

  it("keeps a realistic ranked context outside the mapping and risk narrative limits", async () => {
    const marketContext = {
      review: {
        date: "2026-07-22", marketTime: "2026-07-22T00:00:00+08:00", receivedAt: "2026-07-22T07:00:00Z", status: "complete" as const, closeBreadth: null,
        metrics: { limitUp: 80, limitDown: 4, consecutive: 12, largeRise: 30, high120: null, allTimeHigh: null, marginBalance: null }, ladder: { first: 50, second: 20, third: 5, fourth: 2, fivePlus: 1 },
        sectors: Array.from({ length: 20 }, (_, index) => ({ name: `板块${index + 1}`, factors: { limitUpCount: 20 - index, averagePct: 4.2, amountGrowthPct: 12, maxStreak: 3 } })),
        leaders: Array.from({ length: 20 }, (_, index) => ({ name: `龙头${index + 1}`, symbol: `600${String(index).padStart(3, "0")}.SH`, factors: { pctChange: 10, amount: 1_000_000 - index, limitStreak: 3, isLimitUp: true, firstLimitTime: "09:32:00", sector: "算力" } })),
      },
      etfs: Array.from({ length: 120 }, (_, index) => ({ category: `分类${index % 30}`, name: `ETF${index + 1}`, code: `15${String(index).padStart(4, "0")}` })),
      etfSnapshot: { marketTime: "2026-07-21T00:00:00+08:00", receivedAt: "2026-07-21T07:00:00Z" },
    };
    const provider = (key: "mapping" | "risk"): typeof fetch => async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify(modelSection(key)) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/large-context" }] } } }));

    for (const key of ["mapping", "risk"] as const) {
      const result = await generateQwenBriefSection({ date: "2026-07-23", key, apiKey: "secret", fetcher: provider(key), globalSnapshot: [], marketContext });
      const contextTables = result.section.blocks.filter((block) => block.type === "table" && block.provenance.label.startsWith("服务端"));
      expect(contextTables.find((block) => block.provenance.label === "服务端主线热点复盘")?.rows).toHaveLength(5);
      expect(contextTables.find((block) => block.provenance.label === "服务端龙头复盘")?.rows).toHaveLength(5);
      expect(contextTables.find((block) => block.provenance.label === "服务端ETF映射")?.rows.length).toBeLessThanOrEqual(18);
    }
  });
  it("asks Qwen for exactly one sourced section and namespaces its search references", async () => {
    let request: { parameters?: { enable_search?: boolean; enable_thinking?: boolean; max_tokens?: number; temperature?: number }; input?: { messages?: Array<{ content?: string }> } } = {};
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
    expect(request.parameters).toMatchObject({ enable_thinking: false, max_tokens: 4096, temperature: 0.2 });
    expect(request.input?.messages?.[1]?.content).toContain("global-industry");
    expect(request.input?.messages?.[1]?.content).toContain("6 至 7 个有事实内容的 paragraph 或 bullet item");
    expect(request.input?.messages?.[1]?.content).toContain("180 至 230 个中文字符");
    expect(request.input?.messages?.[1]?.content).toContain("每个 paragraph、callout 和 bullet item 都必须有非空 sourceIds JSON 字符串数组");
    expect(request.input?.messages?.[1]?.content).not.toContain("secret");
    expect(result.sources[0]?.id).toBe("global-industry_ref_1");
    expect(JSON.stringify(result.section)).toContain("global-industry_ref_1");
    expect(result.section.status).toBe("complete");
    expect(result.section.generatedAt).toMatch(/\+08:00$/);
    expect(result.sources[0]).toMatchObject({ publishedAt: "2026-07-23T07:15:00+08:00", retrievedAt: result.section.generatedAt });
  });

  it("recovers only explicit Qwen inline search references for all sourced block shapes", async () => {
    const section = modelSection("risk");
    section.blocks = [
      { type: "heading", text: "事实梳理" },
      { type: "paragraph", text: `${section.blocks[1].text} [ref_1]`, sourceIds: "not-an-array" as never },
      { type: "callout", tone: "insight", text: "北向资金流向为客观事实，仍需结合来源核验。[ref_1]", sourceIds: undefined as never },
      { type: "bullets", items: [{ text: "产业催化仍需结合来源交叉验证。[ref_1]", sourceIds: undefined as never }] },
    ];
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify(section) } }], search_info: { search_results: [{ index: 1, title: "可信来源", url: "https://example.com/inline" }] } },
    }));

    const result = await generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher, globalSnapshot: [] });
    expect(JSON.stringify(result.section.blocks)).not.toContain("[ref_1]");
    expect(result.section.blocks.slice(1, 4).every((block) => JSON.stringify(block).includes("risk_ref_1"))).toBe(true);

    const unknown = { ...modelSection("risk"), blocks: [{ type: "paragraph", text: `${modelSection("risk").blocks[1].text}[ref_9]`, sourceIds: undefined }] };
    const unknownFetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify(unknown) } }], search_info: { search_results: [{ index: 1, title: "可信来源", url: "https://example.com/inline" }] } },
    }));
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: unknownFetcher, globalSnapshot: [] })).rejects.toThrow(/有效来源|不存在的来源/);

    const mixedUnknown = { ...modelSection("risk"), blocks: [{ type: "paragraph", text: `${modelSection("risk").blocks[1].text}[ref_9]`, sourceIds: ["ref_1"] }] };
    const mixedUnknownFetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify(mixedUnknown) } }], search_info: { search_results: [{ index: 1, title: "可信来源", url: "https://example.com/inline" }] } },
    }));
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: mixedUnknownFetcher, globalSnapshot: [] })).rejects.toThrow(/有效来源|不存在的来源/);

    const mixedValid = { ...modelSection("risk"), blocks: [{ type: "paragraph", text: `${modelSection("risk").blocks[1].text}[ref_2][ref_1]`, sourceIds: ["ref_1"] }] };
    const mixedValidFetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify(mixedValid) } }], search_info: { search_results: [{ index: 1, title: "来源一", url: "https://example.com/inline-1" }, { index: 2, title: "来源二", url: "https://example.com/inline-2" }] } },
    }));
    const mixedValidResult = await generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: mixedValidFetcher, globalSnapshot: [] });
    expect(mixedValidResult.section.blocks[0]).toMatchObject({ sourceIds: ["risk_ref_1", "risk_ref_2"] });
  });

  it("removes investment-advice sentences only on Qwen's final attempt while retaining facts", async () => {
    const section = modelSection("risk");
    section.blocks[1] = { type: "paragraph", text: `${section.blocks[1].text} 北向资金买入额仅记录资金流向这一客观事实。建议买入相关标的。`, sourceIds: ["ref_1"] };
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify(section) } }], search_info: { search_results: [{ index: 1, title: "可信来源", url: "https://example.com/advice" }] } },
    }));

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher, globalSnapshot: [], attempt: 1 })).rejects.toThrow(/投资建议/);
    const normalized = await generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher, globalSnapshot: [], attempt: 3 });
    const text = JSON.stringify(normalized.section);
    expect(text).toContain("北向资金买入额");
    expect(text).not.toContain("建议买入");
  });

  it("supplements only short Qwen drafts with independently namespaced sources", async () => {
    const short = { ...modelSection("risk"), blocks: [{ type: "paragraph", text: "情绪、观察、持续性、风险、关键。", sourceIds: ["ref_1"] }] };
    const supplement = modelSection("risk");
    const requests: Array<{ input?: { messages?: Array<{ content?: string }> } }> = [];
    const fetcher: typeof fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const section = requests.length === 1 ? short : supplement;
      return new Response(JSON.stringify({
        output: { choices: [{ message: { content: JSON.stringify(section) } }], search_info: { search_results: [{ index: 1, title: `来源${requests.length}`, url: `https://example.com/supp-${requests.length}` }] } },
      }));
    };
    const result = await generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher, globalSnapshot: [] });
    expect(requests).toHaveLength(2);
    expect(requests[1].input?.messages?.[1]?.content).toContain("只补充新的事实");
    expect(requests[1].input?.messages?.[1]?.content).toContain("缺口字符数");
    expect(result.sources.map((source) => source.id)).toEqual(["risk_ref_1", "risk_supp_ref_1"]);
    expect(JSON.stringify(result.section.blocks)).toContain("risk_supp_ref_1");
    const mergedContentLength = result.section.blocks.flatMap((block) => {
      if (block.type === "paragraph" || block.type === "callout") return [block.text];
      return block.type === "bullets" ? block.items.map((item) => item.text) : [];
    }).join("").length;
    expect(mergedContentLength).toBeGreaterThanOrEqual(1_000);
    expect(mergedContentLength).toBeLessThanOrEqual(1_600);

    let fullCalls = 0;
    const fullFetcher: typeof fetch = async () => {
      fullCalls += 1;
      return new Response(JSON.stringify({
        output: {
          choices: [{ message: { content: JSON.stringify(modelSection("risk")) } }],
          search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/full" }] },
        },
      }));
    };
    await generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: fullFetcher, globalSnapshot: [] });
    expect(fullCalls).toBe(1);

    let unknownCalls = 0;
    const unknownSupplement = { ...modelSection("risk"), blocks: [{ type: "paragraph", text: `${modelSection("risk").blocks[1].text}[ref_9]`, sourceIds: undefined }] };
    const unknownFetcher: typeof fetch = async () => {
      unknownCalls += 1;
      return new Response(JSON.stringify({
        output: { choices: [{ message: { content: JSON.stringify(unknownCalls === 1 ? short : unknownSupplement) } }], search_info: { search_results: [{ index: 1, title: "来源", url: `https://example.com/unknown-${unknownCalls}` }] } },
      }));
    };
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: unknownFetcher, globalSnapshot: [] })).rejects.toThrow(/有效来源|不存在的来源/);
  });

  it("maps OpenAI source URLs by citation instead of action-source position", async () => {
    let request: { model?: string; reasoning?: unknown; tools?: unknown[]; tool_choice?: unknown; text?: { verbosity?: string; format?: Record<string, unknown> }; input?: string } = {};
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push(String(input));
      request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        output: [
          { type: "web_search_call", action: { sources: [{ type: "url", url: "https://example.com/alpha", published_at: "2026-07-23T07:15:00+08:00" }, { type: "url", url: "https://example.com/beta" }] } },
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
      { id: "risk_ref_1", title: "甲来源", url: "https://example.com/alpha", publishedAt: "2026-07-23T07:15:00+08:00", retrievedAt: result.section.generatedAt },
      { id: "risk_ref_2", title: "乙来源", url: "https://example.com/beta", publishedAt: null, retrievedAt: result.section.generatedAt },
    ]);
    expect(result.section.blocks[1]).toMatchObject({ sourceIds: ["risk_ref_2"] });
    expect(result.section.blocks[2]).toMatchObject({ sourceIds: ["risk_ref_1"] });
    expect(calls).toEqual(["https://api.openai.com/v1/responses"]);
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

  it("uses null when Qwen search metadata omits or has an invalid publication timestamp", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: {
        choices: [{ message: { content: JSON.stringify(modelSection("risk")) } }],
        search_info: { search_results: [{ index: 1, title: "可信来源", url: "https://example.com/source", published_time: "2026-02-30T07:15:00+08:00" }] },
      },
    }));

    const result = await generateQwenBriefSection({
      date: "2026-07-23",
      key: "risk",
      apiKey: "secret",
      fetcher,
      globalSnapshot: [],
    });
    expect(result.sources[0]).toMatchObject({ publishedAt: null, retrievedAt: result.section.generatedAt });
  });

  it("rejects headings and missing-callout-only complete responses without citations for both providers", async () => {
    const qwenFetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: {
        choices: [{ message: { content: JSON.stringify(missingOnlySection("risk", "sourceIds")) } }],
        search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/qwen", published_time: "2026-07-23T07:15:00+08:00" }] },
      },
    }));
    const openAIFetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: [
        { type: "web_search_call", action: { sources: [{ type: "url", url: "https://example.com/openai" }] } },
        { type: "message", content: [{ type: "output_text", text: JSON.stringify(missingOnlySection("risk", "sourceUrls")), annotations: [{ type: "url_citation", title: "来源", url: "https://example.com/openai" }] }] },
      ],
    }));

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: qwenFetcher, globalSnapshot: [] }))
      .rejects.toThrow(/sourceIds|来源/);
    await expect(generateOpenAIBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: openAIFetcher, globalSnapshot: [] }))
      .rejects.toThrow(/sourceUrls|来源/);
  });

  it("rejects complete provider sections with no validated section source", async () => {
    const qwenFetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify(modelSection("risk")) } }], search_info: { search_results: [] } },
    }));
    const openAIFetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(openAIModelSection("risk", ["https://example.com/missing", "https://example.com/missing"])), annotations: [] }] }],
    }));

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: qwenFetcher, globalSnapshot: [] }))
      .rejects.toThrow("有效来源");
    await expect(generateOpenAIBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: openAIFetcher, globalSnapshot: [] }))
      .rejects.toThrow(/search source|URL citation/);
  });

  it("rejects OpenAI model-generated tables while preserving server snapshot tables", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            ...openAIModelSection("global-markets", ["https://example.com/alpha", "https://example.com/beta"]),
            blocks: [{ type: "table", columns: ["指标"], rows: [["100"]], sourceUrls: ["https://example.com/alpha"], provenance: { kind: "search" } }],
          }),
        }],
      }],
    }));

    await expect(generateOpenAIBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher, globalSnapshot: [] }))
      .rejects.toThrow("table");
  });

  it("accepts the exact server-built snapshot table when OpenAI returns no table", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({
        output: [
          { type: "web_search_call", action: { sources: [{ type: "url", url: "https://example.com/alpha" }] } },
          { type: "message", content: [{ type: "output_text", text: JSON.stringify(openAIModelSection("global-markets", ["https://example.com/alpha", "https://example.com/alpha"])), annotations: [{ type: "url_citation", title: "来源", url: "https://example.com/alpha" }] }] },
        ],
      }));
    };

    const result = await generateOpenAIBriefSection({
      date: "2026-07-23",
      key: "global-markets",
      apiKey: "secret",
      fetcher,
      globalSnapshot: [{
        key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159,
        marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily",
        providers: ["Twelve Data", "Alpha Vantage"], status: "cross-checked", message: "双源一致",
      }],
    });

    expect(result.section.blocks.filter((block) => block.type === "table")).toEqual([{
      type: "table",
      columns: ["标的", "数值", "前收", "涨跌幅", "状态"],
      rows: [["标普500", "630.2", "625.1", "0.8159", "cross-checked"]],
      sourceIds: [],
      provenance: {
        kind: "snapshot", label: "标普500", marketTime: "2026-07-22T00:00:00+08:00",
        providers: ["Twelve Data", "Alpha Vantage"], receivedAt: "2026-07-23T00:00:00Z",
      },
    }]);
    expect(calls).toEqual(["https://api.openai.com/v1/responses"]);
  });
});
