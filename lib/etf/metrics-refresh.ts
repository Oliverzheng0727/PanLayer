import { createEastmoneyProvider } from "../data/eastmoney";
import type { EtfSnapshot } from "../data/provider";
import { loadEtfBarsWithFallback, type MarketBar } from "./bars";
import { loadLatestEtfCatalogSnapshot, saveEtfCatalogSnapshot } from "./catalog-repository";
import { calculateAverageAmount20, mergeEtfDerivedMetrics } from "./derived-metrics";

export async function enrichEtfMetricsBatch({
  items,
  cursor,
  batchSize,
  loadBars,
}: {
  items: EtfSnapshot[];
  cursor: number;
  batchSize: number;
  loadBars: (symbol: string) => Promise<Array<Pick<MarketBar, "time" | "amount">>>;
}): Promise<{
  items: EtfSnapshot[];
  attempted: number;
  completed: number;
  failed: number;
  nextCursor: number;
  remaining: number;
}> {
  const missingIndices = items.flatMap((item, index) => item.averageAmount20 === null ? [index] : []);
  const start = cursor >= missingIndices.length ? 0 : Math.max(0, cursor);
  const selected = missingIndices.slice(start, start + Math.max(1, batchSize));
  const next = [...items];
  let completed = 0;
  let failed = 0;

  await Promise.all(selected.map(async (itemIndex) => {
    try {
      const averageAmount20 = calculateAverageAmount20(await loadBars(items[itemIndex].symbol));
      if (averageAmount20 === null) {
        failed += 1;
        return;
      }
      next[itemIndex] = { ...items[itemIndex], averageAmount20 };
      completed += 1;
    } catch {
      failed += 1;
    }
  }));

  const remaining = next.filter((item) => item.averageAmount20 === null).length;
  const nextCursor = start + selected.length >= missingIndices.length ? 0 : start + selected.length;
  return { items: next, attempted: selected.length, completed, failed, nextCursor, remaining };
}

export async function runEtfMetricsRefreshBatch({
  db,
  date,
  fetcher = fetch,
  batchSize = 12,
}: {
  db: D1Database;
  date: string;
  fetcher?: typeof fetch;
  batchSize?: number;
}) {
  const stateKey = `etf-metrics-cursor:${date}`;
  const [persisted, cursorRow] = await Promise.all([
    loadLatestEtfCatalogSnapshot(db, date),
    db.prepare("SELECT value FROM bootstrap_state WHERE key = ?").bind(stateKey).first<{ value: string }>(),
  ]);
  const live = await createEastmoneyProvider(fetcher).getEtfs(date).catch(() => []);
  const items = live.length > 0
    ? mergeEtfDerivedMetrics(live, persisted?.items ?? [])
    : persisted?.items ?? [];
  if (items.length === 0) throw new Error("ETF catalog unavailable for metrics refresh");

  const result = await enrichEtfMetricsBatch({
    items,
    cursor: Number(cursorRow?.value ?? 0),
    batchSize,
    loadBars: async (symbol) => (await loadEtfBarsWithFallback(symbol, "day", "none", fetcher)).bars,
  });
  const receivedAt = new Date().toISOString();
  await saveEtfCatalogSnapshot(db, {
    tradeDate: date,
    items: result.items,
    source: persisted?.source ?? "东方财富",
    status: result.remaining === 0 ? "complete" : "partial",
    receivedAt,
  });
  await db.prepare(
    `INSERT INTO bootstrap_state (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  ).bind(stateKey, String(result.nextCursor), receivedAt).run();
  return { ...result, total: items.length };
}
