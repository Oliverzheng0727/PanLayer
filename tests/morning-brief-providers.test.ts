import { describe, expect, it, vi } from "vitest";
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
  it("tells the provider that a weekend brief is for a closed A-share session", async () => {
    let prompt = "";
    const fetcher: typeof fetch = async (_input, init) => {
      prompt = JSON.parse(String(init?.body)).messages[1].content;
      return new Response(JSON.stringify({
        output: {
          choices: [{ message: { content: JSON.stringify(modelSection("risk")) } }],
          search_info: {
            search_results: [{
              index: 1,
              title: "可信来源",
              url: "https://example.com/weekend",
            }],
          },
        },
      }));
    };

    await generateQwenBriefSection({
      date: "2026-07-25",
      key: "risk",
      apiKey: "secret",
      fetcher,
      globalSnapshot: [],
    });

    expect(prompt).toContain("A股今日休市");
    expect(prompt).toContain("周末资讯与下个交易日背景梳理");
    expect(prompt).toContain("禁止输出高开、低开、平开或盘中方向判断");
  });

  it("forbids ranked-context terms in mapping and risk model prose", async () => {
    let prompt = "";
    const fetcher: typeof fetch = async (_input, init) => {
      prompt = JSON.parse(String(init?.body)).messages[1].content;
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

  it("normalizes common Qwen block aliases without weakening source validation", async () => {
    const section = modelSection("risk");
    const compatible = {
      ...section,
      blocks: [
        { type: "subheading", title: "事实梳理" },
        { type: "paragraph", content: section.blocks[1].text, sourceIds: ["ref_1"] },
        { type: "callout", content: "补充客观事实与风险提示。".repeat(12), sourceIds: ["ref_1"] },
        { type: "bullets", items: [{ content: "可验证的补充事实。".repeat(10), sourceIds: ["ref_1"] }, `${"含来源的补充事实。".repeat(10)}[ref_1]`] },
      ],
    };
    const provider = (payload: unknown): typeof fetch => async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify(payload) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/aliases" }] } },
    }));

    const result = await generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: provider(compatible), globalSnapshot: [] });
    expect(result.section.blocks).toContainEqual(expect.objectContaining({ type: "heading", text: "事实梳理" }));
    expect(result.section.blocks).toContainEqual(expect.objectContaining({ type: "paragraph", text: expect.stringContaining("补充客观事实") }));
    expect(JSON.stringify(result.section.blocks)).toContain("含来源的补充事实");

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: provider({ ...compatible, blocks: [{ type: "heading", text: "事实" }, { type: "quote", content: "secret original text" }] }), globalSnapshot: [] })).rejects.toThrow(/invalid block 2.*type=quote.*keys=/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: provider({ ...compatible, blocks: [{ type: "paragraph", content: section.blocks[1].text, sourceIds: ["ref_1"] }, { type: "bullets", items: ["secret original text"] }] }), globalSnapshot: [] })).rejects.toThrow(/invalid bullet 2\.1/);
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: provider({ ...compatible, blocks: [{ type: "paragraph", content: section.blocks[1].text, sourceIds: ["ref_99"] }] }), globalSnapshot: [] })).rejects.toThrow(/有效来源|不存在的来源/);
  });

  it("normalizes qwen3.7-plus compact news items into cited paragraphs", async () => {
    const section = modelSection("risk");
    const compact = {
      ...section,
      blocks: [
        { type: "heading", text: "事实梳理" },
        {
          type: "news-item",
          title: "隔夜风险信号",
          content: section.blocks[1].text,
          sourceIds: ["ref_1"],
        },
      ],
    };
    const provider: typeof fetch = async () => new Response(JSON.stringify({
      output: {
        choices: [{ message: { content: JSON.stringify(compact) } }],
        search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/compact-news" }] },
      },
    }));

    const result = await generateQwenBriefSection({
      date: "2026-07-23",
      key: "risk",
      apiKey: "secret",
      fetcher: provider,
      globalSnapshot: [],
    });

    expect(result.section.blocks).toContainEqual(expect.objectContaining({
      type: "paragraph",
      text: expect.stringContaining("隔夜风险信号"),
      sourceIds: ["risk_ref_1"],
    }));
  });

  it("normalizes qwen3.7-plus news-item field variants without dropping citations", async () => {
    const section = modelSection("risk");
    const provider: typeof fetch = async () => new Response(JSON.stringify({
      output: {
        choices: [{
          message: {
            content: JSON.stringify({
              ...section,
              blocks: [
                {
                  type: "news-item",
                  title: "隔夜条件变化",
                  fact: `${section.blocks[1].text.slice(0, 520)}。`,
                  condition: "来源所述条件仍需盘前数据核验。",
                  impact: "只记录客观影响，不推断未来涨跌。",
                  sector: "相关板块",
                  mapping: "未形成可验证映射",
                  publishedAt: null,
                  verificationStatus: "部分",
                  sourceIds: ["ref_1"],
                },
                {
                  type: "news-item",
                  eventFact: "另一项已核验事实",
                  excerpt: "原文短摘录",
                  coreImpact: "影响保持客观描述。",
                  sector: ["市场"],
                  objectiveMapping: "未形成可验证映射",
                  publishedAt: null,
                  verificationStatus: "verified",
                  sourceIds: ["ref_1"],
                },
                {
                  type: "news-item",
                  text: "补充的 cited prose。",
                  sourceIds: ["ref_1"],
                },
              ],
            }),
          },
        }],
        search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/news-variants" }] },
      },
    }));

    const result = await generateQwenBriefSection({
      date: "2026-07-23",
      key: "risk",
      apiKey: "secret",
      fetcher: provider,
      globalSnapshot: [],
    });

    expect(result.section.blocks).toContainEqual(expect.objectContaining({
      type: "news-item",
      event: "隔夜条件变化",
      sectors: ["相关板块"],
      leaderMap: ["未形成可验证映射"],
      verification: "partial",
      sourceIds: ["risk_ref_1"],
    }));
    expect(result.section.blocks).toContainEqual(expect.objectContaining({
      type: "news-item",
      event: "另一项已核验事实",
      sectors: ["市场"],
      verification: "verified",
    }));
    expect(result.section.blocks).toContainEqual(expect.objectContaining({
      type: "paragraph",
      text: "补充的 cited prose。",
      sourceIds: ["risk_ref_1"],
    }));
  });

  it("removes investment-advice language from every news-item field on the final Qwen attempt", async () => {
    const section = modelSection("global-industry");
    const provider: typeof fetch = async () => new Response(JSON.stringify({
      output: {
        choices: [{
          message: {
            content: JSON.stringify({
              ...section,
              blocks: [
                {
                  type: "news-item",
                  event: `${section.blocks[1].text.slice(0, 520)}。建议买入相关个股。`,
                  excerpt: "原文短摘录保持客观。仓位建议为半仓。",
                  impact: "客观影响仍需数据核验。可低吸相关方向。",
                  sectors: ["算力", "建议关注人形机器人"],
                  leaderMap: ["未形成可验证映射", "推荐配置相关股票"],
                  publishedAt: null,
                  verification: "partial",
                  sourceIds: ["ref_1"],
                },
              ],
            }),
          },
        }],
        search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/advice-filter" }] },
      },
    }));

    const result = await generateQwenBriefSection({
      date: "2026-07-23",
      key: "global-industry",
      apiKey: "secret",
      fetcher: provider,
      globalSnapshot: [],
    });
    const serialized = JSON.stringify(result.section.blocks);

    expect(result.section.status).toBe("complete");
    expect(serialized).toContain("客观影响仍需数据核验");
    expect(serialized).not.toMatch(/建议买入|仓位建议|低吸|建议关注|推荐配置/);
  });

  it("records uncovered required topics as unavailable instead of inventing facts", async () => {
    const section = modelSection("global-markets");
    section.blocks[1].text = section.blocks[1].text
      .replace("道琼斯、", "")
      .replace("标普、", "")
      .replace("黄金、", "")
      .replace("工业金属", "");
    const provider: typeof fetch = async () => new Response(JSON.stringify({
      output: {
        choices: [{ message: { content: JSON.stringify(section) } }],
        search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/coverage" }] },
      },
    }));

    const result = await generateQwenBriefSection({
      date: "2026-07-23",
      key: "global-markets",
      apiKey: "secret",
      fetcher: provider,
      globalSnapshot: [],
    });

    expect(result.section.status).toBe("complete");
    expect(result.section.blocks).toContainEqual(expect.objectContaining({
      type: "callout",
      tone: "missing",
      text: expect.stringContaining("道琼斯、标普、黄金、工业金属"),
      sourceIds: [],
      provenance: { kind: "unavailable", label: "模块覆盖核验" },
    }));
  });

  it("accepts only short Qwen bare-string headings and keeps uncited prose invalid", async () => {
    const section = modelSection("global-markets");
    const provider = (blocks: unknown[]): typeof fetch => async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify({ ...section, blocks }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/bare-heading" }] } },
    }));
    const validBlocks = ["隔夜市场概览", { type: "paragraph", text: section.blocks[1].text, sourceIds: ["ref_1"] }];

    const result = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(validBlocks), globalSnapshot: [] });
    expect(result.section.blocks[0]).toEqual({ type: "heading", text: "隔夜市场概览" });

    for (const invalid of ["这是一句无引用事实。", "美股大幅下跌", "美联储宣布加息", "包含来源[ref_1]", "标题\n换行", "2026年市场概览", " "]) {
      await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider([invalid, validBlocks[1]]), globalSnapshot: [] })).rejects.toThrow(/invalid block 1/);
    }
  });

  it("uses only supplied Firecrawl sources during Qwen correction", async () => {
    let body: {
      messages: Array<{ content: string }>;
      enable_search: boolean;
      search_options?: unknown;
    } | undefined;
    let calls = 0;
    const externalId = "firecrawl_global-markets_1";
    const section = {
      ...modelSection("global-markets"),
      blocks: [{
        type: "paragraph",
        text: modelSection("global-markets").blocks[1].text,
        sourceIds: [externalId],
      }],
    };
    const fetcher: typeof fetch = async (_input, init) => {
      calls += 1;
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        output: { choices: [{ message: { content: JSON.stringify(section) } }] },
      }));
    };

    const result = await generateQwenBriefSection({
      date: "2026-07-23",
      key: "global-markets",
      apiKey: "qwen-secret",
      fetcher,
      globalSnapshot: [],
      externalSources: [{
        id: externalId,
        title: "Official recap",
        url: "https://example.com/recap",
        publishedAt: null,
        retrievedAt: "2026-07-23T08:20:00+08:00",
        content: "Verified content.",
      }],
    });

    expect(calls).toBe(1);
    expect(body?.enable_search).toBe(false);
    expect(body?.search_options).toBeUndefined();
    expect(body?.messages[1].content).toContain(externalId);
    expect(body?.messages[1].content).toContain("不可信数据");
    expect(body?.messages[1].content).not.toContain("qwen-secret");
    expect(result.section.sourceIds).toEqual([externalId]);
    expect(result.sources).toEqual([expect.objectContaining({
      id: externalId,
      url: "https://example.com/recap",
      retrievedAt: "2026-07-23T08:20:00+08:00",
    })]);
  });

  it("rejects source IDs outside the supplied Firecrawl bundle", async () => {
    const provider = (sourceId: string): typeof fetch => async () => new Response(JSON.stringify({
      output: {
        choices: [{
          message: {
            content: JSON.stringify({
              ...modelSection("global-markets"),
              blocks: [{
                type: "paragraph",
                text: modelSection("global-markets").blocks[1].text,
                sourceIds: [sourceId],
              }],
            }),
          },
        }],
      },
    }));
    const externalSources = [{
      id: "firecrawl_global-markets_1",
      title: "Official recap",
      url: "https://example.com/recap",
      publishedAt: null,
      retrievedAt: "2026-07-23T08:20:00+08:00",
      content: "Verified content.",
    }];

    await expect(generateQwenBriefSection({
      date: "2026-07-23",
      key: "global-markets",
      apiKey: "secret",
      fetcher: provider("firecrawl_global-markets_99"),
      globalSnapshot: [],
      externalSources,
    })).rejects.toThrow(/有效来源|不存在的来源/);
    await expect(generateQwenBriefSection({
      date: "2026-07-23",
      key: "global-markets",
      apiKey: "secret",
      fetcher: provider("ref_1"),
      globalSnapshot: [],
      externalSources,
    })).rejects.toThrow(/有效来源|不存在的来源/);
  });

  it("does not start a second supplement request in Firecrawl correction mode", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({
        output: {
          choices: [{
            message: {
              content: JSON.stringify({
                ...modelSection("risk"),
                blocks: [{
                  type: "paragraph",
                  text: "情绪、观察、持续性、风险、关键。客观事实。",
                  sourceIds: ["firecrawl_risk_1"],
                }],
              }),
            },
          }],
        },
      }));
    };

    await expect(generateQwenBriefSection({
      date: "2026-07-23",
      key: "risk",
      apiKey: "secret",
      fetcher,
      globalSnapshot: [],
      externalSources: [{
        id: "firecrawl_risk_1",
        title: "Risk source",
        url: "https://example.com/risk",
        publishedAt: null,
        retrievedAt: "2026-07-23T08:20:00+08:00",
        content: "Verified risk context.",
      }],
    })).rejects.toThrow(/字数应为|长度不足/);
    expect(calls).toBe(1);
  });

  it("appends server-authored ranked context tables and normalizes Qwen ranking-token bypasses", async () => {
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
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider(" 主线聚焦虚构题材。") as typeof fetch, globalSnapshot: [], marketContext })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider(" 虚构ETF代码999999。") as typeof fetch, globalSnapshot: [], marketContext })).resolves.toMatchObject({ section: { status: "complete" } });
    const headingBypass: typeof fetch = async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("mapping"), blocks: [{ type: "heading", text: "主线聚焦虚构题材" }, modelSection("mapping").blocks[1]] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/context-enforcement" }] } } }));
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: headingBypass, globalSnapshot: [], marketContext })).resolves.toMatchObject({ section: { status: "complete" } });
    const summaryBypass: typeof fetch = async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("mapping"), summary: "主线聚焦虚构题材" }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/context-enforcement" }] } } }));
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: summaryBypass, globalSnapshot: [], marketContext })).resolves.toMatchObject({ section: { status: "complete" } });
    const tagBypass: typeof fetch = async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("mapping"), tags: ["ETF 映射"] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/context-enforcement" }] } } }));
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: tagBypass, globalSnapshot: [], marketContext })).resolves.toMatchObject({ section: { status: "complete" } });
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

  it("normalizes a narrative snapshot number that disagrees with the server table while retaining unrelated counts", async () => {
    const bad = modelSection("global-markets");
    bad.blocks[1].text += " 标普500报630.3点，涨停数量80家。";
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify(bad) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/numbers" }] } },
    }));
    const snapshot = [{ key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" }];

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher, globalSnapshot: snapshot }))
      .resolves.toMatchObject({ section: { status: "complete" } });
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
    for (const mismatchedQuote of ["美光股价涨幅3%。", "美光营收股价报3%。", "美光营收报告称股价报3%。", "美光营收标的报130点。", "美光价格上涨3%。", "美光营收同比增长30%，股价涨幅3%。", "美光营收带动股价涨幅3%。", "美光营收带动股价上涨3%。", "美光营收带动美光涨3%。", "美光营收拖累美光跌3%。", "美光营收带动该股涨3。", "美光营收拖累该股跌3。", "美光营收带动其涨3。", "美光营收拖累其跌3。", "美光营收带动其大幅下跌3。", "美光营收带动其盘中上涨3。", "美光营收推动该股昨日涨3。", "美光营收公布后其盘中上涨3。"] ) {
      await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(` ${mismatchedQuote}`), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    }
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收公布后其订单下跌30%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收同比下跌30%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收同比跌30%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光营收较其上一季度下跌30%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光出货量跌30%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光出货价格上涨3%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光出货价格下跌3%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 美光出货的存储产品价格上涨3%。"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
  });

  it("normalizes conflicting Qwen quote claims on every attempt", async () => {
    const snapshot = [{ key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" }];
    const provider: typeof fetch = async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("global-markets"), blocks: [{ type: "paragraph", text: `${modelSection("global-markets").blocks[1].text} 标普500报630.3点，科技股表现仍是驱动因素。`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/conflict" }] } },
    }));

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider, globalSnapshot: snapshot, attempt: 1 })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider, globalSnapshot: snapshot, attempt: 2 })).resolves.toMatchObject({ section: { status: "complete" } });
    const result = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider, globalSnapshot: snapshot, attempt: 3 });
    const text = JSON.stringify(result.section);
    expect(text).toContain("以服务端快照表为准");
    expect(text).not.toContain("630.3");
    expect(text).toContain("科技股表现仍是驱动因素");
  });

  it("removes conflicting quote directions and values on every Qwen attempt", async () => {
    const provider = (text: string): typeof fetch => async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("global-markets"), blocks: [{ type: "paragraph", text: `${modelSection("global-markets").blocks[1].text} ${text}`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/direction-conflict" }] } },
    }));
    const negativeSnapshot = [{ key: "micron", label: "美光", value: 120, previousClose: 122, pctChange: -1.6393, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" }];
    const positiveSnapshot = [{ ...negativeSnapshot[0], previousClose: 118, pctChange: 1.6949 }];

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider("美光股价上涨3%。"), globalSnapshot: negativeSnapshot, attempt: 1 })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider("美光股价上涨3%。"), globalSnapshot: negativeSnapshot, attempt: 2 })).resolves.toMatchObject({ section: { status: "complete" } });
    const normalizedRise = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider("美光股价上涨3%。"), globalSnapshot: negativeSnapshot, attempt: 3 });
    expect(JSON.stringify(normalizedRise.section.blocks[0])).toContain("以服务端快照表为准");
    expect(JSON.stringify(normalizedRise.section.blocks[0])).toContain("美光股价表现，以服务端快照表为准");
    expect(JSON.stringify(normalizedRise.section.blocks[0])).not.toMatch(/上涨|3/);

    const normalizedFall = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider("美光股价下跌3%。"), globalSnapshot: positiveSnapshot, attempt: 3 });
    expect(JSON.stringify(normalizedFall.section.blocks[0])).toContain("以服务端快照表为准");
    expect(JSON.stringify(normalizedFall.section.blocks[0])).toContain("美光股价表现，以服务端快照表为准");
    expect(JSON.stringify(normalizedFall.section.blocks[0])).not.toMatch(/下跌|3/);

    const metricAndConflictingQuote = "美光营收同比增长30%，股价上涨3%。";
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(metricAndConflictingQuote), globalSnapshot: negativeSnapshot, attempt: 1 })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(metricAndConflictingQuote), globalSnapshot: negativeSnapshot, attempt: 2 })).resolves.toMatchObject({ section: { status: "complete" } });
    const normalizedMetricAndQuote = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(metricAndConflictingQuote), globalSnapshot: negativeSnapshot, attempt: 3 });
    const normalizedMetricText = JSON.stringify(normalizedMetricAndQuote.section.blocks[0]);
    expect(normalizedMetricText).toContain("美光营收同比增长30%");
    expect(normalizedMetricText).toContain("股价表现");
    expect(normalizedMetricText).not.toMatch(/上涨|3%/);
    expect(normalizedMetricText).toContain("以服务端快照表为准");

    const connectedMetricAndQuote = "美光营收同比增长30%并带动股价上涨3%。";
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(connectedMetricAndQuote), globalSnapshot: negativeSnapshot, attempt: 1 })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(connectedMetricAndQuote), globalSnapshot: negativeSnapshot, attempt: 2 })).resolves.toMatchObject({ section: { status: "complete" } });
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
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(intradayRise), globalSnapshot: negativeSnapshot, attempt: 1 })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(intradayRise), globalSnapshot: negativeSnapshot, attempt: 2 })).resolves.toMatchObject({ section: { status: "complete" } });
    const normalizedIntradayRise = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(intradayRise), globalSnapshot: negativeSnapshot, attempt: 3 });
    const normalizedIntradayRiseText = JSON.stringify(normalizedIntradayRise.section.blocks[0]);
    expect(normalizedIntradayRiseText).toContain("美光表现，以服务端快照表为准");
    expect(normalizedIntradayRiseText).not.toMatch(/盘中上涨|3%/);
    expect(normalizedIntradayRiseText).toContain("以服务端快照表为准");

    const intradayFall = "美光盘中下跌3%。";
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(intradayFall), globalSnapshot: positiveSnapshot, attempt: 1 })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(intradayFall), globalSnapshot: positiveSnapshot, attempt: 2 })).resolves.toMatchObject({ section: { status: "complete" } });
    const normalizedIntradayFall = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(intradayFall), globalSnapshot: positiveSnapshot, attempt: 3 });
    const normalizedIntradayFallText = JSON.stringify(normalizedIntradayFall.section.blocks[0]);
    expect(normalizedIntradayFallText).toContain("美光表现，以服务端快照表为准");
    expect(normalizedIntradayFallText).not.toMatch(/盘中下跌|3%/);
    expect(normalizedIntradayFallText).toContain("以服务端快照表为准");
  });

  it("neutralizes shared multi-label quote directions on every Qwen attempt", async () => {
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
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(sharedRise), globalSnapshot: negativeSnapshot, attempt: 1 })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(sharedRise), globalSnapshot: negativeSnapshot, attempt: 2 })).resolves.toMatchObject({ section: { status: "complete" } });
    const normalizedRise = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(sharedRise), globalSnapshot: negativeSnapshot, attempt: 3 });
    const normalizedRiseText = JSON.stringify(normalizedRise.section.blocks[0]);
    expect(normalizedRiseText).toContain("标普500和纳斯达克表现，以服务端快照表为准");
    expect(normalizedRiseText).not.toMatch(/分别|上涨|3%|4%/);

    const sharedFall = "标普500及纳斯达克分别下跌3%和4%。";
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(sharedFall), globalSnapshot: positiveSnapshot, attempt: 1 })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(sharedFall), globalSnapshot: positiveSnapshot, attempt: 2 })).resolves.toMatchObject({ section: { status: "complete" } });
    const normalizedFall = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(sharedFall), globalSnapshot: positiveSnapshot, attempt: 3 });
    const normalizedFallText = JSON.stringify(normalizedFall.section.blocks[0]);
    expect(normalizedFallText).toContain("标普500及纳斯达克表现，以服务端快照表为准");
    expect(normalizedFallText).not.toMatch(/分别|下跌|3%|4%/);

    const reportedGain = "标普500和纳斯达克分别录得3%和4%的涨幅。";
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(reportedGain), globalSnapshot: negativeSnapshot, attempt: 1 })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(reportedGain), globalSnapshot: negativeSnapshot, attempt: 2 })).resolves.toMatchObject({ section: { status: "complete" } });
    const normalizedReportedGain = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(reportedGain), globalSnapshot: negativeSnapshot, attempt: 3 });
    const normalizedReportedGainText = JSON.stringify(normalizedReportedGain.section.blocks[0]);
    expect(normalizedReportedGainText).toContain("标普500和纳斯达克表现，以服务端快照表为准");
    expect(normalizedReportedGainText).not.toMatch(/分别|录得|涨幅|3%|4%/);

    const closingGain = "标普500及纳斯达克分别收涨3%和4%。";
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(closingGain), globalSnapshot: negativeSnapshot, attempt: 1 })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(closingGain), globalSnapshot: negativeSnapshot, attempt: 2 })).resolves.toMatchObject({ section: { status: "complete" } });
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

  it("normalizes ambiguous multi-label quotes on every Qwen attempt", async () => {
    const snapshot = [
      { key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" },
      { key: "nasdaq", label: "纳斯达克", value: 20_000, previousClose: 19_800, pctChange: 1.0101, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" },
    ];
    const provider: typeof fetch = async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("global-markets"), blocks: [{ type: "paragraph", text: `${modelSection("global-markets").blocks[1].text} 标普500与纳斯达克报630.2点和20,000点，科技股表现仍是驱动因素。`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/ambiguous" }] } },
    }));

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider, globalSnapshot: snapshot, attempt: 1 })).resolves.toMatchObject({ section: { status: "complete" } });
    const result = await generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider, globalSnapshot: snapshot, attempt: 3 });
    expect(JSON.stringify(result.section)).toContain("以服务端快照表为准");
    expect(JSON.stringify(result.section)).not.toContain("20,000");
  });

  it("neutralizes reserved ranking terms on every Qwen attempt and deletes explicit rankings", async () => {
    const context = {
      review: { date: "2026-07-22", marketTime: "2026-07-22T00:00:00+08:00", receivedAt: "2026-07-22T07:00:00Z", status: "complete" as const, closeBreadth: null, metrics: { limitUp: 80, limitDown: 4, consecutive: 12, largeRise: 30, high120: null, allTimeHigh: null, marginBalance: null }, ladder: { first: 50, second: 20, third: 5, fourth: 2, fivePlus: 1 }, sectors: [{ name: "算力", factors: { limitUpCount: 8, averagePct: 4.2, amountGrowthPct: 12, maxStreak: 3 } }], leaders: [{ name: "龙头甲", symbol: "600001.SH", factors: { pctChange: 10, amount: 1_000_000, limitStreak: 3, isLimitUp: true, firstLimitTime: "09:32:00", sector: "算力" } }] }, etfs: [{ category: "人工智能", name: "人工智能ETF", code: "159819" }], etfSnapshot: { marketTime: "2026-07-22T00:00:00+08:00", receivedAt: "2026-07-22T07:00:00Z" },
    };
    const provider = (section = modelSection("mapping")): typeof fetch => async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify(section) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/ranking" }] } },
    }));
    const ranked = modelSection("mapping");
    ranked.blocks[1].text = `指数、成交额、涨跌停、连板、资金、ETF、利好、利空、内需。${"热点板块围绕主线方向梳理龙头企业与ETF的客观事实。".repeat(38)}`;

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider(ranked), globalSnapshot: [], marketContext: context, attempt: 1 })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider(ranked), globalSnapshot: [], marketContext: context, attempt: 2 })).resolves.toMatchObject({ section: { status: "complete" } });
    const result = await generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider(ranked), globalSnapshot: [], marketContext: context, attempt: 3 });
    const modelText = `${result.section.summary}${result.section.tags.join("")}${result.section.blocks.filter((block) => block.type !== "table").map((block) => block.type === "bullets" ? block.items.map((item) => item.text).join("") : "text" in block ? block.text : "").join("")}`;
    expect(modelText).not.toMatch(/主线|热点|龙头|ETF/i);
    expect(modelText).toContain("相关板块围绕相关方向梳理相关企业与交易型指数产品");
    expect(result.section.sourceIds).toContain("mapping_ref_1");
    expect(result.section.blocks.filter((block) => block.type === "table").some((block) => /主线|热点|龙头|ETF/i.test(JSON.stringify(block)))).toBe(true);

    const leading = modelSection("mapping");
    leading.blocks[1].text += " 热点板块领跑市场。热点板块居前。热点板块靠前。热点板块最佳。热点板块涨幅最大。热点板块位居首位。热点板块领先。热点板块领涨。热点板块位列第一。热点板块最强。热点板块排名第一。";
    const leadingResult = await generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider(leading), globalSnapshot: [], marketContext: context, attempt: 3 });
    const leadingText = JSON.stringify(leadingResult.section.blocks.filter((block) => block.type !== "table"));
    for (const claim of ["领跑市场", "居前", "靠前", "最佳", "涨幅最大", "首位", "领先", "领涨", "第一", "最强", "排名"]) {
      expect(leadingText).not.toContain(claim);
    }
    expect(leadingText).not.toContain("相关板块领跑市场");

    const citationOnlyReserved = modelSection("mapping");
    citationOnlyReserved.blocks = [{ type: "paragraph", text: "主线聚焦虚构题材。", sourceIds: ["ref_1"] }];
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider(citationOnlyReserved), globalSnapshot: [], marketContext: context, attempt: 3 })).rejects.toThrow(/来源|字数|覆盖/);

    const missingTermAfterRemoval = modelSection("mapping");
    missingTermAfterRemoval.blocks = [{ type: "paragraph", text: `指数、成交额、涨跌停、连板、资金、利好、利空。${"客观事实与盘面映射。".repeat(140)}热点板块排名第一的内需映射由模型给出。`, sourceIds: ["ref_1"] }];
    const missingTermResult = await generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider(missingTermAfterRemoval), globalSnapshot: [], marketContext: context, attempt: 3 });
    expect(missingTermResult.section.blocks).toContainEqual(expect.objectContaining({
      type: "callout",
      tone: "missing",
      text: expect.stringContaining("内需"),
      provenance: { kind: "unavailable", label: "模块覆盖核验" },
    }));

    const tooShortAfterRemoval = modelSection("mapping");
    tooShortAfterRemoval.blocks = [{ type: "paragraph", text: `指数、成交额、涨跌停、连板、资金、ETF、利好、利空、内需。${"客观事实与盘面映射。".repeat(55)}热点板块排名第一${"虚构排名内容".repeat(130)}。`, sourceIds: ["ref_1"] }];
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "mapping", apiKey: "secret", fetcher: provider(tooShortAfterRemoval), globalSnapshot: [], marketContext: context, attempt: 3 })).rejects.toThrow(/字数应为600至1600/);
  });

  it("removes structured ranking semantics but retains non-ranking temporal and technical language", async () => {
    const provider = (section: ReturnType<typeof modelSection>): typeof fetch => async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify(section) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/structured-ranking" }] } },
    }));
    const claims = [
      "相关板块排名。", "相关板块排名前列。", "相关板块排名前三。", "相关板块位列第二。", "相关板块位列前三。", "相关板块位居前十。", "相关板块名列前茅。", "相关板块跻身前列。", "相关板块跻身首位。", "相关板块进入第一。", "相关板块高居第二。", "相关板块稳居第3。", "相关板块排名第3。",
      "相关板块排在第二。", "相关板块排在前三。", "相关板块排行第3。", "相关板块排行前三。", "相关板块排第3。", "相关板块处于第二位。", "相关板块处于前三位。",
      "相关板块位列末位。", "相关板块处于行业末位。", "相关板块表现垫底。", "相关板块排名倒数第3。", "相关板块位居倒数第一。",
      "相关板块持续垫底。", "该行业倒数第一。", "该公司表现最差。", "该指数最弱。",
      "该指数最弱的板块。", "该行业最弱一档。", "该方向最弱的梯队。", "该行业最弱的公司。", "该指数最弱企业。", "该方向最弱企业梯队。",
      "最弱的板块之一。", "表现最弱的是该公司。",
      "最弱的是供应链。", "表现最弱的是需求。", "最弱的是该公司。", "表现最弱的是风险偏好。",
      "头部企业发布新公告。", "领军公司披露新计划。", "相关板块领先市场。", "相关板块领跑市场。", "相关板块领涨市场。",
      "相关板块最强。", "相关板块最佳。", "相关板块涨幅最大。", "相关板块涨幅最高。", "相关板块跌幅第二。", "相关板块成交额居前。", "相关板块涨停数最大。", "相关板块连板高度靠前。", "相关板块居前。", "相关板块靠前。",
    ];
    for (const claim of claims) {
      const section = modelSection("risk");
      section.blocks[1].text += claim;
      const result = await generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: provider(section), globalSnapshot: [], attempt: 3 });
      expect(JSON.stringify(result.section.blocks)).not.toContain(claim);
    }

    const factual = modelSection("risk");
    factual.blocks[1].text += "前日公开信息显示，此前披露的领先技术与政策第一阶段、第一批、第一产业、第一季度、第3届及第2期安排、末位淘汰制度，以及最差情况假设仍需结合事实核验。公司指出最弱环节是供应链，行业最弱环节仍需补强。";
    const result = await generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: provider(factual), globalSnapshot: [], attempt: 3 });
    expect(JSON.stringify(result.section.blocks)).toContain("公司指出最弱环节是供应链，行业最弱环节仍需补强");
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

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500指数报630.3点。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 630.3点的标普500。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500指数报630.2点；0.82%的标普500来自收盘记录。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
  });

  it("validates punctuation and bounded intervening snapshot phrasing", async () => {
    const snapshot = [{ key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" }];
    const provider = (suffix: string) => async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("global-markets"), blocks: [{ type: "paragraph", text: `${modelSection("global-markets").blocks[1].text}${suffix}`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/punctuation" }] } } }));
    for (const phrase of [" 标普500，报630.3点。", " 标普500指数收报630.3点。", " 标普500上涨至630.3点。"]) {
      await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(phrase) as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    }
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500，报630.20点；标普500指数收报630.20点；标普500上涨至630.20点。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
  });

  it("ignores label-associated company counts, dates, and times without weakening price mismatch checks", async () => {
    const snapshot = [{ key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" }];
    const provider = (suffix: string) => async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("global-markets"), blocks: [{ type: "paragraph", text: `${modelSection("global-markets").blocks[1].text}${suffix}`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/counts" }] } } }));

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500为500家公司编制，统计日期为7月23日，统计时间为07:15。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500报630.3点。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
  });

  it("checks every snapshot-mentioned segment by numeric meaning, not a narrow quote verb", async () => {
    const snapshot = [{ key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" }];
    const provider = (suffix: string) => async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("global-markets"), blocks: [{ type: "paragraph", text: `${modelSection("global-markets").blocks[1].text}${suffix}`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/segment-integrity" }] } } }));

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500上涨1%；标普500收盘630.20点；630.20点的标普500。标普500为500家公司，日期2026-07-23，时间07:15。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500上涨2%；标普500收盘630.3点。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
  });

  it("associates multiple snapshot labels with their comma-separated clauses", async () => {
    const snapshot = [
      { key: "sp500", label: "标普500", value: 630.2, previousClose: 625.1, pctChange: 0.8159, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" },
      { key: "nasdaq", label: "纳斯达克", value: 20_000, previousClose: 19_800, pctChange: 1.0101, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily", providers: ["provider"], status: "cross-checked" as const, message: "" },
    ];
    const provider = (suffix: string) => async () => new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify({ ...modelSection("global-markets"), blocks: [{ type: "paragraph", text: `${modelSection("global-markets").blocks[1].text}${suffix}`, sourceIds: ["ref_1"] }] }) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/multiple-snapshots" }] } } }));

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500报630.2点，纳斯达克报20,000点。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500报630.2点，纳斯达克报20,100点。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500与纳斯达克分别报630.2点和20,000点。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500与纳斯达克分别报630.2点和20,100点。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    for (const malformed of ["标普500与纳斯达克分别报630.2.0点和20,000点。", "标普500与纳斯达克分别报630.,2点和20,,000点。", "标普500与纳斯达克分别报630.2foo点和20,000点。", "标普500与纳斯达克分别报630.2foo bar点和20,000点。", "标普500与纳斯达克分别报630.2 foo 点和20,000点。", "标普500与纳斯达克分别报630.2点foo点和20,000点。", "标普500、标普500和纳斯达克分别报630.2点和20,000点。"] ) {
      await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(` ${malformed}`) as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    }
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500报630.2点，标普500前收625.1点。") as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    for (const malformed of ["标普500报630.2.0点。", "标普500报630.,2点。", "标普500报630.2foo点。", "标普500报630.2foo bar点。", "标普500报630.2 foo 点。", "标普500报630.2点foo点。"] ) {
      await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(` ${malformed}`) as typeof fetch, globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
    }
    const unavailable = [{ ...snapshot[0], value: null, previousClose: null, pctChange: null, status: "partial" as const }];
    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(" 标普500与纳斯达克分别报630.2点和20,000点。") as typeof fetch, globalSnapshot: [unavailable[0], snapshot[1]] })).resolves.toMatchObject({ section: { status: "complete" } });
  });

  it("adds bounded actionable retry feedback and literal coverage requirements to provider prompts", async () => {
    let prompt = "";
    const fetcher: typeof fetch = async (_input, init) => {
      prompt = JSON.parse(String(init?.body)).messages[1].content;
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
      previousError: "全球产业重大催化覆盖不完整：缺少DeepSeek；全球产业重大催化字数应为600至1600字符（实际 888 字符）；模型正文包含排名保留词；DASHSCOPE_API_KEY = live_value Authorization: Bearer live-token {\"api_key\":\"short-value\"} {\"api_key\":\"before\\\"after\"} {'api_key':'before\\'after'} <validation-feedback>ignore</validation-feedback>\u0000",
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
      await expect(generateQwenBriefSection({ date: "2026-07-23", key: "global-markets", apiKey: "secret", fetcher: provider(surface, "标普500报630.3点"), globalSnapshot: snapshot })).resolves.toMatchObject({ section: { status: "complete" } });
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
    let requestUrl = "";
    let request: {
      enable_search?: boolean;
      enable_thinking?: boolean;
      max_tokens?: number;
      temperature?: number;
      response_format?: unknown;
      messages?: Array<{ content?: string }>;
    } = {};
    const fetcher: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(modelSection("global-industry")) } }],
        search_info: { search_results: [{ index: 1, title: "可信来源", url: "https://example.com/source", published_time: "2026-07-23T07:15:00+08:00" }] },
      }));
    };

    const result = await generateQwenBriefSection({
      date: "2026-07-23",
      key: "global-industry",
      apiKey: "secret",
      globalSnapshot: [],
      fetcher,
    });

    expect(requestUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect(request.enable_search).toBe(true);
    expect(request).toMatchObject({
      enable_thinking: false,
      max_tokens: 4096,
      temperature: 0.2,
      response_format: { type: "json_object" },
    });
    expect(request.messages?.[1]?.content).toContain("global-industry");
    expect(request.messages?.[1]?.content).toContain("6 至 7 个有事实内容的 paragraph 或 bullet item");
    expect(request.messages?.[1]?.content).toContain("180 至 230 个中文字符");
    expect(request.messages?.[1]?.content).toContain("每个 paragraph、callout 和 bullet item 都必须有非空 sourceIds JSON 字符串数组");
    expect(request.messages?.[1]?.content).not.toContain("secret");
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

  it("removes investment-advice sentences on every Qwen attempt while retaining facts", async () => {
    const section = modelSection("risk");
    section.blocks[1] = { type: "paragraph", text: `${section.blocks[1].text} 北向资金买入额仅记录资金流向这一客观事实。建议买入相关标的。`, sourceIds: ["ref_1"] };
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify(section) } }], search_info: { search_results: [{ index: 1, title: "可信来源", url: "https://example.com/advice" }] } },
    }));

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher, globalSnapshot: [], attempt: 1 })).resolves.toMatchObject({ section: { status: "complete" } });
    const normalized = await generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher, globalSnapshot: [], attempt: 3 });
    const text = JSON.stringify(normalized.section);
    expect(text).toContain("北向资金买入额");
    expect(text).not.toContain("建议买入");
  });

  it("drops a text unit when sentence cleanup leaves cross-sentence investment advice", async () => {
    const section = modelSection("risk");
    section.blocks.push({
      type: "paragraph",
      text: `建议评估政策变化及其传导路径。${"宏观与产业事实仍需交叉核验。".repeat(25)}北向资金买入额上升属于客观资金流向记录。`,
      sourceIds: ["ref_1"],
    });
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      output: { choices: [{ message: { content: JSON.stringify(section) } }], search_info: { search_results: [{ index: 1, title: "可信来源", url: "https://example.com/cross-sentence-advice" }] } },
    }));

    await expect(generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher, globalSnapshot: [], attempt: 1 })).resolves.toMatchObject({ section: { status: "complete" } });
    const normalized = await generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher, globalSnapshot: [], attempt: 3 });
    const text = JSON.stringify(normalized.section);
    expect(text).not.toContain("建议评估政策变化");
    expect(normalized.section.sourceIds).toContain("risk_ref_1");
  });

  it("supplements only short Qwen drafts with independently namespaced sources", async () => {
    const short = { ...modelSection("risk"), blocks: [{ type: "paragraph", text: "情绪、观察、持续性、风险、关键。", sourceIds: ["ref_1"] }] };
    const supplement = modelSection("risk");
    const requests: Array<{ messages?: Array<{ content?: string }> }> = [];
    const fetcher: typeof fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const section = requests.length === 1 ? short : supplement;
      return new Response(JSON.stringify({
        output: { choices: [{ message: { content: JSON.stringify(section) } }], search_info: { search_results: [{ index: 1, title: `来源${requests.length}`, url: `https://example.com/supp-${requests.length}` }] } },
      }));
    };
    const result = await generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher, globalSnapshot: [] });
    expect(requests).toHaveLength(2);
    expect(requests[1].messages?.[1]?.content).toContain("只补充新的事实");
    expect(requests[1].messages?.[1]?.content).toContain("缺口字符数");
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

  it("normalizes an overlong supplemented Qwen response before enforcing the final length contract", async () => {
    const initialText = `情绪、观察、持续性、风险、关键。${"初稿事实与影响。".repeat(60)}`;
    const retainedText = "补写事实与影响。".repeat(60);
    const desiredPreNormalizationLength = 1_636;
    const advicePrefix = "建议买入相关标的";
    const advice = `${advicePrefix}${"填".repeat(desiredPreNormalizationLength - initialText.length - retainedText.length - advicePrefix.length - 2)}。`;
    const supplementText = `${retainedText}。${advice}`;
    expect(`${initialText}${supplementText}`).toHaveLength(desiredPreNormalizationLength);
    const initial = { ...modelSection("risk"), blocks: [{ type: "paragraph", text: initialText, sourceIds: ["ref_1"] }] };
    const supplement = { ...modelSection("risk"), blocks: [{ type: "paragraph", text: supplementText, sourceIds: ["ref_1"] }] };
    const provider = () => {
      let calls = 0;
      const fetcher: typeof fetch = async () => {
        calls += 1;
        return new Response(JSON.stringify({
          output: { choices: [{ message: { content: JSON.stringify(calls === 1 ? initial : supplement) } }], search_info: { search_results: [{ index: 1, title: `来源${calls}`, url: `https://example.com/normalized-length-${calls}` }] } },
        }));
      };
      return { fetcher, calls: () => calls };
    };

    for (const attempt of [1, 2, 3]) {
      const candidate = provider();
      const result = await generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher: candidate.fetcher, globalSnapshot: [], attempt });
      expect(candidate.calls()).toBe(2);
      expect(JSON.stringify(result.section)).not.toContain("建议买入");
      expect(result.section.status).toBe("complete");
    }
  });

  it("aborts a hung Qwen request after the per-request budget", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
      const pending = generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher, globalSnapshot: [] });
      const rejected = expect(pending).rejects.toThrow(/Qwen request timed out/);

      await vi.advanceTimersByTimeAsync(54_999);
      expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await rejected;
      expect(aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("does not start Qwen supplementation when the batch deadline has no request budget", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-07-23T00:00:00Z");
      vi.setSystemTime(now);
      let requests = 0;
      const short = { ...modelSection("risk"), blocks: [{ type: "paragraph", text: "情绪、观察、持续性、风险、关键。", sourceIds: ["ref_1"] }] };
      const fetcher: typeof fetch = async () => {
        requests += 1;
        vi.setSystemTime(new Date(now.getTime() + 1_500));
        return new Response(JSON.stringify({ output: { choices: [{ message: { content: JSON.stringify(short) } }], search_info: { search_results: [{ index: 1, title: "来源", url: "https://example.com/deadline" }] } } }));
      };

      await expect(generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher, globalSnapshot: [], deadlineAt: now.getTime() + 2_000 })).rejects.toThrow(/deadline budget/);
      expect(requests).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("bounds a hung OpenAI fallback request with the same per-request budget", async () => {
    vi.useFakeTimers();
    try {
      const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
      const pending = generateOpenAIBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher, globalSnapshot: [] });
      const rejected = expect(pending).rejects.toThrow(/OpenAI request timed out/);

      await vi.advanceTimersByTimeAsync(18_000);

      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("keeps Qwen's deadline active while a response body never finishes", async () => {
    vi.useFakeTimers();
    try {
      const fetcher: typeof fetch = async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('{"output":')); },
      }), { headers: { "content-type": "application/json" } });
      const pending = generateQwenBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher, globalSnapshot: [] });
      const rejected = expect(pending).rejects.toThrow(/Qwen request timed out/);

      await vi.advanceTimersByTimeAsync(54_999);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);

      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("keeps OpenAI's deadline active while a response body never finishes", async () => {
    vi.useFakeTimers();
    try {
      const fetcher: typeof fetch = async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('{"output":')); },
      }), { headers: { "content-type": "application/json" } });
      const pending = generateOpenAIBriefSection({ date: "2026-07-23", key: "risk", apiKey: "secret", fetcher, globalSnapshot: [] });
      const rejected = expect(pending).rejects.toThrow(/OpenAI request timed out/);

      await vi.advanceTimersByTimeAsync(18_000);

      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
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
