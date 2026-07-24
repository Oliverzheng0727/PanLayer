import { describe, expect, it } from "vitest";
import {
  aggregateBars,
  fetchEastmoneyDailyBars,
  fetchEastmoneyMinuteBars,
  loadEtfBarsWithFallback,
  fetchSinaDailyBars,
  fetchSinaMinuteBars,
  type MarketBar,
} from "../lib/etf/bars";

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

  it("bounds each upstream K-line request with an abort signal", async () => {
    let requestSignal: AbortSignal | null | undefined;
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal;
      return new Response(JSON.stringify({ data: { trends: [] } }));
    };

    await fetchEastmoneyMinuteBars("510300", fetcher as typeof fetch);
    expect(requestSignal).toBeInstanceOf(AbortSignal);
  });

  it("uses browser-compatible Eastmoney headers for historical ETF requests", async () => {
    let requestHeaders: HeadersInit | undefined;
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestHeaders = init?.headers;
      return new Response(JSON.stringify({ data: { klines: [] } }));
    };

    await fetchEastmoneyDailyBars("510300", "none", fetcher as typeof fetch);
    const headers = new Headers(requestHeaders);
    expect(headers.get("referer")).toBe("https://quote.eastmoney.com/");
    expect(headers.get("origin")).toBe("https://quote.eastmoney.com");
  });

  it("maps Sina daily K-line JSON and uses the Shanghai market prefix", async () => {
    let requestedUrl = "";
    const fetcher = async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify([
        { day: "2026-07-22", open: "4.761", high: "4.779", low: "4.751", close: "4.775", volume: "271280" },
      ]));
    };

    await expect(fetchSinaDailyBars("510300", fetcher as typeof fetch)).resolves.toEqual([{
      time: "2026-07-22", open: 4.761, close: 4.775, high: 4.779, low: 4.751,
      volume: 271280, amount: 0,
    }]);
    expect(requestedUrl).toContain("symbol=sh510300");
  });

  it("parses Sina minute JSONP and uses the Shenzhen market prefix", async () => {
    let requestedUrl = "";
    const fetcher = async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(
        `/*<script>location.href='//sina.com';</script>*/\nvar _sz159001_5_240=([{"day":"2026-07-22 09:35:00","open":"1.021","high":"1.026","low":"1.019","close":"1.024","volume":"123400","amount":"126300.50"}]);`,
      );
    };

    await expect(fetchSinaMinuteBars("159001", fetcher as typeof fetch)).resolves.toEqual([{
      time: "2026-07-22 09:35", open: 1.021, close: 1.024, high: 1.026, low: 1.019,
      volume: 123400, amount: 126300.5,
    }]);
    expect(requestedUrl).toContain("symbol=sz159001");
  });

  it("rejects malformed Sina JSONP instead of treating it as valid empty data", async () => {
    const fetcher = async () => new Response("var broken=(not-json);");
    await expect(fetchSinaMinuteBars("159001", fetcher as typeof fetch)).rejects.toThrow("Sina JSONP");
  });

  it("falls back to Sina without claiming forward adjustment when Eastmoney fails", async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("eastmoney.com")) return new Response("upstream unavailable", { status: 520 });
      return new Response(JSON.stringify([
        { day: "2026-07-21", open: "4.70", high: "4.80", low: "4.68", close: "4.76", volume: "200" },
        { day: "2026-07-22", open: "4.76", high: "4.90", low: "4.73", close: "4.88", volume: "300" },
      ]));
    };

    await expect(loadEtfBarsWithFallback("510300", "day", "forward", fetcher as typeof fetch)).resolves.toMatchObject({
      source: "新浪财经（不复权）",
      status: "partial",
      appliedAdjustment: "none",
      bars: [{ time: "2026-07-21" }, { time: "2026-07-22" }],
    });
  });

  it("uses Sina five-minute bars as the intraday fallback", async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("eastmoney.com")) return new Response("upstream unavailable", { status: 520 });
      return new Response(
        `var _sz159001_5_240=([{"day":"2026-07-22 09:35:00","open":"1.021","high":"1.026","low":"1.019","close":"1.024","volume":"123400","amount":"126300.50"}]);`,
      );
    };

    await expect(loadEtfBarsWithFallback("159001", "minute", "forward", fetcher as typeof fetch)).resolves.toMatchObject({
      source: "新浪财经（5分钟）",
      status: "partial",
      appliedAdjustment: "none",
      bars: [{ time: "2026-07-22 09:35" }],
    });
  });
});
