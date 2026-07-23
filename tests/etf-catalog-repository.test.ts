import { describe, expect, it } from "vitest";
import {
  loadLatestEtfCatalogSnapshot,
  saveEtfCatalogSnapshot,
} from "../lib/etf/catalog-repository";
import type { EtfSnapshot } from "../lib/data/provider";

const item: EtfSnapshot = {
  symbol: "159995",
  name: "芯片ETF",
  category: "半导体存储",
  tags: ["芯片"],
  exchange: "SZ",
  price: 1.29,
  pctChange: 2.18,
  amount: 2_860_000_000,
  averageAmount20: null,
  scale: 22_000_000_000,
  turnoverRate: 8.2,
  status: "active",
  updatedAt: "2026-07-23T07:00:00.000Z",
};

function fakeDb(row: unknown = null) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  return {
    calls,
    db: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return {
              first: async () => row,
              run: async () => ({ success: true }),
            };
          },
        };
      },
    } as unknown as D1Database,
  };
}

describe("ETF catalog repository", () => {
  it("saves the entire catalog as one durable daily snapshot", async () => {
    const { db, calls } = fakeDb();

    await saveEtfCatalogSnapshot(db, {
      tradeDate: "2026-07-23",
      items: [item],
      source: "新浪财经",
      status: "partial",
      receivedAt: "2026-07-23T07:00:00.000Z",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("INSERT INTO etf_catalog_cache");
    expect(calls[0].values[0]).toBe("2026-07-23");
    expect(JSON.parse(String(calls[0].values[1]))).toEqual([item]);
  });

  it("loads the latest valid snapshot on or before the requested date", async () => {
    const { db, calls } = fakeDb({
      trade_date: "2026-07-22",
      payload: JSON.stringify([item]),
      source: "东方财富",
      status: "complete",
      received_at: "2026-07-22T07:00:00.000Z",
    });

    await expect(loadLatestEtfCatalogSnapshot(db, "2026-07-23")).resolves.toEqual({
      tradeDate: "2026-07-22",
      items: [item],
      source: "东方财富",
      status: "complete",
      receivedAt: "2026-07-22T07:00:00.000Z",
    });
    expect(calls[0].values).toEqual(["2026-07-23"]);
  });

  it("rejects corrupted or empty persisted payloads", async () => {
    const corrupted = fakeDb({
      trade_date: "2026-07-22",
      payload: "[]",
      source: "东方财富",
      status: "complete",
      received_at: "2026-07-22T07:00:00.000Z",
    });

    await expect(loadLatestEtfCatalogSnapshot(corrupted.db, "2026-07-23")).resolves.toBeNull();
  });
});
