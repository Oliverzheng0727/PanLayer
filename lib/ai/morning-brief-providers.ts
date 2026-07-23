import type { ReconciledGlobalPoint } from "../data/global/types";
import { LEADER_RANKING_BASIS } from "../domain/metrics";
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

export interface MorningBriefMarketContext {
  review: null | {
    date: string;
    status: "complete" | "partial" | "failed" | "demo";
    closeBreadth: { rising: number; falling: number; flat: number } | null;
    metrics: { limitUp: number; limitDown: number; consecutive: number; largeRise: number; high120: number | null; allTimeHigh: number | null; marginBalance: number | null };
    ladder: { first: number; second: number; third: number; fourth: number; fivePlus: number };
    sectors: Array<{ name: string; factors: { limitUpCount: number; averagePct: number; amountGrowthPct: number; maxStreak: number } }>;
    leaders: Array<{ name: string; symbol: string; factors: { pctChange: number; amount: number; limitStreak: number; isLimitUp: boolean; firstLimitTime: string | null; sector: string } }>;
  };
  etfs: Array<{ category: string; name: string; code: string }>;
}

export type BriefSectionGenerator = (input: {
  date: string;
  key: BriefSectionKey;
  globalSnapshot: ReconciledGlobalPoint[];
  marketContext?: MorningBriefMarketContext;
}) => Promise<GeneratedBriefSection>;

export interface ProviderSectionInput {
  date: string;
  key: BriefSectionKey;
  apiKey: string;
  globalSnapshot: ReconciledGlobalPoint[];
  marketContext?: MorningBriefMarketContext;
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
type ProviderSource = Omit<BriefSource, "retrievedAt">;

const OPENAI_SECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    key: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    blocks: {
      type: "array",
      minItems: 1,
      items: {
        oneOf: [
          { type: "object", additionalProperties: false, properties: { type: { const: "heading" }, text: { type: "string" } }, required: ["type", "text"] },
          {
            type: "object", additionalProperties: false,
            properties: { type: { const: "paragraph" }, text: { type: "string" }, sourceUrls: { type: "array", minItems: 1, items: { type: "string" } } },
            required: ["type", "text", "sourceUrls"],
          },
          {
            type: "object", additionalProperties: false,
            properties: {
              type: { const: "bullets" },
              items: {
                type: "array",
                items: {
                  type: "object", additionalProperties: false,
                  properties: { text: { type: "string" }, sourceUrls: { type: "array", minItems: 1, items: { type: "string" } } },
                  required: ["text", "sourceUrls"],
                },
              },
            },
            required: ["type", "items"],
          },
          {
            type: "object", additionalProperties: false,
            properties: {
              type: { const: "callout" }, tone: { type: "string", enum: ["insight", "risk", "missing"] }, text: { type: "string" }, sourceUrls: { type: "array", minItems: 1, items: { type: "string" } },
            },
            required: ["type", "tone", "text", "sourceUrls"],
          },
        ],
      },
    },
  },
  required: ["key", "title", "summary", "tags", "blocks"],
} as const;

