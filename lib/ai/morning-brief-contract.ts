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
  publishedAt: string;
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
    dataSource?: { label: string; marketTime: string | null };
  }
  | { type: "callout"; tone: "insight" | "risk" | "missing"; text: string; sourceIds: string[] };

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

const RECOMMENDATION_LANGUAGE = /建议(?:买入|卖出|加仓|减仓)|买点|卖点|仓位建议|收益承诺/;

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
    case "table":
    case "callout":
      return block.sourceIds;
    case "bullets":
      return block.items.flatMap((item) => item.sourceIds);
  }
}

function requiresSources(block: BriefBlock): boolean {
  return block.type !== "heading" && !(block.type === "callout" && block.tone === "missing");
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

  if (!definition) {
    errors.push(`未知模块：${section.key}`);
  } else if (section.title !== definition.title) {
    errors.push(`${section.key}模块标题不匹配`);
  }

  section.blocks.forEach((block, index) => {
    if (requiresSources(block)) {
      appendSourceErrors(errors, `${section.title}第${index + 1}个内容块`, blockSourceIds(block), knownSourceIds);
    }
    if (RECOMMENDATION_LANGUAGE.test(blockText(block).join(""))) {
      errors.push(`${section.title}包含投资建议语言`);
    }
  });

  if (section.sourceIds.some((id) => !knownSourceIds.has(id))) {
    errors.push(`${section.title}引用了不存在的模块来源`);
  }

  if (section.status === "complete") {
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

export function validateMorningBrief(brief: MorningBrief): BriefValidationResult {
  const errors: string[] = [];
  const knownSourceIds = new Set(brief.sources.map((source) => source.id));
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
