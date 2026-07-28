import { describe, expect, it } from "vitest";
import {
  aggregateBars,
  fetchEastmoneyDailyBars,
  fetchEastmoneyMinuteBars,
  loadEtfBarsWithFallback,
  fetchBaiduDailyBars,
  fetchSinaDailyBars,
  fetchSinaMinuteBars,
  sanitizeMarketBars,
  type MarketBar,
} from "../lib/etf/bars";

const bars: MarketBar[] = [
  { time: "2026-07-13", open: 1, high: 1.2, low: .9, close: 1.1, volume: 100, amount: 110 },
  { time: "2026-07-14", open: 1.1, high: 1.3, low: 1.05, close: 1.2, volume: 200, amount: 240 },
  { time: "2026-07-20", open: 1.2, high: 1.4, low: 1.1, close: 1.35, volume: 250, amount: 330 },
];

describe("ETF market bar aggregation", () => {
  const fuyaoRows = [
    {
      date_ms: Date.parse("2026-07-13T00:00:00+08:00"),
      open_price: 1,
      high_price: 1.2,
      low_price: .9,
      close_price: 1.1,
      volume: 100,
      turnover: 110,
    },
    {
      date_ms: Date.parse("2026-07-14T00:00:00+08:00"),
      open_price: 1.1,
      high_price: 1.3,
      low_price: 1.05,
      close_price: 1.2,
      volume: 200,
      turnover: 240,
    },
  ];

  const mcpResponse = (data: unknown) => Response.json({
    jsonrpc: "2.0",
    id: 2,
    result: {
      structuredContent: {
        code: 0,
        message: "success",
        request_id: "etf-bars-request",
        data,
      },
    },
  });

  const createFuyaoBarsFetcher = (onPublicRequest?: (url: string) => Response) => async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as {
      method?: string;
      params?: { name?: string };
    } : null;
    if (body?.method === "initialize") {
      return Response.json({ jsonrpc: "2.0", id: 1, result: {} }, {
        headers: { "Mcp-Session-Id": "session-etf-bars" },
      });
    }
    if (body?.params?.name === "get_fund_market_historical") {
      return mcpResponse({ item: fuyaoRows });
    }
    if (onPublicRequest) return onPublicRequest(String(input));
    throw new Error(`unexpected request ${String(input)}`);
  };

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

  it("deduplicates, sorts and rejects invalid provider bars", () => {
    expect(sanitizeMarketBars([
      bars[1],
      { ...bars[0], close: -1 },
      bars[0],
      { ...bars[0], close: 1.15 },
      { ...bars[2], volume: -1 },
    ])).toEqual([
      { ...bars[0], close: 1.15 },
      bars[1],
    ]);
  });

  it("uses Fuyao as the primary unadjusted ETF daily source", async () => {
    const fetcher = createFuyaoBarsFetcher();
    await expect(loadEtfBarsWithFallback(
      "510300",
      "day",
      "none",
      fetcher as typeof fetch,
      { apiKey: "secret" },
    )).resolves.toMatchObject({
      source: "扶摇 Fuyao",
      fallbackSource: null,
      status: "complete",
      appliedPeriod: "day",
      appliedAdjustment: "none",
      bars: [{ time: "2026-07-13" }, { time: "2026-07-14" }],
    });
  });

  it("aggregates Fuyao daily bars into weekly bars on the server", async () => {
    const fetcher = createFuyaoBarsFetcher();
    await expect(loadEtfBarsWithFallback(
      "510300",
      "week",
      "none",
      fetcher as typeof fetch,
      { apiKey: "secret" },
    )).resolves.toMatchObject({
      source: "扶摇 Fuyao（日K聚合周K）",
      appliedPeriod: "week",
      bars: [{
        time: "2026-07-14",
        open: 1,
        high: 1.3,
        low: .9,
        close: 1.2,
        volume: 300,
        amount: 350,
      }],
    });
  });

  it("does not use Fuyao when Eastmoney supplies the requested forward-adjusted bars", async () => {
    let mcpRequested = false;
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) mcpRequested = true;
      return Response.json({
        data: {
          klines: ["2026-07-22,4.761,4.775,4.779,4.751,271280,129163542.000"],
        },
      });
    };

    await expect(loadEtfBarsWithFallback(
      "510300",
      "day",
      "forward",
      fetcher as typeof fetch,
      { apiKey: "secret" },
    )).resolves.toMatchObject({
      source: "东方财富",
      status: "complete",
      appliedAdjustment: "forward",
    });
    expect(mcpRequested).toBe(false);
  });

  it("marks Fuyao as an unadjusted fallback instead of claiming forward adjustment", async () => {
    const fetcher = createFuyaoBarsFetcher((url) => {
      if (url.includes("eastmoney.com")) return new Response("unavailable", { status: 520 });
      throw new Error(`unexpected public request ${url}`);
    });

    await expect(loadEtfBarsWithFallback(
      "510300",
      "day",
      "forward",
      fetcher as typeof fetch,
      { apiKey: "secret" },
    )).resolves.toMatchObject({
      source: "扶摇 Fuyao（不复权）",
      fallbackSource: "扶摇 Fuyao",
      status: "partial",
      appliedAdjustment: "none",
      message: expect.stringContaining("未冒充前复权"),
    });
  });

  it("uses Tencent qfq OHLC bars before any unadjusted fallback", async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("eastmoney.com")) return new Response("unavailable", { status: 520 });
      if (url.includes("web.ifzq.gtimg.cn")) {
        return Response.json({
          code: 0,
          data: {
            sh511880: {
              qfqday: [
                ["2026-07-21", "99.10", "99.20", "99.30", "99.00", "1000", "99200"],
                ["2026-07-22", "99.20", "99.25", "99.35", "99.15", "1200", "119100"],
              ],
            },
          },
        });
      }
      throw new Error(`unexpected public request ${url}`);
    };

    await expect(loadEtfBarsWithFallback(
      "511880",
      "day",
      "forward",
      fetcher as typeof fetch,
    )).resolves.toMatchObject({
      source: "腾讯证券（前复权）",
      fallbackSource: "腾讯证券",
      status: "complete",
      appliedAdjustment: "forward",
      bars: [{ time: "2026-07-21" }, { time: "2026-07-22" }],
    });
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

  it("maps Baidu daily K-line fields including authoritative turnover amount", async () => {
    let requestedUrl = "";
    let requestHeaders: HeadersInit | undefined;
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestHeaders = init?.headers;
      return new Response(JSON.stringify({
        ResultCode: "0",
        Result: {
          newMarketData: {
            keys: ["timestamp", "time", "open", "close", "volume", "high", "low", "amount"],
            marketData: [
              "1784592000,2026-07-21,4.70,4.76,200,4.80,4.68,952.00",
              "1784678400,2026-07-22,4.76,4.88,300,4.90,4.73,1464.00",
            ].join(";"),
          },
        },
      }));
    };

    await expect(fetchBaiduDailyBars("510300", fetcher as typeof fetch)).resolves.toEqual([
      { time: "2026-07-21", open: 4.7, close: 4.76, high: 4.8, low: 4.68, volume: 200, amount: 952 },
      { time: "2026-07-22", open: 4.76, close: 4.88, high: 4.9, low: 4.73, volume: 300, amount: 1464 },
    ]);
    expect(requestedUrl).toContain("code=510300");
    const headers = new Headers(requestHeaders);
    expect(headers.get("origin")).toBe("https://gushitong.baidu.com");
    expect(headers.get("referer")).toBe("https://gushitong.baidu.com/");
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
      if (url.includes("finance.pae.baidu.com")) return new Response("upstream unavailable", { status: 520 });
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

  it("uses Baidu as the exact-amount daily fallback before Sina", async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("eastmoney.com")) return new Response("upstream unavailable", { status: 520 });
      if (url.includes("finance.pae.baidu.com")) {
        return new Response(JSON.stringify({
          ResultCode: "0",
          Result: {
            newMarketData: {
              keys: ["time", "open", "close", "volume", "high", "low", "amount"],
              marketData: "2026-07-21,4.70,4.76,200,4.80,4.68,952.00;2026-07-22,4.76,4.88,300,4.90,4.73,1464.00",
            },
          },
        }));
      }
      throw new Error("Sina should not be requested when Baidu succeeds");
    };

    await expect(loadEtfBarsWithFallback("510300", "day", "forward", fetcher as typeof fetch)).resolves.toMatchObject({
      source: "百度股市通（不复权）",
      status: "partial",
      appliedAdjustment: "none",
      bars: [{ time: "2026-07-21", amount: 952 }, { time: "2026-07-22", amount: 1464 }],
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

  it("never calls Fuyao for minute bars", async () => {
    let mcpRequested = false;
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) mcpRequested = true;
      return Response.json({
        data: {
          trends: ["2026-07-22 09:31,4.761,4.775,4.779,4.751,271280,129163542.000"],
        },
      });
    };

    await expect(loadEtfBarsWithFallback(
      "510300",
      "minute",
      "forward",
      fetcher as typeof fetch,
      { apiKey: "secret" },
    )).resolves.toMatchObject({
      source: "东方财富",
      appliedPeriod: "minute",
      appliedAdjustment: "none",
    });
    expect(mcpRequested).toBe(false);
  });
});
