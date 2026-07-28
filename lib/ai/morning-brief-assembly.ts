import {
  BRIEF_SECTION_DEFINITIONS_V3,
  LEGACY_BRIEF_SECTION_DEFINITIONS,
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
type MorningBriefLeaseGuard = { renew: () => Promise<boolean> };

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
    if (block.type === "news-item") return { ...block, sourceIds: remapSourceIds(block.sourceIds, sourceIdMap) };
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

export function failedBriefSection(key: BriefSectionKey, error: string, generatedAt: string, definitions = (key === "technical" || key === "funding" ? BRIEF_SECTION_DEFINITIONS_V3 : LEGACY_BRIEF_SECTION_DEFINITIONS)): BriefSection {
  const definition = definitions.find((item) => item.key === key);
  if (!definition) throw new Error(`Unknown brief section key: ${key}`);
  const detail = error.trim() || "未知错误";
  return {
    key,
    title: definition.title,
    summary: "该模块暂未完成，系统将自动重试。",
    tags: [],
    status: "failed",
    generatedAt,
    blocks: [{ type: "callout", tone: "missing", text: `本模块正在等待自动补全；当前失败原因：${detail}`, sourceIds: [] }],
    sourceIds: [],
  };
}

export function assembleMorningBrief(
  date: string,
  results: Array<GeneratedBriefSection | RejectedBriefSection>,
  generatedAt: string,
  metadata: Pick<MorningBrief, "sourceWindow" | "coverage"> = {},
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
  const useV3 = Boolean(metadata.sourceWindow || metadata.coverage)
    || results.some((result) => {
      const key = isGeneratedResult(result) ? result.section.key : result.key;
      return key === "technical" || key === "funding";
    });
  const definitions = useV3 ? BRIEF_SECTION_DEFINITIONS_V3 : LEGACY_BRIEF_SECTION_DEFINITIONS;

  for (const definition of definitions) {
    const result = resultByKey.get(definition.key);
    if (!result) {
      sections.push(failedBriefSection(definition.key, "未返回生成结果", generatedAt, definitions));
      continue;
    }
    if (!isGeneratedResult(result)) {
      sections.push(failedBriefSection(result.key, result.error, generatedAt, definitions));
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
      // The server-owned definition keeps the public module labels stable;
      // model output cannot silently invent a new label. A persisted V2
      // title is retained during compatibility reads so older providers can
      // still be assembled while their content is migrated.
      title: LEGACY_BRIEF_SECTION_DEFINITIONS.some((legacy) => legacy.key === definition.key && legacy.title === result.section.title)
        ? result.section.title
        : definition.title,
      blocks: remapBlocks(result.section.blocks, localSourceIds),
      sourceIds: remapSourceIds(result.section.sourceIds, localSourceIds),
    };
    assertValidSection(section, new Set(sources.map((source) => source.id)));
    sections.push(section);
  }

  const brief: MorningBrief = {
    schemaVersion: useV3 ? 3 : 2,
    date,
    status: briefStatus(sections),
    generatedAt,
    sections,
    sources,
    disclaimer: DISCLAIMER,
    ...metadata,
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
  sources: BriefSource[] = [],
  lease?: MorningBriefLeaseGuard,
): Promise<void> {
  const sourceIds = new Set(sources.map((source) => source.id));
  assertValidSection(result, sourceIds);
  const payload = { version: 1, section: result, sources };
  if (lease && !await lease.renew()) {
    const leaseError = new Error("Morning brief lease is no longer current");
    leaseError.name = "LeaseLostError";
    throw leaseError;
  }
  await db.prepare(`INSERT INTO morning_brief_sections (trade_date, section_key, model, payload, status, attempts, error, generated_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(trade_date, section_key) DO UPDATE SET model=excluded.model, payload=excluded.payload, status=excluded.status, attempts=excluded.attempts, error=excluded.error, generated_at=excluded.generated_at, updated_at=excluded.updated_at`)
    .bind(date, result.key, model, JSON.stringify(payload), result.status, attempts, error, result.generatedAt, new Date().toISOString())
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
  if ((brief.schemaVersion !== 2 && brief.schemaVersion !== 3) || !Array.isArray(brief.sections) || brief.sections.some((section) => !isBriefSection(section))) return false;
  return validateMorningBrief(brief as MorningBrief).ok;
}

function isSourceDirectory(value: unknown): value is BriefSource[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((source) => {
    if (!source || typeof source !== "object") return false;
    const item = source as BriefSource;
    if (typeof item.id !== "string" || !item.id || ids.has(item.id) || typeof item.title !== "string" || !item.title || typeof item.url !== "string" || typeof item.retrievedAt !== "string" || !item.retrievedAt.endsWith("+08:00") || Number.isNaN(Date.parse(item.retrievedAt)) || (item.publishedAt !== null && (typeof item.publishedAt !== "string" || Number.isNaN(Date.parse(item.publishedAt))))) return false;
    try { const url = new URL(item.url); if (url.protocol !== "https:" && url.protocol !== "http:") return false; } catch { return false; }
    ids.add(item.id);
    return true;
  });
}

function isPersistedEnvelope(value: unknown): value is { version: 1; section: BriefSection; sources: BriefSource[] } {
  if (!value || typeof value !== "object") return false;
  const envelope = value as { version?: unknown; section?: unknown; sources?: unknown };
  return envelope.version === 1 && isBriefSection(envelope.section) && isSourceDirectory(envelope.sources)
    && validateBriefSection(envelope.section, new Set(envelope.sources.map((source) => source.id))).ok;
}

export async function readPersistedBriefSections(db: D1Database, date: string): Promise<GeneratedBriefSection[]> {
  const result = await db.prepare("SELECT section_key, payload, status FROM morning_brief_sections WHERE trade_date = ? ORDER BY section_key")
    .bind(date)
    .all<{ section_key: BriefSectionKey; payload: string; status: BriefStatus }>();
  const order = new Map([...LEGACY_BRIEF_SECTION_DEFINITIONS, ...BRIEF_SECTION_DEFINITIONS_V3].map((definition, index) => [definition.key, index]));

  return (result.results ?? []).flatMap((row) => {
    try {
      const envelope = JSON.parse(row.payload) as unknown;
      if (!isPersistedEnvelope(envelope) || envelope.section.key !== row.section_key || envelope.section.status !== row.status) return [];
      return [{ section: envelope.section, sources: envelope.sources }];
    } catch {
      return [];
    }
  }).sort((left, right) => (order.get(left.section.key) ?? Infinity) - (order.get(right.section.key) ?? Infinity));
}
