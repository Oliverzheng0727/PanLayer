import { describe, expect, it } from "vitest";
import type { StructuredMarketSignals } from "../lib/domain/types";
import { applyStructuredSignalFallbacks } from "../lib/data/structured-signal-fallback";

const evidence = (status: "complete" | "partial" | "failed", message: string) => ({
  source: "扶摇 Fuyao",
  requestId: null,
  marketTime: "2026-07-27T15:00:00+08:00",
  receivedAt: "2026-07-27T08:00:00.000Z",
  rawCount: 0,
  validCount: 0,
  coveragePct: null,
  status,
  message,
});

function signals(): StructuredMarketSignals {
  return {
    schemaVersion: 1,
    provider: "扶摇 Fuyao",
    referenceDate: "2026-07-27",
    marketTime: "2026-07-27T15:00:00+08:00",
    receivedAt: "2026-07-27T08:00:00.000Z",
    status: "partial",
    datasetTotal: 7,
    datasetSuccess: 4,
    requestIds: [],
    hotStocks: [{ symbol: "000001.SZ", name: "平安银行", rank: 1, rankChange: 0, heat: 100 }],
    skyrocket: [],
    dragonTiger: [],
    anomalies: [],
    sectors: [],
    evidence: {
      limitUpPool: evidence("complete", "ok"),
      ladder: evidence("complete", "ok"),
      hotStocks: evidence("complete", "ok"),
      skyrocket: evidence("partial", "empty"),
      dragonTiger: evidence("partial", "empty"),
      anomalies: evidence("failed", "HTTP 403"),
      sectors: evidence("failed", "HTTP 403"),
    },
    errors: ["异动原因：HTTP 403", "板块：HTTP 403"],
  };
}

describe("structured signal fallback", () => {
  it("uses verified THS labels and Eastmoney sectors without inventing analysis", () => {
    const result = applyStructuredSignalFallbacks({
      signals: signals(),
      popularity: {
        source: "同花顺热榜",
        status: "complete",
        marketTime: "2026-07-27T15:00:00+08:00",
        receivedAt: "2026-07-27T08:01:00.000Z",
        rawCount: 30,
        items: [{
          symbol: "000001.SZ",
          name: "平安银行",
          rank: 1,
          rankChange: 0,
          heat: 100,
          concepts: ["银行"],
          analysisTitle: "银行板块活跃",
        }],
        message: "ok",
      },
      sectors: [{ name: "银行", limitUpCount: 1, averagePct: 1.2, amountGrowthPct: null, maxStreak: 1 }],
      referenceDate: "2026-07-27",
      receivedAt: "2026-07-27T08:02:00.000Z",
    });

    expect(result?.anomalies).toEqual([{
      symbol: "000001.SZ",
      name: "平安银行",
      title: "银行板块活跃",
      analysis: null,
      keywords: ["银行"],
    }]);
    expect(result?.sectors[0]?.name).toBe("银行");
    expect(result?.evidence.anomalies.source).toContain("同花顺");
    expect(result?.evidence.sectors.source).toContain("东方财富");
    expect(result?.errors).toEqual([]);
  });
});
