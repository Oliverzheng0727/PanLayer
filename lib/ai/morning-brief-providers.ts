import type { ReconciledGlobalPoint } from "../data/global/types";
import {
  BRIEF_SECTION_DEFINITIONS,
  type BriefBlock,
  type BriefSection,
  type BriefSectionKey,
  type BriefSource,
  validateBriefSection,
} from "./morning-brief-contract";

export interface GeneratedBriefSection {
  section: BriefSection;
  sources: BriefSource[];
}

export type BriefSectionGenerator = (input: {
  date: string;
  key: BriefSectionKey;
  globalSnapshot: ReconciledGlobalPoint[];
}) => Promise<GeneratedBriefSection>;

export interface ProviderSectionInput {
  date: string;
  key: BriefSectionKey;
  apiKey: string;
  globalSnapshot: ReconciledGlobalPoint[];
  fetcher?: typeof fetch;
  endpoint?: string;
}

export const QWEN_BRIEF_SECTION_MODEL = "qwen-plus";
export const DASHSCOPE_SECTION_GENERATION_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation";
export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

type ProviderSearchResult = {
  index?: number;
  title?: string;
  url?: string;
  published_time?: string;
  publish_time?: string;
  published_at?: string;
  publishedAt?: string;
};

type ParsedSection = Omit<BriefSection, "status" | "generatedAt" | "sourceIds">;

const SECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    key: { type: "string", enum: BRIEF_SECTION_DEFINITIONS.map((definition) => definition.key) },
    title: { type: "string" },
    summary: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    blocks: {
      type: "array",
      minItems: 1,
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: { type: { const: "heading" }, text: { type: "string" } },
            required: ["type", "text"],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { const: "paragraph" },
              text: { type: "string" },
              sourceIds: { type: "array", items: { type: "string" } },
            },
            required: ["type", "text", "sourceIds"],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { const: "bullets" },
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    text: { type: "string" },
                    sourceIds: { type: "array", items: { type: "string" } },
                  },
                  required: ["text", "sourceIds"],
                },
              },
            },
            required: ["type", "items"],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { const: "callout" },
              tone: { type: "string", enum: ["insight", "risk", "missing"] },
              text: { type: "string" },
              sourceIds: { type: "array", items: { type: "string" } },
            },
            required: ["type", "tone", "text", "sourceIds"],
          },
        ],
      },
    },
  },
  required: ["key", "title", "summary", "tags", "blocks"],
} as const;

