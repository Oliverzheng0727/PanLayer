import {
  BRIEF_SECTION_DEFINITIONS,
  type BriefSectionKey,
} from "../morning-brief-contract";
import {
  searchFirecrawlBriefSources,
  type FirecrawlBriefSource,
  type SearchFirecrawlBriefSourcesInput,
} from "../firecrawl-brief-fallback";
import { loadTier1NewsConfig } from "./config";
import { canonicalizeNewsUrl } from "./normalizer";
import type {
  NewsBundle,
  NewsCollectionSummary,
  NewsSourceHealth,
  NormalizedNewsItem,
  Tier2Gap,
} from "./types";

const OFFICIAL_HOSTS = new Set([
  "gov.cn", "pbc.gov.cn", "stats.gov.cn", "ndrc.gov.cn", "mof.gov.cn",
  "sse.com.cn", "szse.cn", "bse.cn", "hkex.com.hk",
  "sec.gov", "federalreserve.gov", "ecb.europa.eu",
  "nasdaq.com", "nyse.com",
]);

const SECTION_INDUSTRIES: Record<BriefSectionKey, string[]> = {
  "global-markets": ["macro"],
  "global-industry": ["ai", "semi", "robot", "auto", "energy", "bio", "space", "science", "tech"],
  domestic: ["macro", "ai", "semi", "robot", "auto", "energy", "bio", "tech", "consumer"],
  mapping: ["macro", "ai", "semi", "robot", "auto", "energy", "bio", "consumer"],
  risk: ["macro"],
};

export interface VerifyTier2CandidatesInput {
  date: string;
  sectionKey: BriefSectionKey;
  candidates: FirecrawlBriefSource[];
  redlineKeywords?: string[];
}

export interface CollectTier2Input {
  date: string;
  bundle: NewsBundle;
  apiKey: string;
  endpoint?: string;
  fetcher?: typeof fetch;
  now?: Date;
  runId?: string;
  searcher?: (input: SearchFirecrawlBriefSourcesInput) => Promise<FirecrawlBriefSource[]>;
}

function normalizedTitle(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
}

function bigrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value]);
  return new Set([...Array(value.length - 1)].map((_, index) => value.slice(index, index + 2)));
}

function similarity(left: string, right: string): number {
  const a = bigrams(normalizedTitle(left));
  const b = bigrams(normalizedTitle(right));
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap += 1;
  return a.size + b.size === 0 ? 0 : 2 * overlap / (a.size + b.size);
}

function hostnameMatches(hostname: string, candidates: Set<string>): boolean {
  return [...candidates].some((candidate) => hostname === candidate || hostname.endsWith(`.${candidate}`));
}

