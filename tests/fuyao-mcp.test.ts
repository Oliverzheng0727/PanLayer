import { describe, expect, it, vi } from "vitest";
import {
  createFuyaoMcpClient,
  mergeVerifiedIndexSnapshots,
} from "../lib/data/fuyao-mcp";
import type { IndexSnapshot } from "../lib/data/provider";

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
    const client = createFuyaoMcpClient({ apiKey: "secret", fetcher: fetcher as typeof fetch });
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
      sector: "未分类",
    });
    expect(fetcher.mock.calls.some((call) => String(call[1]?.body).includes("secret"))).toBe(false);
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
          }],
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const client = createFuyaoMcpClient({ apiKey: "secret", fetcher: fetcher as typeof fetch });
    const items = await client.searchEtfSnapshots("新能源电池", 5);

    expect(items).toEqual([expect.objectContaining({
      symbol: "158008",
      name: "新能源电池ETF华夏",
      exchange: "SZ",
      category: "新能源",
      price: 1.234,
      pctChange: 1.25,
      amount: 88_000_000,
    })]);
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
    const client = createFuyaoMcpClient({ apiKey: "secret", fetcher: fetcher as typeof fetch });

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
      if (tool === "get_a_share_special_data_hot_stock_list") {
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
    const client = createFuyaoMcpClient({ apiKey: "secret", fetcher: fetcher as typeof fetch });
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