function strictSectionSchema(key: BriefSectionKey) {
  const definition = BRIEF_SECTION_DEFINITIONS.find((item) => item.key === key);
  if (!definition) throw new Error(`Unknown brief section key: ${key}`);
  return {
    ...SECTION_SCHEMA,
    properties: {
      ...SECTION_SCHEMA.properties,
      key: { type: "string", const: key },
      title: { type: "string", const: definition.title },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function beijingTimestamp(value: Date): string {
  const fields = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value).reduce<Record<string, string>>((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}:${fields.second}+08:00`;
}

function asBeijingMarketTime(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00+08:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\+08:00$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : beijingTimestamp(date);
}

function snapshotBlocks(key: BriefSectionKey, globalSnapshot: ReconciledGlobalPoint[]): BriefBlock[] {
  if (key !== "global-markets") return [];
  return globalSnapshot.flatMap((point) => {
    const marketTime = asBeijingMarketTime(point.marketTime);
    if (!marketTime) return [];
    return [{
      type: "table" as const,
      columns: ["标的", "数值", "前收", "涨跌幅", "状态"],
      rows: [[
        point.label,
        point.value === null ? "暂缺" : String(point.value),
        point.previousClose === null ? "暂缺" : String(point.previousClose),
        point.pctChange === null ? "暂缺" : String(point.pctChange),
        point.status,
      ]],
      sourceIds: [],
      provenance: {
        kind: "snapshot" as const,
        label: point.label,
        marketTime,
        providers: [...point.providers],
        receivedAt: point.receivedAt,
      },
    }];
  });
}

function promptForSection(date: string, key: BriefSectionKey, globalSnapshot: ReconciledGlobalPoint[]): string {
  const definition = BRIEF_SECTION_DEFINITIONS.find((item) => item.key === key);
  if (!definition) throw new Error(`Unknown brief section key: ${key}`);
  return `生成 ${date} 北京时间 07:15 的A股隔夜早参模块。只生成一个模块，key 必须为 "${key}"，标题必须为 "${definition.title}"。

本模块必须逐项覆盖：${definition.requiredTerms.join("、")}。正文内容长度（仅内容块文字）必须为 1000 至 1600 个字符。
主动检索从上一交易日收盘至当前的可靠来源。每条事实、解读和风险说明均须在 sourceIds 中引用联网搜索返回的本地编号 ref_1、ref_2 等；不可引用不存在的编号、不可虚构 URL、不可在 JSON 中输出 sources。若没有可靠更新，请明确写“未查到可靠更新”并仍引用检索来源。
只做客观梳理。禁止推荐个股，禁止买卖、仓位、收益或保证性语言，也不要向读者下达投资行动指令。

以下是服务端已校验的全球数值快照：${JSON.stringify(globalSnapshot)}
指数、股票、汇率、利率和商品数值只能使用以上快照。不要输出 table 类型内容；服务端会从这个快照单独构建带来源与北京时间的表格。status 为 partial、failed 或 unconfigured 时必须明确说明数据未完成交叉校验或暂缺，不得从网页搜索结果猜测数值。

仅返回合法 JSON 对象，不要 Markdown 代码块，形状如下：
{"key":"${key}","title":"${definition.title}","summary":"最多三行摘要","tags":["AI","存储"],"blocks":[{"type":"heading","text":"AI 大模型"},{"type":"paragraph","text":"事实与盘面映射","sourceIds":["ref_1"]}]}`;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`Provider section JSON has invalid ${label}`);
  return value;
}

function parseBlocks(value: unknown): BriefBlock[] {
  if (!Array.isArray(value)) throw new Error("Provider section JSON has invalid blocks");
  return value.map((block, index) => {
    if (!isRecord(block) || typeof block.type !== "string") throw new Error(`Provider section JSON has invalid block ${index + 1}`);
    if (block.type === "heading" && typeof block.text === "string") return { type: "heading", text: block.text };
    if (block.type === "paragraph" && typeof block.text === "string") return { type: "paragraph", text: block.text, sourceIds: stringArray(block.sourceIds, "sourceIds") };
    if (block.type === "callout" && typeof block.text === "string" && (block.tone === "insight" || block.tone === "risk" || block.tone === "missing")) {
      return { type: "callout", tone: block.tone, text: block.text, sourceIds: stringArray(block.sourceIds, "sourceIds") };
    }
    if (block.type === "bullets" && Array.isArray(block.items)) {
      return {
        type: "bullets",
        items: block.items.map((item, itemIndex) => {
          if (!isRecord(item) || typeof item.text !== "string") throw new Error(`Provider section JSON has invalid bullet ${index + 1}.${itemIndex + 1}`);
          return { text: item.text, sourceIds: stringArray(item.sourceIds, "sourceIds") };
        }),
      };
    }
    if (block.type === "table") throw new Error("Provider section JSON must not contain model-generated tables");
    throw new Error(`Provider section JSON has invalid block ${index + 1}`);
  });
}

function parseSection(text: string, key: BriefSectionKey): ParsedSection {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Provider response did not include valid section JSON");
  }
  if (!isRecord(value)
    || value.key !== key
    || typeof value.title !== "string"
    || typeof value.summary !== "string") {
    throw new Error("Provider response did not include a valid requested section");
  }
  return { key, title: value.title, summary: value.summary, tags: stringArray(value.tags, "tags"), blocks: parseBlocks(value.blocks) };
}

function namespaceSourceId(key: BriefSectionKey, sourceId: string): string {
  const match = /^ref_(\d+)$/.exec(sourceId);
  return match ? `${key}_ref_${match[1]}` : sourceId;
}

function namespaceBlocks(key: BriefSectionKey, blocks: BriefBlock[]): BriefBlock[] {
  return blocks.map((block) => {
    if (block.type === "paragraph" || block.type === "callout") return { ...block, sourceIds: block.sourceIds.map((id) => namespaceSourceId(key, id)) };
    if (block.type === "bullets") return { ...block, items: block.items.map((item) => ({ ...item, sourceIds: item.sourceIds.map((id) => namespaceSourceId(key, id)) })) };
    return block;
  });
}

function referencedSourceIds(blocks: BriefBlock[]): string[] {
  const ids = blocks.flatMap((block) => {
    if (block.type === "paragraph" || block.type === "callout") return block.sourceIds;
    if (block.type === "bullets") return block.items.flatMap((item) => item.sourceIds);
    return [];
  });
  return [...new Set(ids)];
}

function sourcesFromMetadata(key: BriefSectionKey, searchResults: ProviderSearchResult[]): BriefSource[] {
  const seen = new Set<number>();
  return searchResults.flatMap((source, fallbackIndex) => {
    const index = Number.isFinite(source.index) && Number(source.index) > 0 ? Number(source.index) : fallbackIndex + 1;
    const publishedAt = source.published_time ?? source.publish_time ?? source.published_at ?? source.publishedAt;
    if (seen.has(index) || typeof source.title !== "string" || typeof source.url !== "string" || typeof publishedAt !== "string") return [];
    seen.add(index);
    return [{ id: `${key}_ref_${index}`, title: source.title, url: source.url, publishedAt }];
  });
}

function validIsoTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second = "0", , offsetHour = "0", offsetMinute = "0"] = match.slice(1);
  const parsed = [year, month, day, hour, minute, second, offsetHour, offsetMinute].map(Number);
  const [parsedYear, parsedMonth, parsedDay, parsedHour, parsedMinute, parsedSecond, parsedOffsetHour, parsedOffsetMinute] = parsed;
  const calendar = new Date(Date.UTC(parsedYear, parsedMonth - 1, parsedDay));
  return calendar.getUTCFullYear() === parsedYear
    && calendar.getUTCMonth() === parsedMonth - 1
    && calendar.getUTCDate() === parsedDay
    && parsedHour <= 23
    && parsedMinute <= 59
    && parsedSecond <= 59
    && parsedOffsetHour <= 23
    && parsedOffsetMinute <= 59;
}

function validateGeneratedSources(sources: BriefSource[]): void {
  const errors: string[] = [];
  const ids = new Set<string>();
  sources.forEach((source) => {
    if (!source.id || ids.has(source.id)) errors.push("source ID is missing or duplicated");
    ids.add(source.id);
    if (!source.title.trim()) errors.push(`source ${source.id} is missing a title`);
    try {
      const url = new URL(source.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") errors.push(`source ${source.id} has an invalid URL`);
    } catch {
      errors.push(`source ${source.id} has an invalid URL`);
    }
    if (!validIsoTimestamp(source.publishedAt)) errors.push(`source ${source.id} has an invalid published time`);
  });
  if (errors.length > 0) throw new Error(`Brief section source validation failed: ${errors.join("; ")}`);
}

function finishSection(key: BriefSectionKey, globalSnapshot: ReconciledGlobalPoint[], parsed: ParsedSection, sources: BriefSource[]): GeneratedBriefSection {
  validateGeneratedSources(sources);
  const modelBlocks = namespaceBlocks(key, parsed.blocks);
  const blocks = [...modelBlocks, ...snapshotBlocks(key, globalSnapshot)];
  const section: BriefSection = {
    ...parsed,
    blocks,
    sourceIds: referencedSourceIds(modelBlocks),
    status: "complete",
    generatedAt: beijingTimestamp(new Date()),
  };
  const validation = validateBriefSection(section, new Set(sources.map((source) => source.id)));
  if (!validation.ok) throw new Error(`Brief section validation failed: ${validation.errors.join("; ")}`);
  return { section, sources };
}

function qwenText(payload: unknown): string {
  const value = payload as { output?: { choices?: Array<{ message?: { content?: unknown } }> } };
  const text = value.output?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("DashScope response did not include structured output text");
  return text;
}

function qwenSearchResults(payload: unknown): ProviderSearchResult[] {
  const value = payload as { output?: { search_info?: { search_results?: unknown } } };
  return Array.isArray(value.output?.search_info?.search_results) ? value.output.search_info.search_results.filter(isRecord) : [];
}

type OpenAISearchSource = { index?: number; url?: string };
type OpenAIUrlCitation = { title: string; url: string };

function openAIText(payload: unknown): string {
  const value = payload as { output?: Array<{ content?: Array<{ type?: string; text?: unknown }> }> };
  const text = value.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
  if (typeof text !== "string") throw new Error("OpenAI response did not include structured output text");
  return text;
}

function openAISearchResults(payload: unknown): OpenAISearchSource[] {
  const value = payload as { output?: Array<{ action?: { sources?: unknown } }> };
  return value.output?.flatMap((item) => Array.isArray(item.action?.sources) ? item.action.sources.filter(isRecord) : []) ?? [];
}

function openAIUrlCitations(payload: unknown): OpenAIUrlCitation[] {
  const value = payload as { output?: Array<{ content?: Array<{ annotations?: unknown }> }> };
  return value.output?.flatMap((item) => item.content ?? []).flatMap((content) => {
    if (!Array.isArray(content.annotations)) return [];
    return content.annotations.flatMap((annotation) => {
      if (!isRecord(annotation) || annotation.type !== "url_citation" || typeof annotation.title !== "string" || typeof annotation.url !== "string") return [];
      return [{ title: annotation.title, url: annotation.url }];
    });
  }) ?? [];
}

function sourceIndex(source: { index?: number }, fallbackIndex: number): number {
  return Number.isFinite(source.index) && Number(source.index) > 0 ? Number(source.index) : fallbackIndex + 1;
}

function comparableUrl(value: string): string | null {
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

function metadataPublicationTime(document: string, response: Response): string | null {
  const candidates: string[] = [];
  for (const tag of document.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = /\b(?:property|name|itemprop)\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (content && (name === "article:published_time" || name === "datepublished" || name === "date")) candidates.push(content);
  }
  for (const tag of document.match(/<time\b[^>]*>/gi) ?? []) {
    const datetime = /\bdatetime\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (datetime) candidates.push(datetime);
  }
  const metadataTime = candidates.find(validIsoTimestamp);
  if (metadataTime) return metadataTime;

  const lastModified = response.headers.get("last-modified");
  if (!lastModified) return null;
  const parsed = new Date(lastModified);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function hydrateOpenAISources(
  key: BriefSectionKey,
  parsed: ParsedSection,
  payload: unknown,
  fetcher: typeof fetch,
): Promise<BriefSource[]> {
  const actionSources = openAISearchResults(payload);
  const citations = openAIUrlCitations(payload);
  const citationsByUrl = new Map(citations.flatMap((citation) => {
    const url = comparableUrl(citation.url);
    return url && citation.title.trim() ? [[url, citation] as const] : [];
  }));
  const actionByIndex = new Map(actionSources.map((source, index) => [sourceIndex(source, index), source]));
  const localIds = referencedSourceIds(parsed.blocks);

  return Promise.all(localIds.map(async (localId) => {
    const match = /^ref_(\d+)$/.exec(localId);
    const source = match ? actionByIndex.get(Number(match[1])) : undefined;
    const actionUrl = source?.url && comparableUrl(source.url);
    const citation = actionUrl ? citationsByUrl.get(actionUrl) : undefined;
    if (!citation) throw new Error(`OpenAI cited source could not be validated: ${localId} lacks a matching URL citation`);
    const response = await fetcher(citation.url, { headers: { accept: "text/html,application/xhtml+xml" } });
    if (!response.ok) throw new Error(`OpenAI cited source could not be validated: ${citation.url} returned HTTP ${response.status}`);
    const publishedAt = metadataPublicationTime(await response.text(), response);
    if (!publishedAt) throw new Error(`OpenAI cited source could not be validated: ${citation.url} has no verifiable publication time`);
    return { id: `${key}_${localId}`, title: citation.title, url: citation.url, publishedAt };
  }));
}

export async function generateQwenBriefSection({
  date,
  key,
  apiKey,
  globalSnapshot,
  fetcher = fetch,
  endpoint = DASHSCOPE_SECTION_GENERATION_URL,
}: ProviderSectionInput): Promise<GeneratedBriefSection> {
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY is not configured");
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: QWEN_BRIEF_SECTION_MODEL,
      input: {
        messages: [
          { role: "system", content: "你是盘层的财经早参编辑。所有输出必须是可解析的 JSON，并严格遵守来源与非荐股约束。" },
          { role: "user", content: promptForSection(date, key, globalSnapshot) },
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
  const payload: unknown = await response.json();
  if (!response.ok) {
    const detail = isRecord(payload) && (typeof payload.message === "string" || typeof payload.code === "string")
      ? (payload.message ?? payload.code)
      : `HTTP ${response.status}`;
    throw new Error(`DashScope Generation API ${detail}`);
  }
  return finishSection(key, globalSnapshot, parseSection(qwenText(payload), key), sourcesFromMetadata(key, qwenSearchResults(payload)));
}

export async function generateOpenAIBriefSection({
  date,
  key,
  apiKey,
  globalSnapshot,
  fetcher = fetch,
  endpoint = OPENAI_RESPONSES_URL,
}: ProviderSectionInput): Promise<GeneratedBriefSection> {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      reasoning: { effort: "medium" },
      tools: [{ type: "web_search", search_context_size: "medium" }],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      input: promptForSection(date, key, globalSnapshot),
      text: {
        verbosity: "high",
        format: { type: "json_schema", name: "panlayer_morning_brief_section", strict: true, schema: strictSectionSchema(key) },
      },
    }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`OpenAI Responses API ${response.status}`);
  const parsed = parseSection(openAIText(payload), key);
  return finishSection(key, globalSnapshot, parsed, await hydrateOpenAISources(key, parsed, payload, fetcher));
}