function strictOpenAISectionSchema(key: BriefSectionKey) {
  const definition = BRIEF_SECTION_DEFINITIONS.find((item) => item.key === key);
  if (!definition) throw new Error(`Unknown brief section key: ${key}`);
  return {
    ...OPENAI_SECTION_SCHEMA,
    properties: {
      ...OPENAI_SECTION_SCHEMA.properties,
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

function promptForSection(date: string, key: BriefSectionKey, globalSnapshot: ReconciledGlobalPoint[], citationField: "sourceIds" | "sourceUrls" = "sourceIds"): string {
  const definition = BRIEF_SECTION_DEFINITIONS.find((item) => item.key === key);
  if (!definition) throw new Error(`Unknown brief section key: ${key}`);
  const modelRequiredTerms = (key === "mapping" || key === "risk")
    ? definition.requiredTerms.filter((term) => term !== "ETF")
    : definition.requiredTerms;
  return `生成 ${date} 北京时间 07:15 的A股隔夜早参模块。只生成一个模块，key 必须为 "${key}"，标题必须为 "${definition.title}"。

本模块必须逐项覆盖：${modelRequiredTerms.join("、")}。正文内容长度（仅内容块文字）必须为 1000 至 1600 个字符。
主动检索从上一交易日收盘至当前的可靠来源。${citationField === "sourceIds"
    ? "每条事实、解读和风险说明均须在 sourceIds 中引用联网搜索返回的本地编号 ref_1、ref_2 等；不可引用不存在的编号、不可虚构 URL、不可在 JSON 中输出 sources。"
    : "每条事实、解读和风险说明均须在 sourceUrls 中引用联网搜索返回的精确 URL；不可引用不存在的 URL、不可虚构 URL、不可在 JSON 中输出 sources。"}若没有可靠更新，请明确写“未查到可靠更新”并仍引用检索来源。
只做客观梳理。禁止推荐个股，禁止买卖、仓位、收益或保证性语言，也不要向读者下达投资行动指令。

以下是服务端已校验的全球数值快照：${JSON.stringify(globalSnapshot)}
指数、股票、汇率、利率和商品数值只能使用以上快照。不要在叙述中重复这些快照数字；不要输出 table 类型内容；服务端会从这个快照单独构建带来源与北京时间的表格。status 为 partial、failed 或 unconfigured 时必须明确说明数据未完成交叉校验或暂缺，不得从网页搜索结果猜测数值。

${key === "mapping" || key === "risk" ? `服务端会在最终模块中追加已校验的复盘排名、龙头排名和 ETF 映射表；模型正文不得输出“主线”“热点”“龙头”或“ETF”这些保留词，也不得复述、推断或改写任何排名/映射结论。` : ""}

仅返回合法 JSON 对象，不要 Markdown 代码块，形状如下：
{"key":"${key}","title":"${definition.title}","summary":"最多三行摘要","tags":["AI","存储"],"blocks":[{"type":"heading","text":"AI 大模型"},{"type":"paragraph","text":"事实与盘面映射","${citationField}":[${citationField === "sourceIds" ? '"ref_1"' : '"https://example.com/cited-page"'}]}]}`;
}

function stringArray(value: unknown, label: string, minimum = 0): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.some((item) => typeof item !== "string")) throw new Error(`Provider section JSON has invalid ${label}`);
  return value;
}

function parseBlocks(value: unknown, citationField: "sourceIds" | "sourceUrls"): BriefBlock[] {
  if (!Array.isArray(value)) throw new Error("Provider section JSON has invalid blocks");
  return value.map((block, index) => {
    if (!isRecord(block) || typeof block.type !== "string") throw new Error(`Provider section JSON has invalid block ${index + 1}`);
    if (block.type === "heading" && typeof block.text === "string") return { type: "heading", text: block.text };
    if (block.type === "paragraph" && typeof block.text === "string") return { type: "paragraph", text: block.text, sourceIds: stringArray(block[citationField], citationField, 1) };
    if (block.type === "callout" && typeof block.text === "string" && (block.tone === "insight" || block.tone === "risk" || block.tone === "missing")) {
      return { type: "callout", tone: block.tone, text: block.text, sourceIds: stringArray(block[citationField], citationField, 1) };
    }
    if (block.type === "bullets" && Array.isArray(block.items)) {
      return {
        type: "bullets",
        items: block.items.map((item, itemIndex) => {
          if (!isRecord(item) || typeof item.text !== "string") throw new Error(`Provider section JSON has invalid bullet ${index + 1}.${itemIndex + 1}`);
          return { text: item.text, sourceIds: stringArray(item[citationField], citationField, 1) };
        }),
      };
    }
    if (block.type === "table") throw new Error("Provider section JSON must not contain model-generated tables");
    throw new Error(`Provider section JSON has invalid block ${index + 1}`);
  });
}

function parseSection(text: string, key: BriefSectionKey, citationField: "sourceIds" | "sourceUrls" = "sourceIds"): ParsedSection {
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
  return { key, title: value.title, summary: value.summary, tags: stringArray(value.tags, "tags"), blocks: parseBlocks(value.blocks, citationField) };
}

function namespaceSourceId(key: BriefSectionKey, sourceId: string): string {
  const match = /^ref_(\d+)$/.exec(sourceId);
  return match ? `${key}_ref_${match[1]}` : sourceId;
}

function namespaceBlocks(key: BriefSectionKey, blocks: BriefBlock[]): BriefBlock[] {
  return blocks.map((block) => {
    if (block.type === "paragraph" || block.type === "callout") return { ...block, sourceIds: block.sourceIds.map((id) => namespaceSourceId(key, id)) };
    if (block.type === "bullets") return { ...block, items: block.items.map((item) => ({ ...item, sourceIds: item.sourceIds.map((id) => namespaceSourceId(key, id)) })) };
    if (block.type === "table") return { ...block, sourceIds: block.sourceIds.map((id) => namespaceSourceId(key, id)) };
    return block;
  });
}

function referencedSourceIds(blocks: BriefBlock[]): string[] {
  const ids = blocks.flatMap((block) => {
    if (block.type === "paragraph" || block.type === "callout") return block.sourceIds;
    if (block.type === "bullets") return block.items.flatMap((item) => item.sourceIds);
    if (block.type === "table") return block.provenance.kind === "search" ? block.sourceIds : [];
    return [];
  });
  return [...new Set(ids)];
}

function providerPublishedAt(source: ProviderSearchResult): string | null {
  const publishedAt = source.published_time ?? source.publish_time ?? source.published_at ?? source.publishedAt;
  return typeof publishedAt === "string" && validIsoTimestamp(publishedAt) ? publishedAt : null;
}

function sourcesFromMetadata(key: BriefSectionKey, searchResults: ProviderSearchResult[]): ProviderSource[] {
  const seen = new Set<number>();
  return searchResults.flatMap((source, fallbackIndex) => {
    const index = Number.isFinite(source.index) && Number(source.index) > 0 ? Number(source.index) : fallbackIndex + 1;
    if (seen.has(index) || typeof source.title !== "string" || typeof source.url !== "string") return [];
    seen.add(index);
    return [{ id: `${key}_ref_${index}`, title: source.title, url: source.url, publishedAt: providerPublishedAt(source) }];
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
    if (source.publishedAt !== null && !validIsoTimestamp(source.publishedAt)) errors.push(`source ${source.id} has an invalid published time`);
    if (!/\+08:00$/.test(source.retrievedAt) || !validIsoTimestamp(source.retrievedAt)) errors.push(`source ${source.id} has an invalid retrieval time`);
  });
  if (errors.length > 0) throw new Error(`Brief section source validation failed: ${errors.join("; ")}`);
}

function normalizeSnapshotNumber(value: string): number | null {
  const normalized = value.replace(/[,%％，,\s]/g, "").replace(/^\+/, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function shownDecimalTolerance(value: string): number {
  const normalized = value.replace(/[，,]/g, "").replace(/[%％]/g, "");
  const fraction = normalized.split(".")[1]?.replace(/\D/g, "") ?? "";
  return 0.5 * 10 ** -fraction.length + 1e-9;
}

function narrativeSegments(blocks: BriefBlock[]): string[] {
  return blocks
    .filter((block) => block.type !== "heading" && block.type !== "table")
    .flatMap((block) => block.type === "bullets" ? block.items.map((item) => item.text) : "text" in block ? [block.text] : [])
    .flatMap((text) => text.split(/[。！？；;\n]+/))
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function snapshotNumbersInClause(clause: string, labels: string[]): Array<{ text: string; isPercent: boolean }> {
  const withoutLabel = labels.reduce((text, label) => text.split(label).join("标的"), clause);
  const withoutUnrelatedValues = withoutLabel
    .replace(/[A-Za-z]+\d[\d,.，]*/g, "")
    .replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, "")
    .replace(/\d{4}年\d{1,2}月\d{1,2}日/g, "")
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, "")
    .replace(/\d[\d,.，]*(?:家公司|家|只|个|人|年|月|日|时|分|秒)/g, "");
  return [...withoutUnrelatedValues.matchAll(/[+-]?\d[\d,.，]*(?:[%％]|点|美元|元)?/g)]
    .map((match) => ({
      text: match[0].replace(/(?:点|美元|元)$/, ""),
      isPercent: /[%％]$/.test(match[0]),
    }));
}

function snapshotClauses(blocks: BriefBlock[], labels: string[]): string[] {
  return narrativeSegments(blocks).flatMap((sentence) => {
    const clauses: string[] = [];
    let start = 0;
    for (let index = 0; index < sentence.length; index += 1) {
      const character = sentence[index];
      if (character !== "，" && character !== ",") continue;
      if (/\d/.test(sentence[index - 1] ?? "") && /\d/.test(sentence[index + 1] ?? "")) continue;
      const before = sentence.slice(start, index);
      const after = sentence.slice(index + 1);
      const beforeLabels = labels.filter((label) => before.includes(label));
      const afterLabels = labels.filter((label) => after.includes(label));
      if (beforeLabels.length > 0 && afterLabels.some((label) => !beforeLabels.includes(label))) {
        if (before.trim()) clauses.push(before.trim());
        start = index + 1;
      }
    }
    const tail = sentence.slice(start).trim();
    if (tail) clauses.push(tail);
    return clauses;
  });
}

function assertNarrativeSnapshotIntegrity(blocks: BriefBlock[], globalSnapshot: ReconciledGlobalPoint[]): void {
  const points = globalSnapshot.filter((point) => point.label);
  const labels = points.map((point) => point.label).sort((left, right) => right.length - left.length);
  for (const clause of snapshotClauses(blocks, labels)) {
    const mentioned = points.filter((point) => clause.includes(point.label));
    if (mentioned.length === 0) continue;
    const tokens = snapshotNumbersInClause(clause, labels);
    if (mentioned.length > 1 && tokens.length > 0) {
      throw new Error("快照数值归属歧义：同一子句包含多个标的");
    }
    const point = mentioned[0];
    for (const token of tokens) {
        const quoted = normalizeSnapshotNumber(token.text);
        if (quoted === null) continue;
        const allowed = (token.isPercent ? [point.pctChange] : [point.value, point.previousClose])
          .filter((value): value is number => value !== null);
        if (allowed.length > 0 && !allowed.some((value) => Math.abs(value - quoted) <= shownDecimalTolerance(token.text))) {
          throw new Error(`快照数值与服务端表格不一致：${point.label}`);
        }
    }
  }
}

function assertNoModelRankingTokens(key: BriefSectionKey, summary: string, tags: string[], blocks: BriefBlock[]): void {
  if (key !== "mapping" && key !== "risk") return;
  const reserved = /主线|热点|龙头|ETF/i;
  const textFields = blocks.flatMap((block) => block.type === "bullets" ? block.items.map((item) => item.text) : "text" in block ? [block.text] : []);
  const offending = [summary, ...tags, ...textFields].find((text) => reserved.test(text));
  if (offending) throw new Error(`模型正文包含排名保留词：${offending}`);
}

function contextSnapshotTable(label: string, columns: string[], rows: string[][], generatedAt: string): BriefBlock {
  return {
    type: "table",
    columns,
    rows,
    sourceIds: [],
    provenance: {
      kind: "snapshot",
      label,
      marketTime: generatedAt,
      providers: ["服务端 marketContext"],
      receivedAt: generatedAt,
    },
  };
}

function contextUnavailableCallout(label: string, text: string, generatedAt: string): BriefBlock {
  return {
    type: "callout",
    tone: "missing",
    text,
    sourceIds: [],
    provenance: {
      kind: "snapshot",
      label,
      marketTime: generatedAt,
      providers: ["服务端 marketContext"],
      receivedAt: generatedAt,
    },
  };
}

function marketContextBlocks(key: BriefSectionKey, marketContext: MorningBriefMarketContext | undefined, generatedAt: string): BriefBlock[] {
  if (key !== "mapping" && key !== "risk") return [];
  const review = marketContext?.review;
  const blocks: BriefBlock[] = [];
  if (review?.sectors.length) {
    blocks.push(contextSnapshotTable("服务端主线热点复盘", ["主线/热点", "板块", "排名依据", "因素"], review.sectors.map((sector) => ["服务端复盘", sector.name, "涨停数、均涨幅、成交额增量、最高连板", `涨停${sector.factors.limitUpCount}；均涨幅${sector.factors.averagePct}%；成交额增量${sector.factors.amountGrowthPct}%；最高连板${sector.factors.maxStreak}`]), generatedAt));
  } else {
    blocks.push(contextUnavailableCallout("服务端主线热点复盘", "服务端复盘上下文不可用：主线与热点排名暂缺。", generatedAt));
  }
  if (review?.leaders.length) {
    blocks.push(contextSnapshotTable("服务端龙头复盘", ["龙头", "代码", "排名依据", "因素"], review.leaders.map((leader) => [leader.name, leader.symbol, LEADER_RANKING_BASIS.join("、"), `涨停状态:${leader.factors.isLimitUp ? "涨停" : "非涨停"}；连板高度${leader.factors.limitStreak}；首次封板${leader.factors.firstLimitTime ?? "暂缺"}；成交额${leader.factors.amount}`]), generatedAt));
  } else {
    blocks.push(contextUnavailableCallout("服务端龙头复盘", "服务端复盘上下文不可用：龙头排名暂缺。", generatedAt));
  }
  if (marketContext?.etfs.length) {
    blocks.push(contextSnapshotTable("服务端ETF映射", ["ETF分类", "ETF名称", "代码", "映射依据"], marketContext.etfs.map((etf) => [etf.category, etf.name, etf.code, "服务端 ETF 分类映射"]), generatedAt));
  } else {
    blocks.push(contextUnavailableCallout("服务端ETF映射", "服务端 ETF 映射上下文不可用。", generatedAt));
  }
  return blocks;
}

function finishSection(key: BriefSectionKey, globalSnapshot: ReconciledGlobalPoint[], marketContext: MorningBriefMarketContext | undefined, parsed: ParsedSection, providerSources: ProviderSource[], namespaceReferences = true): GeneratedBriefSection {
  const generatedAt = beijingTimestamp(new Date());
  const sources = providerSources.map((source) => ({ ...source, retrievedAt: generatedAt }));
  validateGeneratedSources(sources);
  const modelBlocks = namespaceReferences ? namespaceBlocks(key, parsed.blocks) : parsed.blocks;
  assertNoModelRankingTokens(key, parsed.summary, parsed.tags, modelBlocks);
  assertNarrativeSnapshotIntegrity(modelBlocks, globalSnapshot);
  const blocks = [...modelBlocks, ...marketContextBlocks(key, marketContext, generatedAt), ...snapshotBlocks(key, globalSnapshot)];
  const section: BriefSection = {
    ...parsed,
    blocks,
    sourceIds: referencedSourceIds(modelBlocks),
    status: "complete",
    generatedAt,
  };
  const knownSourceIds = new Set(sources.map((source) => source.id));
  if (!section.sourceIds.some((id) => knownSourceIds.has(id))) {
    throw new Error(`Brief section validation failed: ${section.title}完整模块必须至少引用一个有效来源`);
  }
  const validation = validateBriefSection(section, knownSourceIds);
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

type OpenAISearchSource = Pick<ProviderSearchResult, "url" | "published_time" | "publish_time" | "published_at" | "publishedAt">;
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

function comparableUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function replaceSourceUrls(blocks: BriefBlock[], sourceIdsByUrl: Map<string, string>): BriefBlock[] {
  const sourceId = (url: string) => {
    const normalized = comparableUrl(url);
    const id = normalized ? sourceIdsByUrl.get(normalized) : undefined;
    if (!id) throw new Error(`OpenAI cited source could not be validated: ${url} is not an allowed search URL`);
    return id;
  };
  return blocks.map((block) => {
    if (block.type === "paragraph" || block.type === "callout") return { ...block, sourceIds: block.sourceIds.map(sourceId) };
    if (block.type === "bullets") return { ...block, items: block.items.map((item) => ({ ...item, sourceIds: item.sourceIds.map(sourceId) })) };
    if (block.type === "table") return { ...block, sourceIds: block.sourceIds.map(sourceId) };
    return block;
  });
}

function sourcesFromOpenAI(
  key: BriefSectionKey,
  parsed: ParsedSection,
  payload: unknown,
): ProviderSource[] {
  const actionSources = openAISearchResults(payload);
  const citations = openAIUrlCitations(payload);
  const citationsByUrl = new Map(citations.flatMap((citation) => {
    const url = comparableUrl(citation.url);
    return url && citation.title.trim() ? [[url, citation] as const] : [];
  }));
  const actionByUrl = new Map(actionSources.flatMap((source) => {
    const url = typeof source.url === "string" ? comparableUrl(source.url) : null;
    return url ? [[url, source] as const] : [];
  }));
  const sourceUrls = referencedSourceIds(parsed.blocks).map((url) => comparableUrl(url));
  if (sourceUrls.some((url) => !url)) throw new Error("OpenAI cited source could not be validated: malformed cited URL");
  const uniqueUrls = [...new Set(sourceUrls as string[])].sort();

  return uniqueUrls.map((url, index) => {
    const citation = citationsByUrl.get(url);
    const action = actionByUrl.get(url);
    if (!action || !citation) throw new Error(`OpenAI cited source could not be validated: ${url} lacks a matching search source or URL citation`);
    return { id: `${key}_ref_${index + 1}`, title: citation.title, url: citation.url, publishedAt: providerPublishedAt(action) };
  });
}

export async function generateQwenBriefSection({
  date,
  key,
  apiKey,
  globalSnapshot,
  marketContext,
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
  return finishSection(key, globalSnapshot, marketContext, parseSection(qwenText(payload), key), sourcesFromMetadata(key, qwenSearchResults(payload)));
}

export async function generateOpenAIBriefSection({
  date,
  key,
  apiKey,
  globalSnapshot,
  marketContext,
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
      input: promptForSection(date, key, globalSnapshot, "sourceUrls"),
      text: {
        verbosity: "high",
        format: { type: "json_schema", name: "panlayer_morning_brief_section", strict: true, schema: strictOpenAISectionSchema(key) },
      },
    }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`OpenAI Responses API ${response.status}`);
  const parsed = parseSection(openAIText(payload), key, "sourceUrls");
  const sources = sourcesFromOpenAI(key, parsed, payload);
  const sourceIdsByUrl = new Map(sources.flatMap((source) => {
    const url = comparableUrl(source.url);
    return url ? [[url, source.id] as const] : [];
  }));
  return finishSection(key, globalSnapshot, marketContext, { ...parsed, blocks: replaceSourceUrls(parsed.blocks, sourceIdsByUrl) }, sources, false);
}
