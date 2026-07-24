import { describe, expect, it } from "vitest";
import type { EtfSnapshot } from "../lib/data/provider";
import { enrichEtfMetricsBatch } from "../lib/etf/metrics-refresh";

const item = (symbol: string): EtfSnapshot => ({
  symbol,
  name: `${symbol}ETF`,
  category: "其他",
  tags: ["其他"],
  exchange: "SH",
  price: 1,
  pctChange: 0,
  amount: 100,
  averageAmount20: null,
  scale: null,
  turnoverRate: null,
  status: "active",
  updatedAt: "2026-07-24T15:00:00+08:00",
});

describe("ETF metrics refresh batch", () => {
  it("enriches only a bounded batch and advances its cursor", async () => {
    const result = await enrichEtfMetricsBatch({
      items: [item("510001"), item("510002"), item("510003")],
      cursor: 0,
      batchSize: 2,
      loadBars: async () => Array.from({ length: 20 }, (_, index) => ({
        time: String(index),
        amount: 100_000_000,
      })),
    });

    expect(result.attempted).toBe(2);
    expect(result.completed).toBe(2);
    expect(result.nextCursor).toBe(2);
    expect(result.items.slice(0, 2).every((entry) => entry.averageAmount20 === 1)).toBe(true);
    expect(result.items[2].averageAmount20).toBeNull();
  });
});
