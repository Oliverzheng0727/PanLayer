import type { ReconciledGlobalPoint } from "../data/global/types";

export interface BriefSource {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
}

export interface BriefItem {
  text: string;
  sourceIds: string[];
}

export interface MorningBrief {
  date: string;
  sections: Array<{ title: string; items: BriefItem[] }>;
  sources: BriefSource[];
  disclaimer: string;
}

export function resolveBriefSources(brief: MorningBrief, item: BriefItem): BriefSource[] {
  const byId = new Map(brief.sources.map((source) => [source.id, source]));
  const seen = new Set<string>();
  return item.sourceIds.flatMap((id) => {
    const source = byId.get(id);
    if (!source || seen.has(id)) return [];
    seen.add(id);
    return [source];
  });
}

const REQUIRED_SECTIONS = [
  "全球外围市场全景",
  "全球产业重大催化",
  "国内隔夜重磅信息",
  "板块利好、利空与内需映射",
  "盘前情绪、观察方向与风险",
];

const RECOMMENDATION_LANGUAGE = /建议(买入|卖出|加仓|减仓)|买点|卖点|仓位建议|收益承诺/;

export const QWEN_MORNING_BRIEF_MODEL = "qwen-plus";
export const DASHSCOPE_GENERATION_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation";

export function validateMorningBrief(input: MorningBrief): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const titles = input.sections.map((section) => section.title);
  REQUIRED_SECTIONS.forEach((title) => {
    if (!titles.includes(title)) errors.push(`缺少模块：${title}`);
  });
  const sourceIds = new Set(input.sources.map((source) => source.id));
  input.sections.forEach((section) => section.items.forEach((item) => {
    if (item.sourceIds.length === 0 || item.sourceIds.some((id) => !sourceIds.has(id))) {
      errors.push(`${section.title}存在缺少来源的内容`);
    }
    if (RECOMMENDATION_LANGUAGE.test(item.text)) errors.push(`${section.title}包含投资建议语言`);
  }));
  if (!input.disclaimer.includes("不构成投资建议")) errors.push("缺少投资建议免责声明");
  return { ok: errors.length === 0, errors };
}

const morningBriefSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    date: { type: "string" },
    sections: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", enum: REQUIRED_SECTIONS },
          items: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              properties: { text: { type: "string" }, sourceIds: { type: "array", minItems: 1, items: { type: "string" } } },
              required: ["text", "sourceIds"],
            },
          },
        },
        required: ["title", "items"],
      },
    },
    sources: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" }, title: { type: "string" }, url: { type: "string" }, publishedAt: { type: "string" },
        },
        required: ["id", "title", "url", "publishedAt"],
      },
    },
    disclaimer: { type: "string" },
  },
  required: ["date", "sections", "sources", "disclaimer"],
};

