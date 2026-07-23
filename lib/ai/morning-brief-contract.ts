export type BriefStatus = "complete" | "partial" | "failed";

export type BriefSectionKey =
  | "global-markets"
  | "global-industry"
  | "domestic"
  | "mapping"
  | "risk";

export interface BriefSource {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  retrievedAt: string;
}

export type BriefBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string; sourceIds: string[] }
  | { type: "bullets"; items: Array<{ text: string; sourceIds: string[] }> }
  | {
    type: "table";
    columns: string[];
    rows: string[][];
    sourceIds: string[];
    provenance:
      | { kind: "search" }
      | { kind: "snapshot"; label: string; marketTime: string; providers: string[]; receivedAt: string };
  }
  | {
    type: "callout";
    tone: "insight" | "risk" | "missing";
    text: string;
    sourceIds: string[];
    provenance?: { kind: "snapshot"; label: string; marketTime: string; providers: string[]; receivedAt: string };
  };

export interface BriefSection {
  key: BriefSectionKey;
  title: string;
  summary: string;
  tags: string[];
  status: BriefStatus;
  generatedAt: string;
  blocks: BriefBlock[];
  sourceIds: string[];
}

export interface MorningBrief {
  schemaVersion: 2;
  date: string;
  status: BriefStatus;
  generatedAt: string;
  sections: BriefSection[];
  sources: BriefSource[];
  disclaimer: string;
}

export const BRIEF_SECTION_DEFINITIONS = [
  { key: "global-markets", title: "全球外围市场全景", requiredTerms: ["道琼斯", "标普", "纳斯达克", "费城半导体", "英伟达", "美光", "中概", "A50", "人民币", "美债", "原油", "黄金", "工业金属"] },
  { key: "global-industry", title: "全球产业重大催化", requiredTerms: ["Kimi", "DeepSeek", "GPT", "存储", "人形机器人", "算力", "光模块", "钠离子电池", "新能源车", "医药"] },
  { key: "domestic", title: "国内隔夜重磅信息", requiredTerms: ["宏观", "政策", "产业", "公告", "央行", "流动性"] },
  { key: "mapping", title: "板块利好、利空与内需映射", requiredTerms: ["指数", "成交额", "涨跌停", "连板", "资金", "ETF", "利好", "利空", "内需"] },
  { key: "risk", title: "盘前情绪、观察方向与风险", requiredTerms: ["情绪", "观察", "持续性", "风险", "关键"] },
] as const satisfies ReadonlyArray<{
  key: BriefSectionKey;
  title: string;
  requiredTerms: readonly string[];
}>;

export interface BriefValidationResult {
  ok: boolean;
  errors: string[];
}

const RECOMMENDATION_LANGUAGE = /(?:建议|可|宜|应|值得|推荐)(?:买入|卖出|加仓|减仓|关注|持有)|(?:逢低|逢高)(?:吸纳|买入|卖出|减仓)|(?:买点|卖点|仓位(?:建议|配置|管理)?|收益承诺|目标价|止损|止盈|重仓|满仓|清仓|建仓|抄底|追高)/;
const DIRECT_STOCK_ATTENTION_LANGUAGE = /(?:重点关注|(?:推荐|建议)关注|推荐)(?!评级)[\s：:，、]*(?:[A-Za-z0-9\u4E00-\u9FFF]{2,})/;
const READER_DIRECTIVE_LANGUAGE = /建议|可以|可|宜|应当|不妨|值得|投资者|读者/;
const INVESTMENT_ACTION_LANGUAGE = /买入|卖出|加仓|减仓|布局|配置|建仓|清仓|止损|止盈|吸纳|持有|持仓|空仓|仓位|轻仓|重仓|满仓|半仓|观望|降低持仓|提高持仓|抄底|追高/;
const RETURN_GUARANTEE_LANGUAGE = /保证|承诺|确保|保本|稳赚|必赚|无风险|确定性/;
const RETURN_LANGUAGE = /收益|回报|盈利|获利|年化|翻倍/;
const BRIEF_STATUSES = new Set<BriefStatus>(["complete", "partial", "failed"]);
const SECTION_KEYS = new Set<BriefSectionKey>(BRIEF_SECTION_DEFINITIONS.map((item) => item.key));
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|([+-])(\d{2}):(\d{2}))$/;
const BEIJING_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\+08:00$/;

function blockText(block: BriefBlock): string[] {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "callout":
      return [block.text];
    case "bullets":
      return block.items.map((item) => item.text);
    case "table":
      return [...block.columns, ...block.rows.flat()];
  }
}

function blockSourceIds(block: BriefBlock): string[] {
  switch (block.type) {
    case "heading":
      return [];
    case "paragraph":
      return block.sourceIds;
    case "callout":
      return block.provenance?.kind === "snapshot" ? [] : block.sourceIds;
    case "table":
      return block.provenance?.kind === "snapshot" ? [] : block.sourceIds;
    case "bullets":
      return block.items.flatMap((item) => item.sourceIds);
  }
}

