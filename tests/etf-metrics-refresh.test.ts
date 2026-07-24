import { describe, expect, it, vi } from "vitest";
import type { EtfSnapshot } from "../lib/data/provider";
import { enrichEtfMetricsBatch, formatEtfMetricsProgress } from "../lib/etf/metrics-refresh";

const item = (symbol: string, amount = 100): EtfSnapshot => ({
  symbol,
  name: `${symbol}ETF`,
  category: "其他",
  tags: ["其他"],
  exchange: "SH",
  price: 1,
  pctChange: 0,
  amount,
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

  it("processes upstream ETF history requests serially to avoid provider bans", async () => {
    let active = 0;
    let maximumActive = 0;
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let calls = 0;

    const pending = enrichEtfMetricsBatch({
      items: [item("510001"), item("510002")],
      cursor: 0,
      batchSize: 2,
      loadBars: async () => {
        calls += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (calls === 1) await firstBlocked;
        active -= 1;
        return Array.from({ length: 20 }, (_, index) => ({
          time: String(index),
          amount: 100_000_000,
        }));
      },
    });

    await Promise.resolve();
    expect(calls).toBe(1);
    releaseFirst();
    await pending;
    expect(maximumActive).toBe(1);
  });

  it("prioritizes liquid ETFs and exposes per-symbol failure diagnostics", async () => {
    const requested: string[] = [];
    const result = await enrichEtfMetricsBatch({
      items: [
        item("510001", 100),
        item("510002", 1_000),
        item("510003", 500),
      ],
      cursor: 0,
      batchSize: 1,
      loadBars: async (symbol) => {
        requested.push(symbol);
        throw new Error("Eastmoney 520; Sina 403");
      },
    });

    expect(requested).toEqual(["510002"]);
    expect(result.errors).toEqual([{
      symbol: "510002",
      message: "Eastmoney 520; Sina 403",
    }]);
  });

  it("spaces ETF history requests by the configured provider interval", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-24T08:00:00.000Z"));
      const starts: number[] = [];
      const pending = enrichEtfMetricsBatch({
        items: [item("510001"), item("510002")],
        cursor: 0,
        batchSize: 2,
        minimumIntervalMs: 1_000,
        loadBars: async () => {
          starts.push(Date.now());
          return Array.from({ length: 20 }, (_, index) => ({
            time: String(index),
            amount: 100_000_000,
          }));
        },
      });

      await vi.advanceTimersByTimeAsync(1_000);
      await pending;
      expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("formats source failures into the operator-visible checkpoint message", () => {
    expect(formatEtfMetricsProgress({
      completed: 0,
      attempted: 2,
      remaining: 100,
      failed: 2,
      errors: [
        { symbol: "510300", message: "Eastmoney 520" },
        { symbol: "159919", message: "Sina 403" },
      ],
    })).toContain("510300 Eastmoney 520");
  });
});
