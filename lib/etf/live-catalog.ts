import { createEastmoneyProvider } from "../data/eastmoney";
import type { EtfSnapshot } from "../data/provider";

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

const liveCatalogCache = createEtfCatalogCache<EtfSnapshot[]>(5 * 60 * 1_000);

export function loadLiveEtfCatalog(date = new Date().toISOString().slice(0, 10)): Promise<EtfSnapshot[]> {
  return liveCatalogCache.get(() => createEastmoneyProvider().getEtfs(date));
}
