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
  inapplicable?: number;
  errors?: Array<{ symbol: string; message: string }>;
}): string {
  const failures = (progress.errors ?? [])
    .slice(0, 2)
    .map((error) => `${error.symbol} ${error.message}`)
    .join("；");
  return `ETF历史指标 本批完成 ${progress.completed}/${progress.attempted}；待处理 ${progress.remaining}；失败 ${progress.failed}；样本不足 ${progress.inapplicable ?? 0}`
    + (failures ? `; ${failures}` : "");
}

export async function enrichEtfMetricsBatch({
  items,
  cursor,
  batchSize,
  loadBars,
  minimumIntervalMs = 0,
  inapplicableSymbols = new Set<string>(),
  concurrency = 1,
  deferredSymbols = new Set<string>(),
}: {
  items: EtfSnapshot[];
  cursor: number;
  batchSize: number;
  loadBars: (symbol: string) => Promise<Array<Pick<MarketBar, "time" | "amount">>>;
  minimumIntervalMs?: number;
  inapplicableSymbols?: Set<string>;
  concurrency?: number;
  deferredSymbols?: Set<string>;
}): Promise<{
  items: EtfSnapshot[];
  attempted: number;
  completed: number;
  failed: number;
  inapplicable: number;
  inapplicableSymbols: string[];
  errors: Array<{ symbol: string; message: string }>;
  nextCursor: number;
  remaining: number;
}> {
  const missingIndices = items
    .flatMap((item, index) => item.averageAmount20 === null
      && !inapplicableSymbols.has(item.symbol)
      && !deferredSymbols.has(item.symbol)
      ? [index]
      : [])
    .sort((left, right) => items[right].amount - items[left].amount);
  const start = cursor >= missingIndices.length ? 0 : Math.max(0, cursor);
  const selected = missingIndices.slice(start, start + Math.max(1, batchSize));
  const next = [...items];
  let completed = 0;
  let failed = 0;
  let inapplicable = 0;
  const errors: Array<{ symbol: string; message: string }> = [];
  let nextRequestAt = 0;
  let gate = Promise.resolve();
  const awaitRateLimit = () => {
    if (nextRequestAt === 0) {
      nextRequestAt = Date.now() + minimumIntervalMs;
      return Promise.resolve();
    }
    const reservation = gate.then(async () => {
      const waitMs = Math.max(0, nextRequestAt - Date.now());
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      nextRequestAt = Date.now() + minimumIntervalMs;
    });
    gate = reservation.catch(() => undefined);
    return reservation;
  };
  let workCursor = 0;
  const worker = async () => {
    while (workCursor < selected.length) {
      const itemIndex = selected[workCursor++];
      try {
        await awaitRateLimit();
        const averageAmount20 = calculateAverageAmount20(await loadBars(items[itemIndex].symbol));
        if (averageAmount20 === null) {
          inapplicable += 1;
          inapplicableSymbols.add(items[itemIndex].symbol);
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
  };
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, selected.length)) },
    () => worker(),
  ));

  const remaining = next.filter((item) => item.averageAmount20 === null && !inapplicableSymbols.has(item.symbol)).length;
  const nextCursor = completed > 0
    ? 0
    : start + selected.length >= missingIndices.length ? 0 : start + selected.length;
  return {
    items: next,
    attempted: selected.length,
    completed,
    failed,
    inapplicable,
    inapplicableSymbols: [...inapplicableSymbols].sort(),
    errors,
    nextCursor,
    remaining,
  };
}

