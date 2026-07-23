import { createEastmoneyProvider } from "../data/eastmoney";
import { runDomesticPipeline } from "../data/market-pipeline";
import { fetchTencentQuotes } from "../data/tencent";
import { calculateBreadth } from "../domain/metrics";
import type { Breadth } from "../domain/types";
import { beijingDateParts } from "../jobs/schedule";
import { isStale, SERVER_LIVE_CACHE_MS } from "./refresh-policy";

const MINIMUM_ALL_A_UNIVERSE = 5_000;

export interface LiveMarketSnapshot {
  breadth: Breadth;
  source: string;
  status: "complete" | "partial";
  message: string;
  universeSize: number;
  coveragePct: number;
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

  return async (now = new Date(), expectedSymbols: string[] = []): Promise<LiveMarketSnapshot> => {
    const cached = await cache.get(async () => {
      const { date, time } = beijingDateParts(now);
      const provider = createEastmoneyProvider(fetcher);
      const market = await runDomesticPipeline({
        at: time,
        expectedSymbols,
        primary: provider,
        secondary: { name: "腾讯", getQuotes: (symbols) => fetchTencentQuotes(symbols, fetcher) },
        now,
        retryDelayMs: 200,
        minimumExpectedCount: MINIMUM_ALL_A_UNIVERSE,
        secondarySampleSize: 240,
      });
      if (market.status === "failed" || market.quotes.length === 0) {
        throw new Error(market.message || "实时行情源返回空数据");
      }
      const selectedAudit = market.source === "腾讯" ? market.audits[1] : market.audits[0];
      return {
        breadth: calculateBreadth(market.quotes),
        source: market.source,
        status: market.status,
        message: market.message,
        universeSize: market.quotes.length,
        coveragePct: selectedAudit?.coveragePct ?? 0,
        marketTime: `${date}T${time}:00+08:00`,
        receivedAt: new Date().toISOString(),
      };
    }, now.getTime());

    return { ...cached, isStale: isStale(cached.receivedAt, now) };
  };
}

const liveMarketLoader = createLiveMarketLoader();

export function loadLiveMarketSnapshot(now = new Date(), expectedSymbols: string[] = []): Promise<LiveMarketSnapshot> {
  return liveMarketLoader(now, expectedSymbols);
}
