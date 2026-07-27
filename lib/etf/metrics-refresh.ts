import { createEastmoneyProvider } from "../data/eastmoney";
import { createFuyaoMcpClient } from "../data/fuyao-mcp";
import type { EtfSnapshot } from "../data/provider";
import { loadEtfBarsWithFallback, type MarketBar } from "./bars";
import { loadLatestEtfCatalogSnapshot, saveEtfCatalogSnapshot } from "./catalog-repository";
import { calculateAverageAmount20, mergeEtfDerivedMetrics } from "./derived-metrics";

export function formatEtfMetricsProgress(progress: {
  completed: number;
  attempted: number;
  remaining: number;
  failed: number;
  errors?: Array<{ symbol: string; message: string }>;
}): string {
  const failures = (progress.errors ?? [])
    .slice(0, 2)
    .map((error) => `${error.symbol} ${error.message}`)
    .join("；");
  return `etf-metrics ${progress.completed}/${progress.attempted}; remaining ${progress.remaining}; failed ${progress.failed}`
    + (failures ? `; ${failures}` : "");
}

export async function enrichEtfMetricsBatch({
  items,
  cursor,
  batchSize,
  loadBars,
  minimumIntervalMs = 0,
}: {
  items: EtfSnapshot[];
  cursor: number;
  batchSize: number;
  loadBars: (symbol: string) => Promise<Array<Pick<MarketBar, "time" | "amount">>>;
  minimumIntervalMs?: number;
}): Promise<{
  items: EtfSnapshot[];
  attempted: number;
  completed: number;
  failed: number;
  errors: Array<{ symbol: string; message: string }>;
  nextCursor: number;
  remaining: number;
}> {
  const missingIndices = items
    .flatMap((item, index) => item.averageAmount20 === null ? [index] : [])
    .sort((left, right) => items[right].amount - items[left].amount);
  const start = cursor >= missingIndices.length ? 0 : Math.max(0, cursor);
  const selected = missingIndices.slice(start, start + Math.max(1, batchSize));
  const next = [...items];
  let completed = 0;
  let failed = 0;
  const errors: Array<{ symbol: string; message: string }> = [];
  let lastRequestStartedAt = 0;

  for (const itemIndex of selected) {
    try {
      const waitMs = Math.max(0, minimumIntervalMs - (Date.now() - lastRequestStartedAt));
      if (lastRequestStartedAt > 0 && waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      lastRequestStartedAt = Date.now();
      const averageAmount20 = calculateAverageAmount20(await loadBars(items[itemIndex].symbol));
      if (averageAmount20 === null) {
        failed += 1;
        errors.push({
          symbol: items[itemIndex].symbol,
          message: "不足20个有效成交额交易日",
        });
        continue;
      }
      next[itemIndex] = { ...items[itemIndex], averageAmount20 };
      completed += 1;
    } catch (error) {
      failed += 1;
      errors.push({
        symbol: items[itemIndex].symbol,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const remaining = next.filter((item) => item.averageAmount20 === null).length;
  const nextCursor = completed > 0
    ? 0
    : start + selected.length >= missingIndices.length ? 0 : start + selected.length;
  return { items: next, attempted: selected.length, completed, failed, errors, nextCursor, remaining };
}

export async function runEtfMetricsRefreshBatch({
  db,
  date,
  fetcher = fetch,
  batchSize = 12,
  fuyaoApiKey,
  fuyaoBaseUrl,
}: {
  db: D1Database;
  date: string;
  fetcher?: typeof fetch;
  batchSize?: number;
  fuyaoApiKey?: string;
  fuyaoBaseUrl?: string;
}) {
  const stateKey = `etf-metrics-cursor:${date}`;
  const [persisted, cursorRow] = await Promise.all([
    loadLatestEtfCatalogSnapshot(db, date),
    db.prepare("SELECT value FROM bootstrap_state WHERE key = ?").bind(stateKey).first<{ value: string }>(),
  ]);
  const live = await createEastmoneyProvider(fetcher).getEtfs(date).catch(() => []);
  let items = live.length > 0
    ? mergeEtfDerivedMetrics(live, persisted?.items ?? [])
    : persisted?.items ?? [];
  if (items.length === 0) throw new Error("ETF catalog unavailable for metrics refresh");
  if (fuyaoApiKey) {
    const selectedSymbols = items
      .toSorted((left, right) => right.amount - left.amount)
      .slice(0, Math.max(12, batchSize))
      .map((item) => item.symbol);
    const primary = await createFuyaoMcpClient({
      apiKey: fuyaoApiKey,
      baseUrl: fuyaoBaseUrl,
      fetcher,
    }).fetchEtfSnapshots(selectedSymbols).catch(() => []);
    if (primary.length > 0) {
      const primaryBySymbol = new Map(primary.map((item) => [item.symbol, item]));
      items = items.map((item) => {
        const quote = primaryBySymbol.get(item.symbol);
        return quote
          ? {
              ...item,
              name: quote.name,
              category: quote.category,
              tags: quote.tags,
              exchange: quote.exchange,
              price: quote.price,
              pctChange: quote.pctChange,
              amount: quote.amount,
              updatedAt: quote.updatedAt,
            }
          : item;
      });
    }
  }

  const result = await enrichEtfMetricsBatch({
    items,
    cursor: Number(cursorRow?.value ?? 0),
    batchSize,
    minimumIntervalMs: 1_100,
    loadBars: async (symbol) => (await loadEtfBarsWithFallback(
      symbol,
      "day",
      "none",
      fetcher,
      fuyaoApiKey ? { apiKey: fuyaoApiKey, baseUrl: fuyaoBaseUrl, fetcher } : undefined,
    )).bars,
  });
  const receivedAt = new Date().toISOString();
  await saveEtfCatalogSnapshot(db, {
    tradeDate: date,
    items: result.items,
    source: fuyaoApiKey
      ? `扶摇 Fuyao / ${persisted?.source ?? "东方财富"}`
      : persisted?.source ?? "东方财富",
    status: result.remaining === 0 ? "complete" : "partial",
    receivedAt,
  });
  await db.prepare(
    `INSERT INTO bootstrap_state (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  ).bind(stateKey, String(result.nextCursor), receivedAt).run();
  return { ...result, total: items.length };
}