export async function generateMorningBrief({
  date,
  apiKey,
  fetcher = fetch,
  globalSnapshot = [],
}: {
  date: string;
  apiKey: string;
  fetcher?: typeof fetch;
  globalSnapshot?: ReconciledGlobalPoint[];
}): Promise<MorningBrief> {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const numericContext = JSON.stringify(globalSnapshot);
  const prompt = `生成 ${date} 北京时间 07:15 的A股隔夜早参。主动检索从上一交易日收盘至当前的全球与国内可靠来源。

以下是服务端行情适配层已校验的全球数值快照：${numericContext}
指数、股票、汇率、利率和商品的数值只能使用以上结构化快照。status 为 partial、failed 或 unconfigured 时必须明确说明数据未完成交叉校验或暂缺，不得从网页搜索结果另行猜测数值。

严格输出五个固定模块：全球外围市场全景；全球产业重大催化；国内隔夜重磅信息；板块利好、利空与内需映射；盘前情绪、观察方向与风险。
逐项覆盖美股三大指数、费城半导体、英伟达/美光、中概/A50、人民币、美债、原油黄金工业金属、地缘与美联储；重点拆解 Kimi、DeepSeek、GPT、存储芯片、人形机器人、算力/光模块、钠离子电池，并兼顾新能源车、医药与前沿技术；覆盖国内政策、公告、流动性与风险。

每个事实必须引用 sources 中的真实网页；不确定时写“未查到可靠更新”。只做客观梳理，不得推荐个股，不给买卖、仓位或收益建议。`;
  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      reasoning: { effort: "medium" },
      tools: [{ type: "web_search", search_context_size: "medium" }],
      include: ["web_search_call.action.sources"],
      input: prompt,
      text: {
        verbosity: "high",
        format: { type: "json_schema", name: "panlayer_morning_brief", strict: true, schema: morningBriefSchema },
      },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI Responses API ${response.status}`);
  const payload = await response.json() as { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
  const text = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI response did not include structured output text");
  const brief = JSON.parse(text) as MorningBrief;
  const validation = validateMorningBrief(brief);
  if (!validation.ok) throw new Error(`Morning brief validation failed: ${validation.errors.join("; ")}`);
  return brief;
}

interface QwenSearchResult {
  index?: number;
  title?: string;
  url?: string;
  published_time?: string;
  publish_time?: string;
  published_at?: string;
}

interface QwenGenerationPayload {
  output?: {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    search_info?: { search_results?: QwenSearchResult[] };
  };
  code?: string;
  message?: string;
}

function buildMorningBriefPrompt(date: string, globalSnapshot: ReconciledGlobalPoint[]): string {
  const numericContext = JSON.stringify(globalSnapshot);
  return `生成 ${date} 北京时间 07:15 的A股隔夜早参。主动检索从上一交易日收盘至当前的全球与国内可靠来源。

以下是服务端行情适配层已校验的全球数值快照：${numericContext}
指数、股票、汇率、利率和商品的数值只能使用以上结构化快照。status 为 partial、failed 或 unconfigured 时必须明确说明数据未完成交叉校验或暂缺，不得从网页搜索结果另行猜测数值。

严格输出五个固定模块：全球外围市场全景；全球产业重大催化；国内隔夜重磅信息；板块利好、利空与内需映射；盘前情绪、观察方向与风险。
逐项覆盖美股三大指数、费城半导体、英伟达/美光、中概/A50、人民币、美债、原油黄金工业金属、地缘与美联储；重点拆解 Kimi、DeepSeek、GPT、存储芯片、人形机器人、算力/光模块、钠离子电池，并兼顾新能源车、医药与前沿技术；覆盖国内政策、公告、流动性与风险。

仅返回合法 JSON 对象，不要 Markdown 代码块。结构必须是：
{"date":"YYYY-MM-DD","sections":[{"title":"固定模块名","items":[{"text":"客观事实与影响解读","sourceIds":["ref_1"]}]}],"sources":[],"disclaimer":"只做客观市场复盘，不构成投资建议。"}
搜索引用统一使用 ref_1、ref_2 这样的编号，并写入对应事实的 sourceIds；编号必须来自联网搜索返回结果。每个事实至少一个来源；不确定时写“未查到可靠更新”并引用说明检索背景的可靠来源。不得虚构 URL，sources 数组由服务端根据搜索结果覆盖。
只做客观梳理，不得推荐个股，不给买卖、仓位或收益建议。`;
}

export async function generateQwenMorningBrief({
  date,
  apiKey,
  fetcher = fetch,
  globalSnapshot = [],
  endpoint = DASHSCOPE_GENERATION_URL,
}: {
  date: string;
  apiKey: string;
  fetcher?: typeof fetch;
  globalSnapshot?: ReconciledGlobalPoint[];
  endpoint?: string;
}): Promise<MorningBrief> {
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY is not configured");
  const prompt = buildMorningBriefPrompt(date, globalSnapshot);
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: QWEN_MORNING_BRIEF_MODEL,
      input: {
        messages: [
          { role: "system", content: "你是盘层的财经早参编辑。所有输出必须是可解析的 JSON，并严格遵守来源与非荐股约束。" },
          { role: "user", content: prompt },
        ],
      },
      parameters: {
        result_format: "message",
        response_format: { type: "json_object" },
        enable_thinking: false,
        enable_search: true,
        search_options: {
          search_strategy: "turbo",
          forced_search: true,
          enable_source: true,
          enable_citation: true,
          citation_format: "[ref_<number>]",
          freshness: 7,
        },
      },
    }),
  });
  const payload = await response.json() as QwenGenerationPayload;
  if (!response.ok) {
    const detail = payload.message || payload.code || `HTTP ${response.status}`;
    throw new Error(`DashScope Generation API ${detail}`);
  }
  const text = payload.output?.choices?.[0]?.message?.content;
  if (!text) throw new Error("DashScope response did not include structured output text");
  const brief = JSON.parse(text) as MorningBrief;
  const generatedSources = new Map((brief.sources ?? []).map((source) => [source.url, source]));
  brief.sources = (payload.output?.search_info?.search_results ?? [])
    .filter((source): source is QwenSearchResult & { index: number; title: string; url: string } =>
      Number.isFinite(source.index) && Boolean(source.title) && Boolean(source.url))
    .map((source) => ({
      id: `ref_${source.index}`,
      title: source.title,
      url: source.url,
      publishedAt: source.published_time ?? source.publish_time ?? source.published_at ?? generatedSources.get(source.url)?.publishedAt ?? "",
    }));
  const validation = validateMorningBrief(brief);
  if (!validation.ok) throw new Error(`Morning brief validation failed: ${validation.errors.join("; ")}`);
  return brief;
}