function requiresSources(block: BriefBlock, sectionStatus: BriefStatus): boolean {
  return block.type !== "heading"
    && !(block.type === "callout" && block.tone === "missing" && sectionStatus !== "complete")
    && !((block.type === "table" || block.type === "callout") && block.provenance?.kind === "snapshot");
}

function isExplicitFailedSectionCallout(block: BriefBlock): boolean {
  return block.type === "callout" && block.tone === "missing" && /(?:失败|暂缺|未查到|不可用|缺失)/.test(block.text);
}

function appendSourceErrors(errors: string[], label: string, sourceIds: string[], knownSourceIds: Set<string>): void {
  if (sourceIds.length === 0) {
    errors.push(`${label}缺少来源`);
    return;
  }
  if (sourceIds.some((id) => !knownSourceIds.has(id))) {
    errors.push(`${label}引用了不存在的来源`);
  }
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCalendarDate(value: unknown): value is string {
  if (!isNonBlankString(value) || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return hasCalendarDate(year, month, day);
}

function hasCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isIsoTimestamp(value: unknown): value is string {
  if (!isNonBlankString(value)) return false;
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second = 0] = match.slice(1, 7).map(Number);
  const offsetHour = match[9] ? Number(match[9]) : 0;
  const offsetMinute = match[10] ? Number(match[10]) : 0;
  return hasCalendarDate(year, month, day)
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 23
    && offsetMinute <= 59;
}

function isBeijingTimestamp(value: unknown): value is string {
  return isIsoTimestamp(value) && BEIJING_TIMESTAMP_PATTERN.test(value);
}

function validateTableProvenance(errors: string[], sectionTitle: string, index: number, block: Extract<BriefBlock, { type: "table" }>): void {
  const provenance = block.provenance;
  if (!provenance || (provenance.kind !== "search" && provenance.kind !== "snapshot")) {
    errors.push(`${sectionTitle}第${index + 1}个表格缺少合法来源类型`);
    return;
  }
  if (provenance.kind !== "snapshot") return;
  if (!isNonBlankString(provenance.label)) {
    errors.push(`${sectionTitle}第${index + 1}个表格缺少快照来源标签`);
  }
  if (!isBeijingTimestamp(provenance.marketTime)) {
    errors.push(`${sectionTitle}第${index + 1}个表格市场时间必须为北京时间`);
  }
  if (!Array.isArray(provenance.providers) || provenance.providers.length === 0 || provenance.providers.some((provider) => !isNonBlankString(provider))) {
    errors.push(`${sectionTitle}第${index + 1}个表格缺少快照提供方`);
  }
  if (!isIsoTimestamp(provenance.receivedAt)) {
    errors.push(`${sectionTitle}第${index + 1}个表格接收时间必须为有效ISO时间`);
  }
}

function validateSnapshotCalloutProvenance(errors: string[], sectionTitle: string, index: number, block: Extract<BriefBlock, { type: "callout" }>): void {
  if (!block.provenance) return;
  const provenance = block.provenance;
  if (!isNonBlankString(provenance.label)
    || !isBeijingTimestamp(provenance.marketTime)
    || !Array.isArray(provenance.providers)
    || provenance.providers.length === 0
    || provenance.providers.some((provider) => !isNonBlankString(provider))
    || !isIsoTimestamp(provenance.receivedAt)) {
    errors.push(`${sectionTitle}第${index + 1}个服务端提示缺少合法快照来源`);
  }
}

export function briefTextLength(section: BriefSection): number {
  return section.blocks.flatMap(blockText).join("").length;
}

export function resolveBlockSources(brief: Pick<MorningBrief, "sources">, block: BriefBlock): BriefSource[] {
  const byId = new Map(brief.sources.map((source) => [source.id, source]));
  const seen = new Set<string>();

  return blockSourceIds(block).flatMap((id) => {
    const source = byId.get(id);
    if (!source || seen.has(id)) return [];
    seen.add(id);
    return [source];
  });
}

export function validateBriefSection(section: BriefSection, knownSourceIds: Set<string>): BriefValidationResult {
  const errors: string[] = [];
  const definition = BRIEF_SECTION_DEFINITIONS.find((item) => item.key === section.key);

  if (!SECTION_KEYS.has(section.key)) {
    errors.push(`未知模块：${section.key}`);
  } else if (definition && section.title !== definition.title) {
    errors.push(`${section.key}模块标题不匹配`);
  }
  if (!BRIEF_STATUSES.has(section.status)) errors.push(`${section.title}状态不合法`);
  if (!isBeijingTimestamp(section.generatedAt)) errors.push(`${section.title}生成时间必须为北京时间`);

  section.blocks.forEach((block, index) => {
    if (block.type === "table") validateTableProvenance(errors, section.title, index, block);
    if (block.type === "callout") validateSnapshotCalloutProvenance(errors, section.title, index, block);
    if (requiresSources(block, section.status)) {
      appendSourceErrors(errors, `${section.title}第${index + 1}个内容块`, blockSourceIds(block), knownSourceIds);
    }
    const text = blockText(block).join("");
    if (RECOMMENDATION_LANGUAGE.test(text)
      || DIRECT_STOCK_ATTENTION_LANGUAGE.test(text)
      || (READER_DIRECTIVE_LANGUAGE.test(text) && INVESTMENT_ACTION_LANGUAGE.test(text))
      || (RETURN_GUARANTEE_LANGUAGE.test(text) && RETURN_LANGUAGE.test(text))) {
      errors.push(`${section.title}包含投资建议语言`);
    }
  });

  if (section.sourceIds.some((id) => !isNonBlankString(id) || !knownSourceIds.has(id))) {
    errors.push(`${section.title}引用了不存在的模块来源`);
  }

  if (section.status === "complete") {
    if (!section.sourceIds.some((id) => knownSourceIds.has(id))) {
      errors.push(`${section.title}完整模块必须至少引用一个有效来源`);
    }
    const length = briefTextLength(section);
    if (length < 1_000 || length > 1_600) {
      errors.push(`${section.title}字数应为1000至1600字符`);
    }
    const renderedText = section.blocks.flatMap(blockText).join("");
    const missingTerms = definition?.requiredTerms.filter((term) => !renderedText.includes(term)) ?? [];
    if (missingTerms.length > 0) {
      errors.push(`${section.title}覆盖不完整：缺少${missingTerms.join("、")}`);
    }
  } else if (!section.blocks.some(isExplicitFailedSectionCallout)) {
    errors.push(`${section.title}非完整模块必须包含明确的缺失说明`);
  }

  return { ok: errors.length === 0, errors };
}

function validateSources(sources: BriefSource[]): { errors: string[]; validIds: Set<string> } {
  const errors: string[] = [];
  const counts = new Map<string, number>();
  sources.forEach((source) => {
    if (typeof source.id === "string") counts.set(source.id, (counts.get(source.id) ?? 0) + 1);
  });
  const validIds = new Set<string>();

  sources.forEach((source, index) => {
    const label = `来源${index + 1}`;
    const id = isNonBlankString(source.id) ? source.id.trim() : "";
    if (!id) errors.push(`${label}缺少ID`);
    else if ((counts.get(source.id) ?? 0) > 1) errors.push(`${label}的ID重复`);
    if (!isNonBlankString(source.title)) errors.push(`${label}缺少标题`);

    let validUrl = false;
    try {
      const url = new URL(String(source.url));
      validUrl = url.protocol === "http:" || url.protocol === "https:";
    } catch {
      validUrl = false;
    }
    if (!validUrl) errors.push(`${label}URL必须为http(s)地址`);
    const validPublishedAt = source.publishedAt === null || isIsoTimestamp(source.publishedAt);
    if (!validPublishedAt) errors.push(`${label}发布时间必须为有效ISO时间`);
    const validRetrievedAt = isBeijingTimestamp(source.retrievedAt);
    if (!validRetrievedAt) errors.push(`${label}获取时间必须为北京时间`);

    if (id && (counts.get(source.id) ?? 0) === 1 && isNonBlankString(source.title) && validUrl && validPublishedAt && validRetrievedAt) {
      validIds.add(source.id);
    }
  });

  return { errors, validIds };
}

export function validateMorningBrief(brief: MorningBrief): BriefValidationResult {
  const errors: string[] = [];
  if (brief.schemaVersion !== 2) errors.push("schemaVersion必须为2");
  if (!BRIEF_STATUSES.has(brief.status)) errors.push("早参状态不合法");
  if (!isCalendarDate(brief.date)) errors.push("早参日期必须为YYYY-MM-DD的有效日期");
  if (!isBeijingTimestamp(brief.generatedAt)) errors.push("早参生成时间必须为北京时间");

  const sourceValidation = validateSources(brief.sources);
  errors.push(...sourceValidation.errors);
  const knownSourceIds = sourceValidation.validIds;
  const sectionKeys = new Set(brief.sections.map((section) => section.key));

  BRIEF_SECTION_DEFINITIONS.forEach((definition) => {
    if (!sectionKeys.has(definition.key)) errors.push(`缺少模块：${definition.title}`);
  });
  if (sectionKeys.size !== brief.sections.length) errors.push("存在重复模块");

  brief.sections.forEach((section) => {
    errors.push(...validateBriefSection(section, knownSourceIds).errors);
  });

  if (brief.status === "complete") {
    if (brief.sections.some((section) => section.status !== "complete")) {
      errors.push("完整早参不能包含非完整模块");
    }
    const length = brief.sections.reduce((total, section) => total + briefTextLength(section), 0);
    if (length < 5_000 || length > 8_000) {
      errors.push("完整早参字数应为5000至8000字符");
    }
  }

  if (!brief.disclaimer.includes("不构成投资建议")) {
    errors.push("缺少投资建议免责声明");
  }

  return { ok: errors.length === 0, errors };
}
