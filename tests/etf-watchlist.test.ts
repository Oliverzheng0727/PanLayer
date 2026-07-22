import { describe, expect, it } from "vitest";
import type { EtfSnapshot } from "../lib/data/provider";
import {
  mergeWatchlistEtfs,
  normalizeEtfSymbol,
  normalizeUserEmail,
  type WatchlistRecord,
} from "../lib/etf/watchlist";

const liveEtf: EtfSnapshot = {
  symbol: "512480",
  name: "半导体ETF",
  category: "半导体存储",
  tags: ["半导体", "芯片"],
  exchange: "SH",
  price: 1.234,
  pctChange: 2.5,
  amount: 880_000_000,
  averageAmount20: null,
  scale: 12_000_000_000,
  turnoverRate: 3.2,
  status: "active",
  updatedAt: "2026-07-23T07:00:00.000Z",
};

describe("ETF watchlist", () => {
  it("normalizes supported six-digit fund codes", () => {
    expect(normalizeEtfSymbol(" 512480.sh ")).toBe("512480");
    expect(normalizeEtfSymbol("159995")).toBe("159995");
    expect(normalizeEtfSymbol("600519")).toBeNull();
    expect(normalizeEtfSymbol("abc")).toBeNull();
  });

  it("normalizes account email for isolated storage", () => {
    expect(normalizeUserEmail(" Viewer@Example.COM ")).toBe("viewer@example.com");
    expect(normalizeUserEmail(" ")).toBeNull();
  });

  it("uses live quotes while preserving the user's saved category", () => {
    const saved: WatchlistRecord[] = [{
      userEmail: "viewer@example.com",
      symbol: "512480",
      name: "半导体ETF",
      exchange: "SH",
      category: "科技AI",
      createdAt: "2026-07-22T08:00:00.000Z",
      updatedAt: "2026-07-22T08:00:00.000Z",
    }];

    expect(mergeWatchlistEtfs([liveEtf], saved)).toEqual([
      expect.objectContaining({ symbol: "512480", price: 1.234, category: "科技AI" }),
    ]);
  });

  it("keeps a saved ETF visible when the live source is temporarily unavailable", () => {
    const saved: WatchlistRecord[] = [{
      userEmail: "viewer@example.com",
      symbol: "159995",
      name: "芯片ETF",
      exchange: "SZ",
      category: "半导体存储",
      createdAt: "2026-07-22T08:00:00.000Z",
      updatedAt: "2026-07-22T08:00:00.000Z",
    }];

    expect(mergeWatchlistEtfs([], saved)[0]).toMatchObject({
      symbol: "159995",
      name: "芯片ETF",
      category: "半导体存储",
      status: "paused",
    });
  });
});
