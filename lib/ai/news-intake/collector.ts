import { normalizeFeedItems } from "./normalizer";
import { parseFeedXml } from "./parser";
import type {
  NewsCollectionSummary,
  NewsSourceHealth,
  ParsedFeedItem,
  Tier1NewsConfig,
  Tier1SourceConfig,
} from "./types";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface CollectTier1Input {
  date: string;
  config: Tier1NewsConfig;
  fetcher?: typeof fetch;
  now?: Date;
  concurrency?: number;
  runId?: string;
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

function isPrivateHost(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "localhost" || value.endsWith(".localhost") || value === "::1") return true;
  if (/^127\./.test(value) || /^10\./.test(value) || /^192\.168\./.test(value) || /^169\.254\./.test(value)) return true;
  const match = value.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return value === "0.0.0.0" || value === "::";
}

class SourceFetchError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

async function fetchSource(
  source: Tier1SourceConfig,
  fetcher: typeof fetch,
  timeoutMs: number,
  perSource: number,
): Promise<ParsedFeedItem[]> {
  const sourceUrl = new URL(source.url);
  if (isPrivateHost(sourceUrl.hostname)) throw new SourceFetchError("private/local source hosts are not allowed", false);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(source.url, {
      headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new SourceFetchError(`HTTP ${response.status}`, response.status >= 500 || response.status === 429);
    if (sourceUrl.protocol === "http:") {
      const finalUrl = response.url ? new URL(response.url) : sourceUrl;
      if (finalUrl.protocol !== "https:") throw new SourceFetchError("HTTP source did not redirect to HTTPS", false);
    }
    if (response.url && isPrivateHost(new URL(response.url).hostname)) throw new SourceFetchError("redirected to a private/local host", false);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_RESPONSE_BYTES) throw new SourceFetchError("RSS response exceeds 2 MB", false);
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_RESPONSE_BYTES) throw new SourceFetchError("RSS response exceeds 2 MB", false);
    return parseFeedXml(new TextDecoder().decode(body)).slice(0, perSource);
  } catch (error) {
    if (controller.signal.aborted) throw new SourceFetchError(`RSS request timed out after ${timeoutMs}ms`, true);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithOneRetry(
  source: Tier1SourceConfig,
  fetcher: typeof fetch,
  timeoutMs: number,
  perSource: number,
): Promise<ParsedFeedItem[]> {
  try {
    return await fetchSource(source, fetcher, timeoutMs, perSource);
  } catch (error) {
    if (!(error instanceof SourceFetchError) || !error.retryable) throw error;
    return fetchSource(source, fetcher, timeoutMs, perSource);
  }
}

export async function collectTier1News(input: CollectTier1Input): Promise<NewsCollectionSummary> {
  const now = input.now ?? new Date();
  const startedAt = beijingTimestamp(now);
  const runId = input.runId ?? `tier1_${input.date}_${crypto.randomUUID()}`;
  const fetcher = input.fetcher ?? fetch;
  const concurrency = Math.max(1, Math.min(input.concurrency ?? 8, 8));
  const feeds: Array<{
    sourceId: string;
    sourceName: string;
    industries: string[];
    items: ParsedFeedItem[];
  }> = [];
  const sourceHealth: NewsSourceHealth[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= input.config.sources.length) return;
      const source = input.config.sources[index];
      const started = Date.now();
      try {
        const items = await fetchWithOneRetry(
          source,
          fetcher,
          input.config.fetch.timeoutMs,
          input.config.fetch.perSource,
        );
        feeds.push({ sourceId: source.id, sourceName: source.name, industries: source.industries, items });
        sourceHealth.push({
          sourceId: source.id,
          name: source.name,
          url: source.url,
          tier: 1,
          industries: source.industries,
          status: "complete",
          latencyMs: Date.now() - started,
          rawCount: items.length,
          keptCount: 0,
          error: null,
        });
      } catch (error) {
        sourceHealth.push({
          sourceId: source.id,
          name: source.name,
          url: source.url,
          tier: 1,
          industries: source.industries,
          status: "failed",
          latencyMs: Date.now() - started,
          rawCount: 0,
          keptCount: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, input.config.sources.length || 1) }, () => worker()));

  const receivedAt = beijingTimestamp(now);
  const items = normalizeFeedItems({
    fetchDate: input.date,
    receivedAt,
    recentDays: input.config.fetch.recentDays,
    redlineKeywords: input.config.redlineKeywords,
    feeds,
  }).map((item) => ({ ...item, runId }));
  for (const health of sourceHealth) {
    health.keptCount = items.filter((item) => item.verification !== "filtered" && item.sourceIds.includes(health.sourceId)).length;
  }
  const sourceSuccess = sourceHealth.filter((source) => source.status === "complete").length;
  const filteredItemCount = items.filter((item) => item.verification === "filtered").length;
  const keptItemCount = items.length - filteredItemCount;
  const status = sourceSuccess === 0 ? "failed" : sourceSuccess === input.config.sources.length ? "complete" : "partial";
  const finishedAt = beijingTimestamp(new Date());
  const errors = sourceHealth.flatMap((source) => source.error ? [`${source.name}: ${source.error}`] : []);
  return {
    runId,
    fetchDate: input.date,
    tier: 1,
    transport: "rss",
    status,
    startedAt,
    finishedAt,
    sourceTotal: input.config.sources.length,
    sourceSuccess,
    rawItemCount: feeds.reduce((total, feed) => total + feed.items.length, 0),
    keptItemCount,
    filteredItemCount,
    items,
    sourceHealth,
    errors,
  };
}
