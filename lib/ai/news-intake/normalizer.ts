import type { NormalizedNewsItem, ParsedFeedItem } from "./types";

const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source", "spm",
]);

export interface NormalizeFeedInput {
  fetchDate: string;
  receivedAt: string;
  recentDays: number;
  redlineKeywords: string[];
  feeds: Array<{
    sourceId: string;
    sourceName: string;
    industries: string[];
    items: ParsedFeedItem[];
  }>;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function canonicalizeNewsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function normalizedTitle(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
}

function bigrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value]);
  return new Set([...Array(value.length - 1)].map((_, index) => value.slice(index, index + 2)));
}

function titleSimilarity(left: string, right: string): number {
  const a = bigrams(normalizedTitle(left));
  const b = bigrams(normalizedTitle(right));
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

function merge(target: NormalizedNewsItem, candidate: NormalizedNewsItem): void {
  target.sourceIds = [...new Set([...target.sourceIds, ...candidate.sourceIds])];
  target.sourceNames = [...new Set([...target.sourceNames, ...candidate.sourceNames])];
  target.industries = [...new Set([...target.industries, ...candidate.industries])];
  target.corroboratingUrls = [...new Set([...target.corroboratingUrls, candidate.canonicalUrl, ...candidate.corroboratingUrls])];
  if ((!target.excerpt || target.excerpt.length < (candidate.excerpt?.length ?? 0)) && candidate.excerpt) target.excerpt = candidate.excerpt;
  if ((!target.publishedAt || (candidate.publishedAt && candidate.publishedAt > target.publishedAt))) target.publishedAt = candidate.publishedAt;
  if (target.verification !== "filtered" && candidate.verification === "filtered") {
    target.verification = "filtered";
    target.filterReason = candidate.filterReason;
  }
}

export function normalizeFeedItems(input: NormalizeFeedInput): NormalizedNewsItem[] {
  const earliest = new Date(`${input.fetchDate}T00:00:00+08:00`).getTime() - input.recentDays * 24 * 60 * 60 * 1_000;
  const byUrl = new Map<string, NormalizedNewsItem>();
  const result: NormalizedNewsItem[] = [];

  for (const feed of input.feeds) {
    for (const raw of feed.items) {
      const canonicalUrl = canonicalizeNewsUrl(raw.url);
      if (!canonicalUrl || !raw.title.trim()) continue;
      if (raw.publishedAt && Date.parse(raw.publishedAt) < earliest) continue;
      const haystack = `${raw.title}\n${raw.excerpt ?? ""}`.toLowerCase();
      const redline = input.redlineKeywords.find((keyword) => haystack.includes(keyword.toLowerCase()));
      const candidate: NormalizedNewsItem = {
        id: `news_${stableHash(canonicalUrl)}`,
        canonicalUrl,
        title: raw.title.trim(),
        excerpt: raw.excerpt?.trim() || null,
        publishedAt: raw.publishedAt,
        receivedAt: input.receivedAt,
        fetchDate: input.fetchDate,
        sourceIds: [feed.sourceId],
        sourceNames: [feed.sourceName],
        industries: [...new Set(feed.industries)],
        tier: 1,
        verification: redline ? "filtered" : "verified",
        corroboratingUrls: [],
        filterReason: redline ? `redline:${redline}` : null,
      };
      const exact = byUrl.get(canonicalUrl);
      if (exact) {
        merge(exact, candidate);
        continue;
      }
      const similar = result.find((item) => titleSimilarity(item.title, candidate.title) >= 0.86);
      if (similar) {
        merge(similar, candidate);
        byUrl.set(canonicalUrl, similar);
        continue;
      }
      byUrl.set(canonicalUrl, candidate);
      result.push(candidate);
    }
  }
  return result;
}
