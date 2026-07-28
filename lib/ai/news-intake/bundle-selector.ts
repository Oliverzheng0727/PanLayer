import {
  BRIEF_SECTION_DEFINITIONS_V3,
  type BriefSectionKey,
} from "../morning-brief-contract";
import type { FirecrawlBriefSource } from "../firecrawl-brief-fallback";
import type { NewsBundle, NewsTier, NewsVerification, NormalizedNewsItem } from "./types";

export interface SelectedBriefSource extends FirecrawlBriefSource {
  tier: NewsTier;
  verification: NewsVerification;
}

const SECTION_INDUSTRIES: Record<BriefSectionKey, Set<string>> = {
  "global-markets": new Set(["macro"]),
  "global-industry": new Set(["ai", "semi", "robot", "auto", "energy", "bio", "space", "science", "tech"]),
  domestic: new Set(["macro", "ai", "semi", "robot", "auto", "energy", "bio", "tech", "consumer"]),
  technical: new Set(["macro", "tech", "semi"]),
  funding: new Set(["macro", "finance"]),
  mapping: new Set(["macro", "ai", "semi", "robot", "auto", "energy", "bio", "consumer"]),
  risk: new Set(["macro", "security"]),
};

function relevance(item: NormalizedNewsItem, key: BriefSectionKey): number {
  const definition = BRIEF_SECTION_DEFINITIONS_V3.find((section) => section.key === key);
  const text = `${item.title}\n${item.excerpt ?? ""}`.toLowerCase();
  const termScore = definition?.requiredTerms.reduce((score, term) => score + (text.includes(term.toLowerCase()) ? 2 : 0), 0) ?? 0;
  const industryScore = item.industries.some((industry) => SECTION_INDUSTRIES[key].has(industry)) ? 3 : 0;
  return termScore + industryScore;
}

function selected(items: NormalizedNewsItem[], key: BriefSectionKey, limit: number): NormalizedNewsItem[] {
  return items
    .filter((item) => item.verification === "verified")
    .map((item) => ({ item, score: relevance(item, key) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) =>
      right.score - left.score
      || String(right.item.publishedAt ?? "").localeCompare(String(left.item.publishedAt ?? ""))
      || right.item.sourceIds.length - left.item.sourceIds.length
      || left.item.id.localeCompare(right.item.id))
    .slice(0, limit)
    .map(({ item }) => item);
}

export function selectBriefSourceBundle(
  bundle: NewsBundle,
  key: BriefSectionKey,
  expectedDate = bundle.fetchDate,
): SelectedBriefSource[] {
  if (bundle.fetchDate !== expectedDate) return [];
  const tier1 = selected(bundle.items.filter((item) => item.tier === 1), key, 12);
  const tier2 = selected(bundle.items.filter((item) => item.tier === 2), key, 6);
  const seen = new Set<string>();
  return [...tier1, ...tier2].flatMap((item) => {
    if (seen.has(item.id)) return [];
    seen.add(item.id);
    return [{
      id: item.id,
      title: item.title,
      url: item.canonicalUrl,
      publishedAt: item.publishedAt,
      retrievedAt: item.receivedAt,
      content: (item.excerpt || item.title).slice(0, 900),
      tier: item.tier,
      verification: item.verification,
    }];
  });
}

export function selectVerifiedBriefFallbackSources(
  bundle: NewsBundle,
  expectedDate = bundle.fetchDate,
  limit = 8,
): SelectedBriefSource[] {
  if (bundle.fetchDate !== expectedDate) return [];
  const seen = new Set<string>();
  return bundle.items
    .filter((item) => item.verification === "verified")
    .sort((left, right) =>
      String(right.publishedAt ?? "").localeCompare(String(left.publishedAt ?? ""))
      || right.sourceIds.length - left.sourceIds.length
      || left.id.localeCompare(right.id))
    .flatMap((item) => {
      if (seen.has(item.id)) return [];
      seen.add(item.id);
      return [{
        id: item.id,
        title: item.title,
        url: item.canonicalUrl,
        publishedAt: item.publishedAt,
        retrievedAt: item.receivedAt,
        content: (item.excerpt || item.title).slice(0, 900),
        tier: item.tier,
        verification: item.verification,
      }];
    })
    .slice(0, Math.max(1, limit));
}