export async function runEtfMetricsRefreshBatch({
  db,
  date,
  fetcher = fetch,
  batchSize = 48,
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
  const inapplicableStateKey = `etf-metrics-inapplicable:${date}`;
  const retryStateKey = `etf-metrics-retry:${date}`;
  const [persisted, cursorRow, inapplicableRow, retryRow] = await Promise.all([
    loadLatestEtfCatalogSnapshot(db, date),
    db.prepare("SELECT value FROM bootstrap_state WHERE key = ?").bind(stateKey).first<{ value: string }>(),
    db.prepare("SELECT value FROM bootstrap_state WHERE key = ?").bind(inapplicableStateKey).first<{ value: string }>(),
    db.prepare("SELECT value FROM bootstrap_state WHERE key = ?").bind(retryStateKey).first<{ value: string }>(),
  ]);
  let inapplicableSymbols = new Set<string>();
  try {
    const parsed = JSON.parse(inapplicableRow?.value ?? "[]") as unknown;
    if (Array.isArray(parsed)) {
      inapplicableSymbols = new Set(parsed.filter((symbol): symbol is string => typeof symbol === "string"));
    }
  } catch {
    inapplicableSymbols = new Set();
  }
  const retryState: Record<string, { attempts: number; nextRetryAt: string; message: string }> = {};
  try {
    const parsed = JSON.parse(retryRow?.value ?? "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      Object.assign(retryState, parsed);
    }
  } catch {
    // Corrupt retry metadata must not block the catalog.
  }
  const nowMs = Date.now();
  const deferredSymbols = new Set(Object.entries(retryState)
    .filter(([, value]) => new Date(value.nextRetryAt).getTime() > nowMs)
    .map(([symbol]) => symbol));
  const live = await createEastmoneyProvider(fetcher).getEtfs(date).catch(() => []);
  let items = live.length > 0
    ? mergeEtfDerivedMetrics(live, persisted?.items ?? [])
    : persisted?.items ?? [];
  if (items.length === 0) throw new Error("ETF catalog unavailable for metrics refresh");
  if (fuyaoApiKey) {
    const fuyao = createFuyaoMcpClient({
      apiKey: fuyaoApiKey,
      baseUrl: fuyaoBaseUrl,
      fetcher,
    });
    const mergedCatalog = await fuyao.mergeEtfMasterCatalog(items).catch(() => null);
    if (mergedCatalog && mergedCatalog.coveragePct >= 80) {
      items = mergedCatalog.items;
    }
    const selectedSymbols = items
      .toSorted((left, right) => right.amount - left.amount)
      .slice(0, Math.max(12, batchSize))
      .map((item) => item.symbol);
    const primary = await fuyao.fetchEtfSnapshots(selectedSymbols).catch(() => []);
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
              turnoverRate: quote.turnoverRate,
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
    minimumIntervalMs: 250,
    concurrency: 4,
    inapplicableSymbols,
    deferredSymbols,
    loadBars: async (symbol) => {
      const cacheKey = `etf-bars20:${date}:${symbol}`;
      const cached = await db.prepare("SELECT value FROM bootstrap_state WHERE key = ?")
        .bind(cacheKey)
        .first<{ value: string }>();
      if (cached?.value) {
        try {
          const parsed = JSON.parse(cached.value) as Array<Pick<MarketBar, "time" | "amount">>;
          if (Array.isArray(parsed) && parsed.length >= 20) return parsed;
        } catch {
          // Refresh an invalid cache entry from the upstream adapters.
        }
      }
      const bars = (await loadEtfBarsWithFallback(
        symbol,
        "day",
        "none",
        fetcher,
        fuyaoApiKey ? { apiKey: fuyaoApiKey, baseUrl: fuyaoBaseUrl, fetcher } : undefined,
      )).bars.map((bar) => ({ time: bar.time, amount: bar.amount })).slice(-40);
      if (bars.length > 0) {
        const cachedAt = new Date().toISOString();
        await db.prepare(
          `INSERT INTO bootstrap_state (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
        ).bind(cacheKey, JSON.stringify(bars), cachedAt).run();
      }
      return bars;
    },
  });
  const completedSymbols = new Set(result.items
    .filter((item) => item.averageAmount20 !== null)
    .map((item) => item.symbol));
  for (const symbol of [...completedSymbols, ...result.inapplicableSymbols]) delete retryState[symbol];
  for (const error of result.errors) {
    const attempts = (retryState[error.symbol]?.attempts ?? 0) + 1;
    const delayMs = attempts === 1 ? 15 * 60_000 : attempts === 2 ? 60 * 60_000 : 6 * 60 * 60_000;
    retryState[error.symbol] = {
      attempts,
      nextRetryAt: new Date(Date.now() + delayMs).toISOString(),
      message: error.message.slice(0, 240),
    };
  }
  const receivedAt = new Date().toISOString();
  await saveEtfCatalogSnapshot(db, {
    tradeDate: date,
    items: result.items,
    source: fuyaoApiKey
      ? `扶摇 Fuyao / ${persisted?.source ?? "东方财富"}`
      : persisted?.source ?? "东方财富",
    status: live.length > 0 ? "complete" : persisted?.status ?? "partial",
    receivedAt,
  });
  await db.batch([
    db.prepare(
      `INSERT INTO bootstrap_state (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    ).bind(stateKey, String(result.nextCursor), receivedAt),
    db.prepare(
      `INSERT INTO bootstrap_state (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    ).bind(inapplicableStateKey, JSON.stringify(result.inapplicableSymbols), receivedAt),
    db.prepare(
      `INSERT INTO bootstrap_state (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    ).bind(retryStateKey, JSON.stringify(retryState), receivedAt),
  ]);
  return {
    ...result,
    inapplicable: result.inapplicableSymbols.length,
    total: items.length,
    retryable: Object.keys(retryState).length,
    deferred: deferredSymbols.size,
  };
}