function registeredDomain(url: string): string {
  const hostname = new URL(url).hostname.toLowerCase();
  const pieces = hostname.split(".");
  if (hostname.endsWith(".gov.cn") || hostname.endsWith(".com.cn") || hostname.endsWith(".org.cn")) return pieces.slice(-3).join(".");
  return pieces.slice(-2).join(".");
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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

export function detectTier2Gaps(bundle: NewsBundle): Tier2Gap[] {
  const tier1Text = bundle.items
    .filter((item) => item.tier === 1 && item.verification === "verified")
    .map((item) => `${item.title}\n${item.excerpt ?? ""}`)
    .join("\n")
    .toLowerCase();
  return BRIEF_SECTION_DEFINITIONS.flatMap((definition) => {
    const requiredTerms = definition.requiredTerms.filter((term) => !tier1Text.includes(term.toLowerCase()));
    const relevantSourceIds = new Set(bundle.items
      .filter((item) => item.tier === 1 && item.verification === "verified"
        && item.industries.some((industry) => SECTION_INDUSTRIES[definition.key].includes(industry)))
      .flatMap((item) => item.sourceIds));
    if (requiredTerms.length === 0 && relevantSourceIds.size >= 3) return [];
    const terms = requiredTerms.length > 0 ? requiredTerms : [...definition.requiredTerms].slice(0, 4);
    return [{
      sectionKey: definition.key,
      requiredTerms: [...terms],
      query: `${bundle.fetchDate} ${definition.title} ${terms.join(" ")}`.slice(0, 500),
    }];
  });
}

export function verifyTier2Candidates(input: VerifyTier2CandidatesInput): NormalizedNewsItem[] {
  const candidates = input.candidates.flatMap((candidate) => {
    const canonicalUrl = canonicalizeNewsUrl(candidate.url);
    if (!canonicalUrl || !candidate.title.trim()) return [];
    return [{ ...candidate, canonicalUrl, domain: registeredDomain(canonicalUrl) }];
  });
  const consumed = new Set<number>();
  const items: NormalizedNewsItem[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    if (consumed.has(index)) continue;
    const candidate = candidates[index];
    const cluster = candidates.filter((other, otherIndex) =>
      !consumed.has(otherIndex) && similarity(candidate.title, other.title) >= 0.86);
    for (const item of cluster) consumed.add(candidates.indexOf(item));
    const distinctDomains = new Set(cluster.map((item) => item.domain));
    const official = hostnameMatches(new URL(candidate.canonicalUrl).hostname.toLowerCase(), OFFICIAL_HOSTS)
      || new URL(candidate.canonicalUrl).hostname.toLowerCase().endsWith(".gov")
      || new URL(candidate.canonicalUrl).hostname.toLowerCase().endsWith(".gov.cn");
    const haystack = cluster.map((item) => `${item.title}\n${item.content}`).join("\n").toLowerCase();
    const redline = (input.redlineKeywords ?? []).find((keyword) => haystack.includes(keyword.toLowerCase()));
    const verification = redline
      ? "filtered" as const
      : official || distinctDomains.size >= 2
        ? "verified" as const
        : "unverified" as const;
    const urls = [...new Set(cluster.map((item) => item.canonicalUrl))];
    const sourceIds = [...new Set(cluster.map((item) => `tier2_${stableHash(item.domain)}`))];
    const sourceNames = [...new Set(cluster.map((item) => item.domain))];
    items.push({
      id: `tier2_${stableHash(urls[0])}`,
      canonicalUrl: urls[0],
      title: candidate.title.trim(),
      excerpt: candidate.content.trim().slice(0, 6_000) || null,
      publishedAt: candidate.publishedAt,
      receivedAt: candidate.retrievedAt,
      fetchDate: input.date,
      sourceIds,
      sourceNames,
      industries: SECTION_INDUSTRIES[input.sectionKey],
      tier: 2,
      verification,
      corroboratingUrls: urls,
      filterReason: redline ? `redline:${redline}` : null,
    });
  }
  return items;
}

export async function collectTier2News(input: CollectTier2Input): Promise<NewsCollectionSummary> {
  const now = input.now ?? new Date();
  const startedAt = beijingTimestamp(now);
  const runId = input.runId ?? `tier2_${input.date}_${crypto.randomUUID()}`;
  const gaps = detectTier2Gaps(input.bundle);
  const searcher = input.searcher ?? searchFirecrawlBriefSources;
  const redlineKeywords = loadTier1NewsConfig().redlineKeywords;
  const sourceHealth: NewsSourceHealth[] = [];
  const items: NormalizedNewsItem[] = [];
  let rawItemCount = 0;

  for (const gap of gaps) {
    const started = Date.now();
    try {
      const candidates = await searcher({
        date: input.date,
        key: gap.sectionKey,
        query: gap.query,
        limit: 6,
        apiKey: input.apiKey,
        endpoint: input.endpoint,
        fetcher: input.fetcher,
      });
      rawItemCount += candidates.length;
      const verified = verifyTier2Candidates({
        date: input.date,
        sectionKey: gap.sectionKey,
        candidates,
        redlineKeywords,
      }).map((item) => ({ ...item, runId }));
      items.push(...verified);
      sourceHealth.push({
        sourceId: `tier2_${gap.sectionKey}`,
        name: `Firecrawl ${gap.sectionKey}`,
        url: `https://api.firecrawl.dev/v2/search?section=${gap.sectionKey}`,
        tier: 2,
        industries: SECTION_INDUSTRIES[gap.sectionKey],
        status: "complete",
        latencyMs: Date.now() - started,
        rawCount: candidates.length,
        keptCount: verified.filter((item) => item.verification === "verified").length,
        error: null,
      });
    } catch (error) {
      sourceHealth.push({
        sourceId: `tier2_${gap.sectionKey}`,
        name: `Firecrawl ${gap.sectionKey}`,
        url: `https://api.firecrawl.dev/v2/search?section=${gap.sectionKey}`,
        tier: 2,
        industries: SECTION_INDUSTRIES[gap.sectionKey],
        status: "failed",
        latencyMs: Date.now() - started,
        rawCount: 0,
        keptCount: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const sourceSuccess = sourceHealth.filter((health) => health.status === "complete").length;
  const status = gaps.length === 0 || sourceSuccess === gaps.length
    ? "complete" as const
    : sourceSuccess === 0
      ? "failed" as const
      : "partial" as const;
  const filteredItemCount = items.filter((item) => item.verification === "filtered").length;
  const keptItemCount = items.filter((item) => item.verification === "verified").length;
  const finishedAt = beijingTimestamp(new Date());
  return {
    runId,
    fetchDate: input.date,
    tier: 2,
    transport: "firecrawl",
    status,
    startedAt,
    finishedAt,
    sourceTotal: gaps.length,
    sourceSuccess,
    rawItemCount,
    keptItemCount,
    filteredItemCount,
    items,
    sourceHealth,
    errors: sourceHealth.flatMap((health) => health.error ? [`${health.name}: ${health.error}`] : []),
  };
}
