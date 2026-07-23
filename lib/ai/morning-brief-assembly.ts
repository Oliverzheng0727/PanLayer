import {
  BRIEF_SECTION_DEFINITIONS,
  type BriefBlock,
  type BriefSection,
  type BriefSectionKey,
  type BriefSource,
  type BriefStatus,
  type MorningBrief,
  validateBriefSection,
  validateMorningBrief,
} from "./morning-brief-contract";
import type { GeneratedBriefSection } from "./morning-brief-providers";

type RejectedBriefSection = { key: BriefSectionKey; error: string };

const DISCLAIMER = "本早参仅供市场信息整理，不构成投资建议。";

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
}

function remapSourceIds(sourceIds: string[], sourceIdMap: Map<string, string>): string[] {
  return sourceIds.map((sourceId) => sourceIdMap.get(sourceId) ?? sourceId);
}

function remapBlocks(blocks: BriefBlock[], sourceIdMap: Map<string, string>): BriefBlock[] {
  return blocks.map((block) => {
    if (block.type === "heading") return block;
    if (block.type === "bullets") {
      return {
        ...block,
        items: block.items.map((item) => ({ ...item, sourceIds: remapSourceIds(item.sourceIds, sourceIdMap) })),
      };
    }
    return { ...block, sourceIds: remapSourceIds(block.sourceIds, sourceIdMap) };
  });
}

function assertValidSection(section: BriefSection, knownSourceIds: Set<string>): void {
  const validation = validateBriefSection(section, knownSourceIds);
  if (!validation.ok) throw new Error(`Invalid ${section.key} section: ${validation.errors.join("；")}`);
}

function isGeneratedResult(result: GeneratedBriefSection | RejectedBriefSection): result is GeneratedBriefSection {
  return "section" in result;
}

function briefStatus(sections: BriefSection[]): BriefStatus {
  if (sections.every((section) => section.status === "failed")) return "failed";
  if (sections.every((section) => section.status === "complete")) return "complete";
  return "partial";
}

export function failedBriefSection(key: BriefSectionKey, error: string, generatedAt: string): BriefSection {
  const definition = BRIEF_SECTION_DEFINITIONS.find((item) => item.key === key);
  if (!definition) throw new Error(`Unknown brief section key: ${key}`);
  const detail = error.trim() || "未知错误";
  return {
    key,
    title: definition.title,
    summary: "该模块生成失败，内容暂缺。",
    tags: [],
    status: "failed",
    generatedAt,
    blocks: [{ type: "callout", tone: "missing", text: `模块生成失败，内容暂缺：${detail}`, sourceIds: [] }],
    sourceIds: [],
  };
}

export function assembleMorningBrief(
  date: string,
  results: Array<GeneratedBriefSection | RejectedBriefSection>,
  generatedAt: string,
): MorningBrief {
  const resultByKey = new Map<BriefSectionKey, GeneratedBriefSection | RejectedBriefSection>();
  for (const result of results) {
    const key = isGeneratedResult(result) ? result.section.key : result.key;
    if (resultByKey.has(key)) throw new Error(`Duplicate brief section result: ${key}`);
    resultByKey.set(key, result);
  }

  const sources: BriefSource[] = [];
  const sourceIdsByCanonicalUrl = new Map<string, string>();
  const sections: BriefSection[] = [];

  for (const definition of BRIEF_SECTION_DEFINITIONS) {
    const result = resultByKey.get(definition.key);
    if (!result) {
      sections.push(failedBriefSection(definition.key, "未返回生成结果", generatedAt));
      continue;
    }
    if (!isGeneratedResult(result)) {
      sections.push(failedBriefSection(result.key, result.error, generatedAt));
      continue;
    }
    if (result.section.key !== definition.key) {
      throw new Error(`Generated section key does not match result order: ${result.section.key}`);
    }

    const localSourceIds = new Map<string, string>();
    for (const source of result.sources) {
      const canonical = canonicalUrl(source.url);
      let sourceId = sourceIdsByCanonicalUrl.get(canonical);
      if (!sourceId) {
        sourceId = `source-${sources.length + 1}`;
        sourceIdsByCanonicalUrl.set(canonical, sourceId);
        sources.push({ ...source, id: sourceId, url: canonical });
      }
      localSourceIds.set(source.id, sourceId);
    }
    const section: BriefSection = {
      ...result.section,
      blocks: remapBlocks(result.section.blocks, localSourceIds),
      sourceIds: remapSourceIds(result.section.sourceIds, localSourceIds),
    };
    assertValidSection(section, new Set(sources.map((source) => source.id)));
    sections.push(section);
  }

  const brief: MorningBrief = {
    schemaVersion: 2,
    date,
    status: briefStatus(sections),
    generatedAt,
    sections,
    sources,
    disclaimer: DISCLAIMER,
  };
  const validation = validateMorningBrief(brief);
  if (!validation.ok) throw new Error(`Invalid morning brief: ${validation.errors.join("；")}`);
  return brief;
}

export async function persistBriefSection(
  db: D1Database,
  date: string,
  model: string,
  result: BriefSection,
  attempts: number,
  error: string,
): Promise<void> {
  assertValidSection(result, new Set(result.sourceIds));
  await db.prepare(`INSERT INTO morning_brief_sections (trade_date, section_key, model, payload, status, attempts, error, generated_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(trade_date, section_key) DO UPDATE SET model=excluded.model, payload=excluded.payload, status=excluded.status, attempts=excluded.attempts, error=excluded.error, generated_at=excluded.generated_at, updated_at=excluded.updated_at`)
    .bind(date, result.key, model, JSON.stringify(result), result.status, attempts, error, result.generatedAt, new Date().toISOString())
    .run();
}

function isBriefSection(value: unknown): value is BriefSection {
  if (!value || typeof value !== "object") return false;
  const section = value as Partial<BriefSection>;
  if (!Array.isArray(section.sourceIds) || !Array.isArray(section.blocks)) return false;
  if (typeof section.key !== "string" || typeof section.title !== "string" || typeof section.summary !== "string" || !Array.isArray(section.tags) || section.tags.some((tag) => typeof tag !== "string") || typeof section.status !== "string" || typeof section.generatedAt !== "string") return false;
  return validateBriefSection(section as BriefSection, new Set(section.sourceIds)).ok;
}

export function isValidPersistedMorningBrief(value: unknown): value is MorningBrief {
  if (!value || typeof value !== "object") return false;
  const brief = value as Partial<MorningBrief>;
  if (brief.schemaVersion !== 2 || !Array.isArray(brief.sections) || brief.sections.some((section) => !isBriefSection(section))) return false;
  return validateMorningBrief(brief as MorningBrief).ok;
}

export async function readPersistedBriefSections(db: D1Database, date: string): Promise<BriefSection[]> {
  const result = await db.prepare("SELECT section_key, payload, status FROM morning_brief_sections WHERE trade_date = ? ORDER BY section_key")
    .bind(date)
    .all<{ section_key: BriefSectionKey; payload: string; status: BriefStatus }>();
  const order = new Map(BRIEF_SECTION_DEFINITIONS.map((definition, index) => [definition.key, index]));

  return (result.results ?? []).flatMap((row) => {
    try {
      const section = JSON.parse(row.payload) as unknown;
      if (!isBriefSection(section) || section.key !== row.section_key || section.status !== row.status) return [];
      return [section];
    } catch {
      return [];
    }
  }).sort((left, right) => (order.get(left.key) ?? Infinity) - (order.get(right.key) ?? Infinity));
}
