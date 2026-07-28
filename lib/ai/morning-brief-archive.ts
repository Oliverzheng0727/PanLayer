import type { BriefBlock, BriefSection, MorningBrief } from "./morning-brief-contract";

export interface MorningBriefArchiveModule {
  key: BriefSection["key"];
  title: string;
  status: BriefSection["status"];
  itemCount: number;
  sourceCount: number;
}

export interface MorningBriefArchiveSummary {
  date: string;
  status: MorningBrief["status"];
  schemaVersion: MorningBrief["schemaVersion"];
  generatedAt: string;
  sourceCount: number;
  verifiedFacts: number | null;
  crossCheckedFacts: number | null;
  completeModules: number;
  partialModules: number;
  failedModules: number;
  modules: MorningBriefArchiveModule[];
}

function blockItemCount(block: BriefBlock): number {
  if (block.type === "heading") return 0;
  if (block.type === "bullets") return block.items.length;
  return 1;
}

function blockSourceIds(block: BriefBlock): string[] {
  if (block.type === "heading") return [];
  if (block.type === "bullets") return block.items.flatMap((item) => item.sourceIds);
  return block.sourceIds;
}

export function summarizeMorningBrief(brief: MorningBrief): MorningBriefArchiveSummary {
  const modules = brief.sections.map((section) => ({
    key: section.key,
    title: section.title,
    status: section.status,
    itemCount: section.blocks.reduce((total, block) => total + blockItemCount(block), 0),
    sourceCount: new Set([
      ...section.sourceIds,
      ...section.blocks.flatMap(blockSourceIds),
    ]).size,
  }));

  return {
    date: brief.date,
    status: brief.status,
    schemaVersion: brief.schemaVersion,
    generatedAt: brief.generatedAt,
    sourceCount: brief.sources.length,
    verifiedFacts: brief.coverage?.verifiedFacts ?? null,
    crossCheckedFacts: brief.coverage?.crossCheckedFacts ?? null,
    completeModules: modules.filter((module) => module.status === "complete").length,
    partialModules: modules.filter((module) => module.status === "partial").length,
    failedModules: modules.filter((module) => module.status === "failed").length,
    modules,
  };
}

export function pruneBriefArchive(
  briefs: MorningBrief[],
  cutoffDate: string,
  limit = 93,
): MorningBrief[] {
  return briefs
    .filter((brief) => brief.date >= cutoffDate)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, Math.max(1, limit));
}
