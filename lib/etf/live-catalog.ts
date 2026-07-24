import { createEastmoneyProvider } from "../data/eastmoney";
import type { EtfSnapshot } from "../data/provider";
import { fetchSinaEtfs } from "../data/sina-etfs";
import { refreshEtfCatalogFromTencent } from "../data/tencent";
import { isStale, SERVER_LIVE_CACHE_MS } from "../live/refresh-policy";
import {
  loadLatestEtfCatalogSnapshot,
  saveEtfCatalogSnapshot,
  type PersistedEtfCatalogSnapshot,
} from "./catalog-repository";
import { mergeEtfDerivedMetrics } from "./derived-metrics";

export interface EtfCatalogEnvelope {
  items: EtfSnapshot[];
  source: string;
  status: "complete" | "partial";
  receivedAt: string;
  marketTime: string | null;
  isStale: boolean;
}

interface EtfCatalogStore {
  save(snapshot: PersistedEtfCatalogSnapshot): Promise<void>;
  loadLatest(onOrBefore: string): Promise<PersistedEtfCatalogSnapshot | null>;
}

function requireCatalog(items: EtfSnapshot[], source: string): EtfSnapshot[] {
  if (items.length === 0) throw new Error(`${source} ETF catalog is empty`);
  return items;
}

export async function loadEtfCatalogWithFallback({
  date,
  providers,
  store,
  now = new Date(),
}: {
  date: string;
  providers: Array<{
    source: string;
    status: "complete" | "partial";
    load: () => Promise<EtfSnapshot[]>;
  }>;
  store?: EtfCatalogStore;
  now?: Date;
}): Promise<EtfCatalogEnvelope> {
  const receivedAt = now.toISOString();
  const errors: string[] = [];
  for (const provider of providers) {
    try {
      const loaded = requireCatalog(await provider.load(), provider.source);
      const previous = await store?.loadLatest(date).catch(() => null);
      const items = previous ? mergeEtfDerivedMetrics(loaded, previous.items) : loaded;
      const snapshot: PersistedEtfCatalogSnapshot = {
        tradeDate: date,
        items,
        source: provider.source,
        status: provider.status,
        receivedAt,
      };
      await store?.save(snapshot).catch(() => undefined);
      return { items, source: snapshot.source, status: snapshot.status, receivedAt, marketTime: null, isStale: false };
    } catch (error) {
      errors.push(`${provider.source}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }
  const persisted = await store?.loadLatest(date).catch(() => null);
  if (persisted) {
    return {
      items: persisted.items,
      source: `${persisted.source} · 历史快照`,
      status: "partial",
      receivedAt: persisted.receivedAt,
      marketTime: null,
      isStale: true,
    };
  }
  throw new Error(`ETF live sources unavailable: ${errors.join("; ")}`);
}

export function createEtfCatalogCache<T>(ttlMs: number) {
  let value: T | undefined;
  let expiresAt = 0;
  let pending: Promise<T> | null = null;

  return {
    async get(loader: () => Promise<T>, now = Date.now()): Promise<T> {
      if (value !== undefined && now < expiresAt) return value;
      if (pending) return pending;
      pending = loader()
        .then((next) => {
          value = next;
          expiresAt = now + ttlMs;
          return next;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  };
}

const liveCatalogCache = createEtfCatalogCache<Omit<EtfCatalogEnvelope, "isStale">>(SERVER_LIVE_CACHE_MS);

export async function loadPersistedEtfCatalogEnvelope(
  date = new Date().toISOString().slice(0, 10),
): Promise<EtfCatalogEnvelope> {
  let db: D1Database | null = null;
  try {
    const { env } = await import("cloudflare:workers");
    db = env.DB ?? null;
  } catch {
    db = null;
  }
  if (!db) throw new Error("ETF catalog database is unavailable");
  const persisted = await loadLatestEtfCatalogSnapshot(db, date);
  if (!persisted) throw new Error("ETF catalog snapshot is unavailable");
  return {
    items: persisted.items,
    source: persisted.source,
    status: persisted.status,
    receivedAt: persisted.receivedAt,
    marketTime: null,
    isStale: isStale(persisted.receivedAt),
  };
}

export async function loadLiveEtfCatalogEnvelope(date = new Date().toISOString().slice(0, 10)): Promise<EtfCatalogEnvelope> {
  const cached = await liveCatalogCache.get(async () => {
    let db: D1Database | null = null;
    try {
      const { env } = await import("cloudflare:workers");
      db = env.DB ?? null;
    } catch {
      db = null;
    }
    let persistedPromise: Promise<PersistedEtfCatalogSnapshot | null> | undefined;
    const store: EtfCatalogStore | undefined = db ? {
      save: async (snapshot) => {
        await saveEtfCatalogSnapshot(db!, snapshot);
        persistedPromise = Promise.resolve(snapshot);
      },
      loadLatest: (onOrBefore) => {
        persistedPromise ??= loadLatestEtfCatalogSnapshot(db!, onOrBefore);
        return persistedPromise;
      },
    } : undefined;
    const envelope = await loadEtfCatalogWithFallback({
      date,
      providers: [
        {
          source: "东方财富",
          status: "complete",
          load: () => createEastmoneyProvider().getEtfs(date),
        },
        {
          source: "腾讯财经",
          status: "partial",
          load: async () => {
            const persisted = await store?.loadLatest(date);
            if (!persisted) throw new Error("ETF universe snapshot unavailable");
            return refreshEtfCatalogFromTencent(persisted.items);
          },
        },
        {
          source: "新浪财经",
          status: "partial",
          load: () => fetchSinaEtfs(),
        },
      ],
      store,
    });
    return {
      items: envelope.items,
      source: envelope.source,
      status: envelope.status,
      receivedAt: envelope.receivedAt,
      marketTime: envelope.marketTime,
    };
  });
  return { ...cached, isStale: isStale(cached.receivedAt) || cached.source.endsWith("历史快照") };
}

export async function loadLiveEtfCatalog(date?: string): Promise<EtfSnapshot[]> {
  return (await loadLiveEtfCatalogEnvelope(date)).items;
}
