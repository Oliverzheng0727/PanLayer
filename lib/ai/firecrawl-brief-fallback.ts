import {
  BRIEF_SECTION_DEFINITIONS_V3,
  type BriefSectionKey,
} from "./morning-brief-contract";

export const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const FIRECRAWL_TIMEOUT_MS = 10_000;
const FIRECRAWL_BODY_TIMEOUT_MS = 9_000;
const DEADLINE_SAFETY_MS = 1_000;
const MAX_SOURCE_CONTENT = 6_000;
const MAX_BUNDLE_CONTENT = 24_000;
const MIN_SOURCE_CONTENT = 120;

const BLOCKED_HOSTS = new Set([
  "facebook.com",
  "x.com",
  "twitter.com",
  "instagram.com",
  "tiktok.com",
  "google.com",
  "bing.com",
  "guba.eastmoney.com",
  "gubaf10.eastmoney.com",
]);

const OFFICIAL_HOSTS = new Set([
  "sec.gov",
  "nasdaq.com",
  "nyse.com",
  "sse.com.cn",
  "szse.cn",
  "bse.cn",
  "hkex.com.hk",
  "pbc.gov.cn",
  "stats.gov.cn",
  "gov.cn",
]);

const RECOGNIZED_MEDIA_HOSTS = new Set([
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "cnbc.com",
  "eastmoney.com",
  "sina.com.cn",
  "qq.com",
  "163.com",
]);

export interface FirecrawlBriefSource {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  retrievedAt: string;
  content: string;
}

export interface SearchFirecrawlBriefSourcesInput {
  date: string;
  key: BriefSectionKey;
  apiKey: string;
  query?: string;
  limit?: number;
  fetcher?: typeof fetch;
  endpoint?: string;
  deadlineAt?: number;
}

type FirecrawlResult = {
  title?: unknown;
  url?: unknown;
  markdown?: unknown;
  metadata?: unknown;
};

type FirecrawlPayload = {
  success?: boolean;
  data?: {
    news?: unknown;
    web?: unknown;
  };
};

export function buildFirecrawlBriefQuery(date: string, key: BriefSectionKey): string {
  const definition = BRIEF_SECTION_DEFINITIONS_V3.find((item) => item.key === key);
  if (!definition) throw new Error(`Unknown brief section key: ${key}`);
  // Keep the former five-module alias in the query for search providers that
  // have indexed older PanLayer briefs. The output contract remains V3.
  const legacyAlias = key === "global-markets" ? "全球外围市场全景" : "";
  return `${date} ${definition.title} ${legacyAlias} A股隔夜早参 ${definition.requiredTerms.join(" ")}`.replace(/\s+/g, " ").slice(0, 500);
}

function cleanText(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim()
    : "";
}

function hostnameMatches(hostname: string, candidates: Set<string>): boolean {
  return [...candidates].some((candidate) => hostname === candidate || hostname.endsWith(`.${candidate}`));
}

function normalizedUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const hostname = url.hostname.toLowerCase();
    if (hostnameMatches(hostname, BLOCKED_HOSTS)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function sourceQuality(url: string): number {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostnameMatches(hostname, OFFICIAL_HOSTS) || hostname.endsWith(".gov") || hostname.endsWith(".gov.cn")) return 3;
  if (hostnameMatches(hostname, RECOGNIZED_MEDIA_HOSTS)) return 2;
  return 1;
}

function publishedAt(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  for (const key of ["publishedTime", "publishedDate", "date", "published_at"]) {
    const value = record[key];
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  }
  return null;
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

function resultArray(value: unknown): FirecrawlResult[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is FirecrawlResult => typeof item === "object" && item !== null && !Array.isArray(item));
}

function resolveSearchEndpoint(value?: string): string {
  if (!value) return FIRECRAWL_SEARCH_URL;
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith("/v2/search")) url.pathname = `${path}/v2/search`;
  url.search = "";
  url.hash = "";
  return url.href;
}

async function readJsonWithAbort(response: Response, signal: AbortSignal): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const settle = (callback: (value: unknown) => void, value: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => {
      void response.body?.cancel().catch(() => undefined);
      settle(reject, new Error("response body read aborted"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    void response.json().then((value) => settle(resolve, value), (error) => settle(reject, error));
  });
}

export async function searchFirecrawlBriefSources(
  input: SearchFirecrawlBriefSourcesInput,
): Promise<FirecrawlBriefSource[]> {
  if (!input.apiKey) throw new Error("FIRECRAWL_API_KEY is not configured");
  const remaining = input.deadlineAt === undefined
    ? FIRECRAWL_TIMEOUT_MS
    : input.deadlineAt - Date.now() - DEADLINE_SAFETY_MS;
  if (remaining <= 0) throw new Error("Morning brief deadline budget exhausted before Firecrawl request");
  const timeoutMs = Math.min(FIRECRAWL_TIMEOUT_MS, remaining);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (input.fetcher ?? fetch)(resolveSearchEndpoint(input.endpoint), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        query: (input.query?.trim() || buildFirecrawlBriefQuery(input.date, input.key)).slice(0, 500),
        sources: [{ type: "news" }, { type: "web" }],
        limit: Math.max(1, Math.min(input.limit ?? 5, 10)),
        tbs: "qdr:w",
        country: "CN",
        ignoreInvalidURLs: true,
        timeout: FIRECRAWL_BODY_TIMEOUT_MS,
        scrapeOptions: {
          formats: ["markdown"],
          onlyMainContent: true,
          excludeTags: ["nav", "footer"],
        },
      }),
      signal: controller.signal,
    });
    const payload = await readJsonWithAbort(response, controller.signal) as FirecrawlPayload;
    if (!response.ok || payload.success !== true) throw new Error(`Firecrawl search failed with HTTP ${response.status}`);

    const retrievedAt = beijingTimestamp(new Date());
    const seen = new Set<string>();
    let remainingCharacters = MAX_BUNDLE_CONTENT;
    const candidates = [...resultArray(payload.data?.news), ...resultArray(payload.data?.web)]
      .flatMap((item) => {
        const url = normalizedUrl(item.url);
        const title = cleanText(item.title);
        const markdown = cleanText(item.markdown);
        return url && title && markdown.length >= MIN_SOURCE_CONTENT
          ? [{ item, url, title, markdown, quality: sourceQuality(url) }]
          : [];
      })
      .sort((left, right) => right.quality - left.quality);

    return candidates.flatMap(({ item, url, title, markdown }) => {
      if (remainingCharacters <= 0 || seen.has(url)) return [];
      seen.add(url);
      const content = markdown.slice(0, Math.min(MAX_SOURCE_CONTENT, remainingCharacters));
      remainingCharacters -= content.length;
      return [{
        id: `firecrawl_${input.key}_${seen.size}`,
        title,
        url,
        publishedAt: publishedAt(item.metadata),
        retrievedAt,
        content,
      }];
    }).slice(0, 5);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Firecrawl request timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
