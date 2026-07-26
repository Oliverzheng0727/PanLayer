import type { BriefSectionKey } from "../morning-brief-contract";

export type NewsTier = 1 | 2;
export type NewsVerification = "verified" | "unverified" | "filtered";
export type NewsCollectionStatus = "complete" | "partial" | "failed";

export interface Tier1Industry {
  key: string;
  name: string;
  accent: string;
}

export interface Tier1SourceConfig {
  id: string;
  name: string;
  url: string;
  type: "rss";
  industries: string[];
}

export interface Tier1NewsConfig {
  fetch: {
    perSource: number;
    timeoutMs: number;
    recentDays: number;
  };
  industries: Tier1Industry[];
  sources: Tier1SourceConfig[];
  redlineKeywords: string[];
}

export interface ParsedFeedItem {
  title: string;
  url: string;
  excerpt: string | null;
  publishedAt: string | null;
}

export interface NormalizedNewsItem {
  id: string;
  canonicalUrl: string;
  title: string;
  excerpt: string | null;
  publishedAt: string | null;
  receivedAt: string;
  fetchDate: string;
  runId?: string;
  sourceIds: string[];
  sourceNames: string[];
  industries: string[];
  tier: NewsTier;
  verification: NewsVerification;
  corroboratingUrls: string[];
  filterReason: string | null;
}

export interface NewsSourceHealth {
  sourceId: string;
  name: string;
  url: string;
  tier: NewsTier;
  industries: string[];
  status: "complete" | "failed";
  latencyMs: number;
  rawCount: number;
  keptCount: number;
  error: string | null;
}

export interface NewsCollectionSummary {
  runId: string;
  fetchDate: string;
  tier: NewsTier;
  transport: "rss" | "firecrawl";
  status: NewsCollectionStatus;
  startedAt: string;
  finishedAt: string;
  sourceTotal: number;
  sourceSuccess: number;
  rawItemCount: number;
  keptItemCount: number;
  filteredItemCount: number;
  items: NormalizedNewsItem[];
  sourceHealth: NewsSourceHealth[];
  errors: string[];
}

export interface NewsBundle {
  fetchDate: string;
  collectedAt: string | null;
  status: NewsCollectionStatus | "unavailable";
  items: NormalizedNewsItem[];
  sourceTotal?: number;
  sourceSuccess?: number;
  failedSources?: number;
}

export interface Tier2Gap {
  sectionKey: BriefSectionKey;
  requiredTerms: string[];
  query: string;
}
