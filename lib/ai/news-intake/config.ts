import rawConfig from "../../../config/tier1-rss-sources.json";
import type { Tier1Industry, Tier1NewsConfig, Tier1SourceConfig } from "./types";

type RawConfig = {
  fetch?: { per_source?: unknown; timeout?: unknown; recent_days?: unknown };
  industries?: Array<{ key?: unknown; name?: unknown; accent?: unknown }>;
  sources?: Array<{ name?: unknown; hint?: unknown; type?: unknown; url?: unknown }>;
  redline_keywords?: unknown;
};

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function sourceId(url: string): string {
  let hash = 0x811c9dc5;
  for (const char of url) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `rss_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function loadTier1NewsConfig(): Tier1NewsConfig {
  const value = rawConfig as RawConfig;
  const industries: Tier1Industry[] = (value.industries ?? []).flatMap((item) =>
    typeof item.key === "string" && typeof item.name === "string" && typeof item.accent === "string"
      ? [{ key: item.key, name: item.name, accent: item.accent }]
      : []);
  const knownIndustries = new Set(industries.map((item) => item.key));
  const byUrl = new Map<string, Tier1SourceConfig>();

  for (const item of value.sources ?? []) {
    if (item.type !== "rss" || typeof item.name !== "string" || typeof item.hint !== "string" || typeof item.url !== "string") continue;
    if (!knownIndustries.has(item.hint)) continue;
    let normalized: string;
    try {
      const url = new URL(item.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      url.hash = "";
      normalized = url.href;
    } catch {
      continue;
    }
    const existing = byUrl.get(normalized);
    if (existing) {
      if (!existing.industries.includes(item.hint)) existing.industries.push(item.hint);
      continue;
    }
    byUrl.set(normalized, {
      id: sourceId(normalized),
      name: item.name,
      url: normalized,
      type: "rss",
      industries: [item.hint],
    });
  }

  const keywords = Array.isArray(value.redline_keywords)
    ? value.redline_keywords.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  return {
    fetch: {
      perSource: positiveInteger(value.fetch?.per_source, 6),
      timeoutMs: positiveInteger(value.fetch?.timeout, 15) * 1_000,
      recentDays: positiveInteger(value.fetch?.recent_days, 7),
    },
    industries,
    sources: [...byUrl.values()],
    redlineKeywords: keywords,
  };
}
