import { createEastmoneyProvider } from "../data/eastmoney";
import type { EtfSnapshot } from "../data/provider";
import { isStale, SERVER_LIVE_CACHE_MS } from "../live/refresh-policy";

export interface EtfCatalogEnvelope {
  items: EtfSnapshot[];
  source: "东方财富";
  status: "complete";
  receivedAt: string;
  marketTime: string | null;
  isStale: boolean;
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

export async function loadLiveEtfCatalogEnvelope(date = new Date().toISOString().slice(0, 10)): Promise<EtfCatalogEnvelope> {
  const cached = await liveCatalogCache.get(async () => ({
    items: await createEastmoneyProvider().getEtfs(date),
    source: "东方财富" as const,
    status: "complete" as const,
    receivedAt: new Date().toISOString(),
    marketTime: null,
  }));
  return { ...cached, isStale: isStale(cached.receivedAt) };
}

export async function loadLiveEtfCatalog(date?: string): Promise<EtfSnapshot[]> {
  return (await loadLiveEtfCatalogEnvelope(date)).items;
}
