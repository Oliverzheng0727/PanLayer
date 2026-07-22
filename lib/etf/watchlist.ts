import type { EtfSnapshot } from "../data/provider";
import { classifyEtf } from "./catalog";

export interface WatchlistRecord {
  userEmail: string;
  symbol: string;
  name: string;
  exchange: "SH" | "SZ" | "OTHER";
  category: string;
  createdAt: string;
  updatedAt: string;
}

export function normalizeEtfSymbol(value: string): string | null {
  const symbol = value.trim().toUpperCase().replace(/\.(SH|SZ)$/, "");
  return /^[15]\d{5}$/.test(symbol) ? symbol : null;
}

export function normalizeUserEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email ? email : null;
}

export function mergeWatchlistEtfs(
  liveItems: EtfSnapshot[],
  savedItems: WatchlistRecord[],
): EtfSnapshot[] {
  const liveBySymbol = new Map(liveItems.map((item) => [item.symbol, item]));
  return savedItems.map((saved) => {
    const live = liveBySymbol.get(saved.symbol);
    if (live) return { ...live, category: saved.category };
    const classified = classifyEtf(saved.name);
    return {
      symbol: saved.symbol,
      name: saved.name,
      exchange: saved.exchange,
      category: saved.category,
      tags: classified.tags,
      price: 0,
      pctChange: 0,
      amount: 0,
      averageAmount20: null,
      scale: null,
      turnoverRate: null,
      status: "paused",
      updatedAt: saved.updatedAt,
    };
  });
}
