import { describe, expect, it } from "vitest";
import type { HistoryRow } from "../lib/history/query";
import {
  TREND_METRIC_CONFIGS,
  buildTrendPoints,
  type TrendMetricKey,
} from "../lib/history/trends";

function row(date: string, patch: Partial<HistoryRow> = {}): HistoryRow {
  return {
    date,
    rising: 3000,
    falling: 1800,
    flat: 100,
    riseFallRatio: 1.67,
    limitUp: 80,
    limitDown: 5,
    largeRise: 20,
    brokenCount: 12,
    largeDownCount: 14,
    sealRate: 86.96,
    yesterdaySuccessRate: 61.2,
    continuationPositiveRate: 66.7,
    continuationAveragePct: 2.4,
    continuationPromotionRate: 28.6,
    marketAmount: 1_600_000_000_000,
    consecutive: 15,
    maxStreak: 5,
    maxBoardNames: "示例股份",
    brokenBoardCount: 4,
    brokenBoardRate: 22.2,
    cycleLeader: "示例股份 · 5板",
    recognition: "示例股份",
    indexSummary: "上证指数 +1.20%",
    openPremium: 1.1,
    closePremium: 2.2,
    high20: 44,
    high120: 18,
    allTimeHigh: 7,
    marginBalance: 27_100.2,
    topSector: "科技",
    backfilled: false,
    status: "complete",
    source: "东方财富",
    updatedAt: `${date} 16:10:00`,
    ...patch,
  };
}

describe("metric trend configuration", () => {
  it("maps all six overview metrics to the expected history fields", () => {
    const expected: Record<TrendMetricKey, string[]> = {
      breadth: ["rising", "falling"],
      limits: ["limitUp", "limitDown"],
      consecutive: ["consecutive", "maxStreak"],
      highs: ["high20", "high120", "allTimeHigh"],
      premium: ["openPremium", "closePremium"],
      margin: ["marginBalance"],
    };

    expect(Object.keys(TREND_METRIC_CONFIGS)).toEqual(Object.keys(expected));
    for (const key of Object.keys(expected) as TrendMetricKey[]) {
      expect(TREND_METRIC_CONFIGS[key].series.map((series) => series.field)).toEqual(expected[key]);
    }
  });

  it("sorts chronologically and limits by trading rows", () => {
    const rows = Array.from({ length: 130 }, (_, index) => {
      const day = String(index + 1).padStart(3, "0");
      return row(`2026-${day}`, { rising: index });
    }).reverse();

    const points = buildTrendPoints(rows, "breadth", 60);

    expect(points).toHaveLength(60);
    expect(points[0].date).toBe("2026-071");
    expect(points.at(-1)?.date).toBe("2026-130");
    expect(points[0].values.rising).toBe(70);
    expect(buildTrendPoints(rows, "breadth", "all")).toHaveLength(130);
  });

  it("keeps null gaps, excludes failed and demo values, and marks partial rows", () => {
    const points = buildTrendPoints([
      row("2026-07-21", { rising: null }),
      row("2026-07-22", { status: "failed", rising: 1234 }),
      row("2026-07-23", { status: "demo", rising: 2345 }),
      row("2026-07-24", { status: "partial", rising: 3456 }),
    ], "breadth", "all");

    expect(points.map((point) => point.values.rising)).toEqual([null, null, null, 3456]);
    expect(points.at(-1)?.quality).toBe("partial");
    expect(points.at(-1)?.source).toBe("东方财富");
  });

  it("reports whether a selected period contains any verified values", () => {
    const empty = buildTrendPoints([
      row("2026-07-21", { marginBalance: null }),
      row("2026-07-22", { marginBalance: null, status: "partial" }),
    ], "margin", 20);
    const available = buildTrendPoints([
      row("2026-07-23", { marginBalance: 27_100.2 }),
    ], "margin", 20);

    expect(empty.some((point) => Object.values(point.values).some((value) => value !== null))).toBe(false);
    expect(available.some((point) => Object.values(point.values).some((value) => value !== null))).toBe(true);
  });
});
