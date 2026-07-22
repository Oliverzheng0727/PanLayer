import { describe, expect, it } from "vitest";
import { aggregateBars, fetchEastmoneyMinuteBars, type MarketBar } from "../lib/etf/bars";

const bars: MarketBar[] = [
  { time: "2026-07-13", open: 1, high: 1.2, low: .9, close: 1.1, volume: 100, amount: 110 },
  { time: "2026-07-14", open: 1.1, high: 1.3, low: 1.05, close: 1.2, volume: 200, amount: 240 },
  { time: "2026-07-20", open: 1.2, high: 1.4, low: 1.1, close: 1.35, volume: 250, amount: 330 },
];

describe("ETF market bar aggregation", () => {
  it("aggregates daily bars into exchange weeks", () => {
    expect(aggregateBars(bars, "week")).toEqual([
      { time: "2026-07-14", open: 1, high: 1.3, low: .9, close: 1.2, volume: 300, amount: 350 },
      { time: "2026-07-20", open: 1.2, high: 1.4, low: 1.1, close: 1.35, volume: 250, amount: 330 },
    ]);
  });

  it("aggregates daily bars into calendar months", () => {
    expect(aggregateBars(bars, "month")).toEqual([
      { time: "2026-07-20", open: 1, high: 1.4, low: .9, close: 1.35, volume: 550, amount: 680 },
    ]);
  });

  it("maps Eastmoney minute trend fields to OHLCV correctly", async () => {
    const fetcher = async () => new Response(JSON.stringify({ data: { trends: ["2026-07-22 09:31,4.761,4.775,4.779,4.751,271280,129163542.000,4.7565"] } }));
    await expect(fetchEastmoneyMinuteBars("510300", fetcher as typeof fetch)).resolves.toEqual([{
      time: "2026-07-22 09:31", open: 4.761, close: 4.775, high: 4.779, low: 4.751,
      volume: 271280, amount: 129163542,
    }]);
  });
});
