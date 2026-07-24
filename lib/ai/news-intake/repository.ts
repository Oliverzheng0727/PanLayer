import type {
  NewsBundle,
  NewsCollectionStatus,
  NewsCollectionSummary,
  NormalizedNewsItem,
} from "./types";

export const NEWS_INTAKE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS brief_sources (
    source_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    industry_keys_json TEXT NOT NULL,
    source_tier INTEGER NOT NULL,
    transport TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_status TEXT,
    last_success_at TEXT,
    last_error TEXT,
    latency_ms INTEGER,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS brief_sources_url_tier_idx ON brief_sources(url, source_tier)`,
  `CREATE TABLE IF NOT EXISTS brief_items (
    item_id TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    title TEXT NOT NULL,
    excerpt TEXT,
    published_at TEXT,
    received_at TEXT NOT NULL,
    fetch_date TEXT NOT NULL,
    run_id TEXT NOT NULL,
    source_ids_json TEXT NOT NULL,
    source_names_json TEXT NOT NULL,
    industry_keys_json TEXT NOT NULL,
    source_tier INTEGER NOT NULL,
    verification_status TEXT NOT NULL,
    corroborating_urls_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    filter_status TEXT NOT NULL,
    filter_reason TEXT,
    PRIMARY KEY (fetch_date, item_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS brief_items_date_url_idx ON brief_items(fetch_date, canonical_url)`,
  `CREATE INDEX IF NOT EXISTS brief_items_date_run_idx ON brief_items(fetch_date, run_id)`,
  `CREATE TABLE IF NOT EXISTS brief_fetch_runs (
    run_id TEXT PRIMARY KEY,
    fetch_date TEXT NOT NULL,
    source_tier INTEGER NOT NULL,
    transport TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    source_total INTEGER NOT NULL,
    source_success INTEGER NOT NULL,
    raw_item_count INTEGER NOT NULL,
    kept_item_count INTEGER NOT NULL,
    filtered_item_count INTEGER NOT NULL,
    error_summary_json TEXT NOT NULL DEFAULT '[]'
  )`,
  `CREATE INDEX IF NOT EXISTS brief_fetch_runs_date_tier_idx ON brief_fetch_runs(fetch_date, source_tier, finished_at DESC)`,
];

export async function ensureNewsIntakeSchema(db: D1Database): Promise<void> {
  await db.batch(NEWS_INTAKE_SCHEMA_STATEMENTS.map((statement) => db.prepare(statement)));
}

function contentHash(item: NormalizedNewsItem): string {
  let hash = 0x811c9dc5;
  const value = `${item.title}\n${item.excerpt ?? ""}`;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function persistNewsCollection(db: D1Database, summary: NewsCollectionSummary): Promise<void> {
  const sourceStatements = summary.sourceHealth.map((source) => db.prepare(
    `INSERT INTO brief_sources (
      source_id, name, url, industry_keys_json, source_tier, transport, enabled,
      last_status, last_success_at, last_error, latency_ms, consecutive_failures, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      name=excluded.name, url=excluded.url, industry_keys_json=excluded.industry_keys_json,
      source_tier=excluded.source_tier, transport=excluded.transport, last_status=excluded.last_status,
      last_success_at=CASE WHEN excluded.last_status='complete' THEN excluded.last_success_at ELSE brief_sources.last_success_at END,
      last_error=excluded.last_error, latency_ms=excluded.latency_ms,
      consecutive_failures=CASE WHEN excluded.last_status='complete' THEN 0 ELSE brief_sources.consecutive_failures + 1 END,
      updated_at=excluded.updated_at`,
  ).bind(
    source.sourceId,
    source.name,
    source.url,
    JSON.stringify(source.industries),
    source.tier,
    summary.transport,
    source.status,
    source.status === "complete" ? summary.finishedAt : null,
    source.error,
    source.latencyMs,
    source.status === "complete" ? 0 : 1,
    summary.finishedAt,
  ));
  const itemStatements = summary.items.map((item) => db.prepare(
    `INSERT INTO brief_items (
      item_id, canonical_url, title, excerpt, published_at, received_at, fetch_date, run_id,
      source_ids_json, source_names_json, industry_keys_json, source_tier, verification_status,
      corroborating_urls_json, content_hash, filter_status, filter_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fetch_date, item_id) DO UPDATE SET
      canonical_url=excluded.canonical_url, title=excluded.title, excerpt=excluded.excerpt,
      published_at=excluded.published_at, received_at=excluded.received_at, run_id=excluded.run_id,
      source_ids_json=excluded.source_ids_json, source_names_json=excluded.source_names_json,
      industry_keys_json=excluded.industry_keys_json, source_tier=excluded.source_tier,
      verification_status=excluded.verification_status,
      corroborating_urls_json=excluded.corroborating_urls_json, content_hash=excluded.content_hash,
      filter_status=excluded.filter_status, filter_reason=excluded.filter_reason`,
  ).bind(
    item.id,
    item.canonicalUrl,
    item.title,
    item.excerpt,
    item.publishedAt,
    item.receivedAt,
    item.fetchDate,
    summary.runId,
    JSON.stringify(item.sourceIds),
    JSON.stringify(item.sourceNames),
    JSON.stringify(item.industries),
    item.tier,
    item.verification,
    JSON.stringify(item.corroboratingUrls),
    contentHash(item),
    item.verification === "filtered" ? "filtered" : "kept",
    item.filterReason,
  ));
  if (sourceStatements.length) await db.batch(sourceStatements);
  if (itemStatements.length) await db.batch(itemStatements);
  await db.prepare(
    `INSERT INTO brief_fetch_runs (
      run_id, fetch_date, source_tier, transport, started_at, finished_at, status,
      source_total, source_success, raw_item_count, kept_item_count, filtered_item_count, error_summary_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      finished_at=excluded.finished_at, status=excluded.status, source_total=excluded.source_total,
      source_success=excluded.source_success, raw_item_count=excluded.raw_item_count,
      kept_item_count=excluded.kept_item_count, filtered_item_count=excluded.filtered_item_count,
      error_summary_json=excluded.error_summary_json`,
  ).bind(
    summary.runId,
    summary.fetchDate,
    summary.tier,
    summary.transport,
    summary.startedAt,
    summary.finishedAt,
    summary.status,
    summary.sourceTotal,
    summary.sourceSuccess,
    summary.rawItemCount,
    summary.keptItemCount,
    summary.filteredItemCount,
    JSON.stringify(summary.errors),
  ).run();
}

type RunRow = {
  run_id: string;
  fetch_date: string;
  source_tier: number;
  status: NewsCollectionStatus;
  finished_at: string | null;
};

type ItemRow = {
  item_id: string;
  canonical_url: string;
  title: string;
  excerpt: string | null;
  published_at: string | null;
  received_at: string;
  fetch_date: string;
  run_id: string;
  source_ids_json: string;
  source_names_json: string;
  industry_keys_json: string;
  source_tier: number;
  verification_status: NormalizedNewsItem["verification"];
  corroborating_urls_json: string;
  filter_reason: string | null;
};

function jsonStrings(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function readCurrentNewsBundle(db: D1Database, fetchDate: string): Promise<NewsBundle> {
  const runResult = await db.prepare(
    `SELECT run_id, fetch_date, source_tier, status, finished_at
     FROM brief_fetch_runs
     WHERE fetch_date = ? AND status IN ('complete', 'partial')
     ORDER BY source_tier ASC, finished_at DESC`,
  ).bind(fetchDate).all<RunRow>();
  const latestByTier = new Map<number, RunRow>();
  for (const row of runResult.results ?? []) if (!latestByTier.has(Number(row.source_tier))) latestByTier.set(Number(row.source_tier), row);
  const runs = [...latestByTier.values()];
  if (runs.length === 0) return { fetchDate, collectedAt: null, status: "unavailable", items: [] };

  const placeholders = runs.map(() => "?").join(",");
  const itemResult = await db.prepare(
    `SELECT item_id, canonical_url, title, excerpt, published_at, received_at, fetch_date, run_id,
      source_ids_json, source_names_json, industry_keys_json, source_tier, verification_status,
      corroborating_urls_json, filter_reason
     FROM brief_items WHERE fetch_date = ? AND run_id IN (${placeholders})
     ORDER BY source_tier ASC, published_at DESC, received_at DESC`,
  ).bind(fetchDate, ...runs.map((run) => run.run_id)).all<ItemRow>();
  const items: NormalizedNewsItem[] = (itemResult.results ?? []).map((row) => ({
    id: String(row.item_id),
    canonicalUrl: String(row.canonical_url),
    title: String(row.title),
    excerpt: row.excerpt === null ? null : String(row.excerpt),
    publishedAt: row.published_at === null ? null : String(row.published_at),
    receivedAt: String(row.received_at),
    fetchDate: String(row.fetch_date),
    runId: String(row.run_id),
    sourceIds: jsonStrings(String(row.source_ids_json)),
    sourceNames: jsonStrings(String(row.source_names_json)),
    industries: jsonStrings(String(row.industry_keys_json)),
    tier: Number(row.source_tier) === 2 ? 2 : 1,
    verification: row.verification_status,
    corroboratingUrls: jsonStrings(String(row.corroborating_urls_json)),
    filterReason: row.filter_reason === null ? null : String(row.filter_reason),
  }));
  const collectedAt = runs.map((run) => run.finished_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const status: NewsCollectionStatus = runs.some((run) => run.status === "partial") ? "partial" : "complete";
  return { fetchDate, collectedAt, status, items };
}
