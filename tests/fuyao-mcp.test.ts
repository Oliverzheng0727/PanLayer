import { describe, expect, it, vi } from "vitest";
import {
  createFuyaoMcpClient,
  mergeVerifiedIndexSnapshots,
} from "../lib/data/fuyao-mcp";
import type { EtfSnapshot, IndexSnapshot } from "../lib/data/provider";

function mcpResult(data: unknown) {
  return Response.json({
    jsonrpc: "2.0",
    id: 2,
    result: {
      structuredContent: {
        code: 0,
        message: "success",
        request_id: "request-1",
        data,
      },
    },
  });
}

function restResult(data: unknown, requestId = "rest-request-1") {
  return Response.json({
    code: 0,
    message: "success",
    request_id: requestId,
    data,
  });
}

function createFetcher(handler: (tool: string, args: Record<string, unknown>) => Response) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      method?: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
    };
    if (body.method === "initialize") {
      return Response.json({ jsonrpc: "2.0", id: 1, result: {} }, {
        headers: { "Mcp-Session-Id": "session-1" },
      });
    }
    return handler(body.params?.name ?? "", body.params?.arguments ?? {});
  });
}

describe("Fuyao REST adapter", () => {
  it("uses the documented REST endpoint and X-api-key header before MCP", async () => {
    let requestedUrl = "";
    let requestedHeaders: HeadersInit | undefined;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedHeaders = init?.headers;
      return restResult({
        item: [
          { date_ms: Date.parse("2026-07-24T00:00:00+08:00"), close_price: 10, turnover: 100 },
        ],
      });
    });
    const client = createFuyaoMcpClient({ apiKey: "secret", fetcher: fetcher as typeof fetch });

    await expect(client.fetchAShareAdjustedBars("600000.SH")).resolves.toHaveLength(1);

    const url = new URL(requestedUrl);
    expect(url.origin + url.pathname).toBe("https://fuyao.aicubes.cn/api/a-share/prices/historical");
    expect(url.searchParams.get("thscode")).toBe("600000.SH");
    expect(url.searchParams.get("adjust")).toBe("forward");
    expect(new Headers(requestedHeaders).get("X-api-key")).toBe("secret");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not retry business errors through MCP", async () => {
    const fetcher = vi.fn(async () => Response.json({
      code: 2003,
      message: "permission denied",
      request_id: "denied",
      data: null,
    }));
    const client = createFuyaoMcpClient({ apiKey: "secret", fetcher: fetcher as typeof fetch });

    await expect(client.fetchAShareAdjustedBars("600000.SH")).rejects.toThrow("code 2003");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("falls back to the compatible MCP endpoint when REST transport is unavailable", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "GET") return new Response("unavailable", { status: 503 });
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        method?: string;
        params?: { name?: string };
      };
      if (body.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: 1, result: {} }, {
          headers: { "Mcp-Session-Id": "session-rest-fallback" },
        });
      }
      if (body.params?.name === "get_a_share_prices_historical") {
        return mcpResult({
          item: [
            { date_ms: Date.parse("2026-07-24T00:00:00+08:00"), close_price: 10, turnover: 100 },
          ],
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const client = createFuyaoMcpClient({ apiKey: "secret", fetcher: fetcher as typeof fetch });

    await expect(client.fetchAShareAdjustedBars("600000.SH")).resolves.toHaveLength(1);
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "GET")).toBe(true);
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
  });

  it("keeps explicit A-share snapshot batches within the official 100-symbol limit", async () => {
    const tickers = Array.from({ length: 205 }, (_, index) => {
      const ticker = String(600000 + index).padStart(6, "0");
      return {
        thscode: `${ticker}.SH`,
        ticker,
        name: `测试${ticker}`,
        exchange: "SH",
        asset_type: "a-share",
      };
    });
    const snapshotSizes: number[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/meta/tickers/list") {
        return restResult({ item: tickers });
      }
      if (url.pathname === "/api/a-share/prices/snapshot") {
        const symbols = String(url.searchParams.get("thscodes") ?? "").split(",").filter(Boolean);
        snapshotSizes.push(symbols.length);
        return restResult({
          item: symbols.map((symbol) => ({
            thscode: symbol,
            ticker: symbol.slice(0, 6),
            last_price: 10,
            prev_price: 9,
            turnover: 1_000_000,
            price_change_ratio_pct: 11.11,
          })),
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const client = createFuyaoMcpClient({ apiKey: "secret", fetcher: fetcher as typeof fetch });

    await expect(client.fetchAShareQuotes([], { includeST: true })).resolves.toHaveLength(205);
    expect(snapshotSizes.toSorted((left, right) => right - left)).toEqual([100, 100, 5]);
  });

  it("paginates the Fuyao ticker catalogue instead of truncating at 10,000", async () => {
    const firstPage = Array.from({ length: 10_000 }, (_, index) => ({
      thscode: `${String(600000 + index).padStart(6, "0")}.SH`,
      ticker: String(600000 + index).padStart(6, "0"),
      name: `测试${index}`,
      exchange: "SH",
      asset_type: "a-share",
    }));
    const secondPage = [{
      thscode: "000001.SZ",
      ticker: "000001",
      name: "平安银行",
      exchange: "SZ",
      asset_type: "a-share",
    }];
    const offsets: number[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname !== "/api/meta/tickers/list") return new Response("unexpected", { status: 500 });
      const offset = Number(url.searchParams.get("offset"));
      offsets.push(offset);
      return restResult({ item: offset === 0 ? firstPage : secondPage });
    });
    const client = createFuyaoMcpClient({ apiKey: "secret", fetcher: fetcher as typeof fetch });

    await expect(client.listTickers("a-share")).resolves.toHaveLength(10_001);
    expect(offsets).toEqual([0, 10_000]);
  });

  it("splits full-history adjusted bars into official ten-year windows", async () => {
    const windows: Array<{ start: number; end: number }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      windows.push({
        start: Number(url.searchParams.get("start")),
        end: Number(url.searchParams.get("end")),
      });
      return restResult({
        item: [{
          date_ms: Number(url.searchParams.get("end")),
          close_price: windows.length,
          volume: 100,
        }],
      });
    });
    const client = createFuyaoMcpClient({ apiKey: "secret", fetcher: fetcher as typeof fetch });

    const bars = await client.fetchAShareAdjustedBars(
      "600000.SH",
      new Date("2026-07-28T00:00:00Z"),
      { fullHistory: true },
    );

    expect(windows.length).toBeGreaterThan(1);
    expect(windows.every((window) => window.end - window.start <= 10 * 365 * 86_400_000)).toBe(true);
    expect(bars.length).toBe(windows.length);
  });

  it("rejects inconsistent adjusted closes across overlapping windows", async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return restResult({
        item: [{
          date_ms: Date.parse("2016-01-04T00:00:00+08:00"),
          close_price: calls === 1 ? 10 : 11,
        }],
      });
    });
    const client = createFuyaoMcpClient({ apiKey: "secret", fetcher: fetcher as typeof fetch });

    await expect(client.fetchAShareAdjustedBars(
      "600000.SH",
      new Date("2026-07-28T00:00:00Z"),
      { fullHistory: true },
    )).rejects.toThrow("forward-adjusted history mismatch");
    expect(calls).toBeGreaterThan(1);
  });

  it("uses an explicit narrow range for daily contribution increments", async () => {
    const windows: Array<{ start: number; end: number }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      windows.push({
        start: Number(url.searchParams.get("start")),
        end: Number(url.searchParams.get("end")),
      });
      return restResult({
        item: [
          {
            date_ms: Date.parse("2026-07-29T00:00:00+08:00"),
            close_price: 10,
            turnover: 100,
          },
          {
            date_ms: Date.parse("2026-07-30T00:00:00+08:00"),
            close_price: 11,
            turnover: 200,
          },
        ],
      });
    });
    const client = createFuyaoMcpClient({ apiKey: "secret", fetcher: fetcher as typeof fetch });

    const bars = await client.fetchAShareAdjustedBars(
      "600000.SH",
      new Date("2026-07-31T00:00:00Z"),
      {
        startAt: "2026-07-29T00:00:00+08:00",
        endAt: "2026-07-30T23:59:59+08:00",
      },
    );

    expect(windows).toHaveLength(1);
    expect(windows[0]).toEqual({
      start: Date.parse("2026-07-29T00:00:00+08:00"),
      end: Date.parse("2026-07-30T23:59:59+08:00"),
    });
    expect(bars.at(-1)?.pctChange).toBe(10);
  });

  it("uses the REST-only full anomaly list before candidate fallback", async () => {
    const requestedPaths: string[] = [];
    const date = "2026-07-24";
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedPaths.push(url.pathname);
      if (url.pathname.endsWith("/limit-up-pool")) {
        return restResult({ pagination: { total: 0, pages: 1 }, item: [] });
      }
      if (url.pathname.endsWith("/limit-up-ladder")) {
        return restResult({ item: [{ date, boards: {} }] });
      }
      if (url.pathname.endsWith("/hot-stock-list") || url.pathname.endsWith("/skyrocket-list")) {
        return restResult({ item: [] });
      }
      if (url.pathname.endsWith("/dragon-tiger-list")) {
        return restResult({ stock_items: [] });
      }
      if (url.pathname.endsWith("/anomaly-analysis-list")) {
        return restResult({
          item: [{
            thscode: "600001.SH",
            stock_name: "测试股份",
            tag_name: "快速拉升",
            analysis_content: "公开异动原因",
            keyword_list: ["机器人"],
          }],
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const client = createFuyaoMcpClient({ apiKey: "secret", fetcher: fetcher as typeof fetch });

    const signals = await client.fetchStructuredMarketSignals(
      date,
      new Date("2026-07-24T08:00:00Z"),
      undefined,
      { disabledDatasets: new Set(["sectors"]) },
    );

    expect(requestedPaths).toContain("/api/a-share/special-data/anomaly-analysis-list");
    expect(requestedPaths).not.toContain("/api/a-share/special-data/anomaly-analysis-stock");
    expect(signals.anomalies[0]).toMatchObject({
      symbol: "600001.SH",
      title: "快速拉升",
      keywords: ["机器人"],
    });
    expect(signals.evidence.anomalies).toMatchObject({
      status: "complete",
      coveragePct: 100,
    });
  });
});

describe("Fuyao MCP adapter", () => {
  it("maps verified A-share snapshots into the shared quote contract", async () => {
    const fetcher = createFetcher((tool, args) => {
      if (tool === "get_meta_tickers_list") {
        return mcpResult({
          item: [
            { thscode: "600000.SH", ticker: "600000", name: "浦发银行", exchange: "SH", asset_type: "a-share" },
            { thscode: "300001.SZ", ticker: "300001", name: "*ST测试", exchange: "SZ", asset_type: "a-share" },
          ],
        });
      }
      if (tool === "get_a_share_prices_snapshot") {
        const symbols = String(args.thscodes).split(",");
        return mcpResult({
          total: symbols.length,
          item: symbols.map((symbol, index) => ({
            thscode: symbol,
            ticker: symbol.slice(0, 6),
            last_price: index ? 20 : 10,
            prev_price: index ? 18 : 9,
            open_price: index ? 19 : 9.5,
            high_price: index ? 21 : 10.2,
            low_price: index ? 17 : 9.4,
            turnover: 1_000_000 + index,
            price_change_ratio_pct: index ? 11.11 : 11.12,
          })),
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const client = createFuyaoMcpClient({
      apiKey: "secret",
      fetcher: fetcher as typeof fetch,
      transport: "mcp-only",
    });
    const quotes = await client.fetchAShareQuotes(["600000.SH", "300001.SZ"]);

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      symbol: "600000.SH",
      name: "浦发银行",
      exchange: "SH",
      board: "MAIN",
      price: 10,
      previousClose: 9,
      amount: 1_000_000,
      turnoverRate: null,
      sector: "未分类",
    });
    expect(fetcher.mock.calls.some((call) => String(call[1]?.body).includes("secret"))).toBe(false);
  });

  it("keeps ST only for the all-market aggregate and reports amount in 亿元", async () => {
    const fetcher = createFetcher((tool) => {
      if (tool === "get_meta_tickers_list") {
        return mcpResult({
          item: [
            { thscode: "600000.SH", ticker: "600000", name: "浦发银行", exchange: "SH", asset_type: "a-share" },
            { thscode: "600001.SH", ticker: "600001", name: "*ST测试", exchange: "SH", asset_type: "a-share" },
          ],
        });
      }
      if (tool === "get_a_share_prices_snapshot") {
        return mcpResult({
          item: [
            { thscode: "600000.SH", last_price: 10, prev_price: 9, turnover: 100_000_000 },
            { thscode: "600001.SH", last_price: 5, prev_price: 5.1, turnover: 50_000_000 },
          ],
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const client = createFuyaoMcpClient({
      apiKey: "secret",
      fetcher: fetcher as typeof fetch,
      transport: "mcp-only",
    });

    await expect(client.fetchAShareQuotes([])).resolves.toHaveLength(1);
    await expect(client.fetchMarketAggregate([], "15:00", new Date("2026-07-27T07:00:00Z")))
      .resolves.toMatchObject({
        amount: 1.5,
        rawCount: 2,
        validCount: 2,
        coveragePct: 100,
        status: "complete",
        source: "扶摇 Fuyao",
      });
  });

  it("maps forward-adjusted A-share bars for the new-high initializer", async () => {
    const fetcher = createFetcher((tool, args) => {
      if (tool === "get_a_share_prices_historical") {
        expect(args.adjust).toBe("forward");
        return mcpResult({
          item: [
            { date_ms: Date.parse("2026-07-23T00:00:00+08:00"), close_price: 9, turnover: 90 },
            { date_ms: Date.parse("2026-07-24T00:00:00+08:00"), close_price: 10, turnover: 100 },
          ],
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const client = createFuyaoMcpClient({
      apiKey: "secret",
      fetcher: fetcher as typeof fetch,
      transport: "mcp-only",
    });

    await expect(client.fetchAShareAdjustedBars("600000.SH")).resolves.toEqual([
      { date: "2026-07-23", close: 9, amount: 90, pctChange: undefined },
      { date: "2026-07-24", close: 10, amount: 100, pctChange: 11.111111 },
    ]);
  });

  it("uses the ETF master catalog and only exposes matches with a live snapshot", async () => {
    const fetcher = createFetcher((tool) => {
      if (tool === "get_meta_tickers_search") {
        return mcpResult({
          item: [
            { thscode: "158008.SZ", ticker: "158008", name: "新能源电池ETF华夏", exchange: "SZ", asset_type: "fund-etf" },
          ],
        });
      }
      if (tool === "get_fund_market_snapshot") {
        return mcpResult({
          timestamp: Date.parse("2026-07-27T15:00:00+08:00"),
          item: [{
            thscode: "158008.SZ",
            ticker: "158008",
            last_price: 1.234,
            price_change_ratio_pct: 1.25,
            turnover: 88_000_000,
            turnover_ratio_pct: 6.75,
          }],
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const client = createFuyaoMcpClient({
      apiKey: "secret",
      fetcher: fetcher as typeof fetch,
      transport: "mcp-only",
    });
    const items = await client.searchEtfSnapshots("新能源电池", 5);

    expect(items).toEqual([expect.objectContaining({
      symbol: "158008",
      name: "新能源电池ETF华夏",
      exchange: "SZ",
      category: "新能源",
      price: 1.234,
      pctChange: 1.25,
      amount: 88_000_000,
      turnoverRate: 6.75,
    })]);
  });

  it("uses the Fuyao ETF master catalog to normalize a cross-checked market catalog", async () => {
    const fetcher = createFetcher((tool) => {
      if (tool === "get_meta_tickers_list") {
        return mcpResult({
          item: [
            { thscode: "510300.SH", ticker: "510300", name: "沪深300ETF华泰柏瑞", exchange: "SH", asset_type: "fund-etf" },
            { thscode: "159995.SZ", ticker: "159995", name: "芯片ETF华夏", exchange: "SZ", asset_type: "fund-etf" },
          ],
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const marketItems: EtfSnapshot[] = [
      {
        symbol: "510300",
        name: "沪深300ETF",
        category: "宽基指数",
        tags: ["宽基"],
        exchange: "SH",
        price: 4.2,
        pctChange: 0.5,
        amount: 5_000_000_000,
        averageAmount20: 4_000_000_000,
        scale: 100_000_000_000,
        turnoverRate: 2,
        status: "active",
        updatedAt: "2026-07-27T15:00:00+08:00",
      },
      {
        symbol: "512800",
        name: "银行ETF",
        category: "金融",
        tags: ["金融"],
        exchange: "SH",
        price: 1.4,
        pctChange: 0.2,
        amount: 1_000_000_000,
        averageAmount20: null,
        scale: null,
        turnoverRate: null,
        status: "active",
        updatedAt: "2026-07-27T15:00:00+08:00",
      },
    ];
    const client = createFuyaoMcpClient({
      apiKey: "secret",
      fetcher: fetcher as typeof fetch,
      transport: "mcp-only",
    });
    const result = await client.mergeEtfMasterCatalog(marketItems);

    expect(result).toMatchObject({
      masterCount: 2,
      matchedCount: 1,
      supplementalCount: 1,
      coveragePct: 50,
    });
    expect(result.items).toEqual([
      expect.objectContaining({
        symbol: "510300",
        name: "沪深300ETF华泰柏瑞",
        price: 4.2,
      }),
      expect.objectContaining({
        symbol: "512800",
        name: "银行ETF",
      }),
    ]);
  });

  it("maps Fuyao ETF daily K-lines without inventing adjustment", async () => {
    const fetcher = createFetcher((tool) => {
      if (tool === "get_fund_market_historical") {
        return mcpResult({
          item: [{
            date_ms: Date.parse("2026-07-24T00:00:00+08:00"),
            open_price: 4.7,
            high_price: 4.8,
            low_price: 4.6,
            close_price: 4.75,
            volume: 100,
            turnover: 475,
          }],
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const client = createFuyaoMcpClient({
      apiKey: "secret",
      fetcher: fetcher as typeof fetch,
      transport: "mcp-only",
    });

    await expect(client.fetchFundDailyBars("510300.SH")).resolves.toEqual([{
      time: "2026-07-24",
      open: 4.7,
      high: 4.8,
      low: 4.6,
      close: 4.75,
      volume: 100,
      amount: 475,
    }]);
  });

  it("builds a bounded first-tier morning evidence snapshot with provenance", async () => {
    const referenceDate = "2026-07-24";
    const referenceMs = Date.parse(`${referenceDate}T00:00:00+08:00`);
    const fetcher = createFetcher((tool) => {
      if (tool === "get_a_share_index_prices_historical") {
        return mcpResult({
          item: [
            { date_ms: referenceMs - 24 * 60 * 60 * 1_000, close_price: 100, turnover: 900 },
            { date_ms: referenceMs, close_price: 101, turnover: 1_000 },
          ],
        });
      }
      if (tool === "get_a_share_special_data_limit_up_pool") {
        return mcpResult({
          pagination: { total: 1 },
          item: [{
            thscode: "600001.SH",
            name: "测试股份",
            continue_day_cnt: 3,
            seal_money: 8_000_000,
            limit_up_time: "09:35",
            limit_up_reason: "算力",
            is_st: false,
          }],
        });
      }
      if (tool === "get_a_share_special_data_limit_up_ladder") {
        return mcpResult({
          item: [{
            date: referenceDate,
            boards: {
              two_board: [],
              three_board: [{ thscode: "600001.SH", name: "测试股份", board_num: 3 }],
              four_board: [],
              five_board: [],
              six_board: [],
              seven_over: [],
            },
          }],
        });
      }
      if (tool === "get_a_share_special_data_hot_stock_list_history") {
        return mcpResult({
          item: [{ thscode: "600001.SH", name: "测试股份", rank: 1, rank_change: 2, heat: "1234" }],
        });
      }
      if (tool === "get_a_share_special_data_dragon_tiger_list") {
        return mcpResult({
          trade_date: referenceDate,
          stock_items: [{
            thscode: "600001.SH",
            name: "测试股份",
            net_value: 10_000,
            org_net_value: 2_000,
            hot_money_net_value: 1_000,
            concept_list: [{ name: "算力" }],
          }],
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const client = createFuyaoMcpClient({
      apiKey: "secret",
      fetcher: fetcher as typeof fetch,
      transport: "mcp-only",
    });
    const evidence = await client.fetchMorningBriefEvidence(referenceDate, new Date("2026-07-27T22:50:00Z"));

    expect(evidence).toMatchObject({
      status: "complete",
      referenceDate,
      datasetSuccess: 5,
      datasetTotal: 5,
      limitUpPool: { total: 1 },
      ladder: { highest: 3 },
    });
    expect(evidence.indices).toHaveLength(5);
    expect(evidence.hotStocks[0]).toMatchObject({ symbol: "600001.SH", rank: 1 });
    expect(evidence.dragonTiger[0]).toMatchObject({ netValue: 10_000, concepts: ["算力"] });
    expect(evidence.requestIds).toEqual(["request-1"]);
  });

  it("collects close signals while keeping rankings as evidence only", async () => {
    const date = "2026-07-24";
    const fetcher = createFetcher((tool) => {
      if (tool === "get_a_share_special_data_limit_up_pool") {
        return mcpResult({
          pagination: { total: 1, pages: 1 },
          item: [{
            thscode: "600001.SH",
            name: "测试股份",
            continue_day_cnt: 3,
            price_change_ratio_pct: 10,
            limit_up_time: "09:35",
            limit_up_reason: "机器人",
            is_st: false,
          }],
        });
      }
      if (tool === "get_a_share_special_data_limit_up_ladder") {
        return mcpResult({ item: [{ date, boards: { three_board: [{ thscode: "600001.SH", name: "测试股份", board_num: 3 }] } }] });
      }
      if (tool === "get_a_share_special_data_hot_stock_list") {
        return mcpResult({ item: [{ thscode: "600001.SH", name: "测试股份", rank: 1, rank_change: 2, heat: "100" }] });
      }
      if (tool === "get_a_share_special_data_skyrocket_list") {
        return mcpResult({ item: [{ thscode: "600001.SH", name: "测试股份", rank: 2, rank_change: 5, heat: "80", analyse: "异动标签" }] });
      }
      if (tool === "get_a_share_special_data_dragon_tiger_list") {
        return mcpResult({ stock_items: [{ thscode: "600001.SH", name: "测试股份", net_value: 20, concept_list: [{ name: "机器人" }] }] });
      }
      if (tool === "get_a_share_special_data_anomal_17ac564c9ba3") {
        return mcpResult({ item: [{ thscode: "600001.SH", stock_name: "测试股份", tag_name: "涨停", analysis_content: "公开异动原因", keyword_list: ["机器人"] }] });
      }
      if (tool === "get_a_share_index_catalog_ths_index_list") {
        return mcpResult({ item: [{ thscode: "884218.TI", name: "机器人" }] });
      }
      if (tool === "get_a_share_index_prices_snapshot") {
        return mcpResult({ item: [{ thscode: "884218.TI", price_change_ratio_pct: 2.5, turnover: 100 }] });
      }
      if (tool === "get_a_share_index_constituents_ths_stock_list") {
        return mcpResult({ item: [{ thscode: "600001.SH", ticker: "600001", name: "测试股份" }] });
      }
      return new Response("unexpected", { status: 500 });
    });
    const client = createFuyaoMcpClient({
      apiKey: "secret",
      fetcher: fetcher as typeof fetch,
      transport: "mcp-only",
    });
    const signals = await client.fetchStructuredMarketSignals(date, new Date("2026-07-24T08:00:00Z"));

    expect(signals).toMatchObject({
      provider: "扶摇 Fuyao",
      referenceDate: date,
      status: "partial",
      datasetSuccess: 7,
      datasetTotal: 7,
    });
    expect(signals.hotStocks[0]).toMatchObject({ symbol: "600001.SH", rank: 1 });
    expect(signals.skyrocket[0]).toMatchObject({ analysis: "异动标签" });
    expect(signals.dragonTiger[0]).toMatchObject({ netValue: 20 });
    expect(signals.anomalies[0]).toMatchObject({ title: "涨停", keywords: ["机器人"] });
    expect(signals.sectors[0]).toMatchObject({ name: "机器人", limitUpCount: 1, averagePct: 2.5, maxStreak: 3 });
  });

  it("marks disagreeing index sources as partial and keeps both source names", () => {
    const base: IndexSnapshot = {
      symbol: "000001.SH",
      name: "上证指数",
      price: 3_800,
      pctChange: 1,
      amount: 1,
      marketTime: "2026-07-27T15:00:00+08:00",
      receivedAt: "2026-07-27T07:00:00Z",
      source: "扶摇 Fuyao",
      status: "complete",
      message: "",
    };
    const merged = mergeVerifiedIndexSnapshots(
      [base],
      [{ ...base, price: 3_700, pctChange: -1, source: "腾讯 / 东方财富" }],
    );

    expect(merged[0]).toMatchObject({
      source: "扶摇 Fuyao / 腾讯 / 东方财富",
      status: "partial",
      price: 3_800,
    });
    expect(merged).toHaveLength(5);
  });
});
