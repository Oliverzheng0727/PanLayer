import { createEastmoneyProvider } from "../data/eastmoney";
import { runDomesticPipeline } from "../data/market-pipeline";
import { fetchTencentQuotes } from "../data/tencent";
import { calculateBreadth } from "../domain/metrics";
import type { Breadth } from "../domain/types";
import { beijingDateParts } from "../jobs/schedule";
import { isStale, SERVER_LIVE_CACHE_MS } from "./refresh-policy";

export interface LiveMarketSnapshot {
  breadth: Breadth;
  source: string;
  status: "complete" | "partial";
  message: string;
  marketTime: string | null;
  receivedAt: string;
  isStale: boolean;
}

export function createLiveMarketCache<T>(ttlMs: number) {
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

export function createLiveMarketLoader(fetcher: typeof fetch = fetch) {
  const cache = createLiveMarketCache<Omit<LiveMarketSnapshot, "isStale">>(SERVER_LIVE_CACHE_MS);

  return async (now = new Date()): Promise<LiveMarketSnapshot> => {
    const cached = await cache.get(async () => {
      const { date, time } = beijingDateParts(now);
      const provider = createEastmoneyProvider(fetcher);
      const market = await runDomesticPipeline({
        at: time,
        expectedSymbols: [],
        primary: provider,
        secondary: { name: "腾讯", getQuotes: (symbols) => fetchTencentQuotes(symbols, fetcher) },
        now,
        retryDelayMs: 200,
      });
      if (market.status === "failed" || market.quotes.length === 0) {
        throw new Error(market.message || "实时行情源返回空数据");
      }
      return {
        breadth: calculateBreadth(market.quotes),
        source: market.source,
        status: market.status,
        message: market.message,
        marketTime: `${date}T${time}:00+08:00`,
        receivedAt: new Date().toISOString(),
      };
    }, now.getTime());

    return { ...cached, isStale: isStale(cached.receivedAt, now) };
  };
}

const liveMarketLoader = createLiveMarketLoader();

export function loadLiveMarketSnapshot(now = new Date()): Promise<LiveMarketSnapshot> {
  return liveMarketLoader(now);
}
