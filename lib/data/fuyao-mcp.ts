import type { Board, Exchange, Quote } from "../domain/types";
import { classifyEtf } from "../etf/catalog";
import type { MarketBar } from "../etf/bars";
import type { EtfSnapshot, IndexSnapshot } from "./provider";

export type FuyaoMcpEndpoint = "meta" | "a-share" | "a-share-index" | "fund";

export interface FuyaoMcpOptions {
  apiKey: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}

interface FuyaoToolEnvelope<T> {
  code: number;
  message: string;
  request_id?: string;
  data: T;
}

interface FuyaoMcpResponse<T> {
  error?: { code?: number; message?: string };
  result?: {
    isError?: boolean;
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: FuyaoToolEnvelope<T>;
  };
}

interface FuyaoTicker {
  thscode: string;
  ticker: string;
  name: string;
  exchange: string;
  asset_type: string;
}

interface FuyaoPriceRow {
  thscode: string;
  ticker: string;
  last_price?: number;
  prev_price?: number;
  open_price?: number;
  high_price?: number;
  low_price?: number;
  turnover?: number;
  volume?: number;
  price_change_ratio_pct?: number;
}

type FuyaoIndexRow = FuyaoPriceRow;

interface FuyaoHistoricalRow {
  date_ms: number;
  open_price?: number;
  high_price?: number;
  low_price?: number;
  close_price?: number;
  volume?: number;
  turnover?: number;
}

interface FuyaoSnapshotData<T> {
  total?: number;
  timestamp?: number;
  item?: T[];
}

interface FuyaoHistoricalData {
  timestamp?: number;
  item?: FuyaoHistoricalRow[];
}

const DEFAULT_FUYAO_MCP_BASE_URL = "https://fuyao.aicubes.cn/mcp";
const FUYAO_PROTOCOL_VERSION = "2025-03-26";
const FUYAO_REQUEST_TIMEOUT_MS = 12_000;
const FUYAO_QUOTE_BATCH_SIZE = 500;
const MINIMUM_FUYAO_QUOTE_COVERAGE = 0.95;

const INDEX_DEFINITIONS = [
  { symbol: "000001.SH", name: "上证指数" },
  { symbol: "399001.SZ", name: "深证成指" },
  { symbol: "399006.SZ", name: "创业板指" },
  { symbol: "000688.SH", name: "科创50" },
  { symbol: "000300.SH", name: "沪深300" },
] as const;

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function beijingDate(now = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

function dateFromMilliseconds(value: number): string {
  return new Date(value + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

function securityMeta(thscode: string): {
  symbol: string;
  code: string;
  exchange: Exchange;
  board: Board;
  limitRate: number;
} {
  const [code, suffix] = thscode.toUpperCase().split(".");
  const exchange: Exchange = suffix === "BJ" || /^(9|8|4)/.test(code)
    ? "BJ"
    : suffix === "SH" || /^6/.test(code) ? "SH" : "SZ";
  const board: Board = exchange === "BJ"
    ? "BEIJING"
    : /^688/.test(code) ? "STAR"
      : /^(300|301)/.test(code) ? "CHINEXT" : "MAIN";
  const limitRate = board === "BEIJING" ? 0.3 : board === "STAR" || board === "CHINEXT" ? 0.2 : 0.1;
  return { symbol: `${code}.${exchange}`, code, exchange, board, limitRate };
}

function parseToolPayload<T>(payload: FuyaoMcpResponse<T>): FuyaoToolEnvelope<T> {
  if (payload.error) {
    throw new Error(`Fuyao MCP ${payload.error.code ?? "error"}: ${payload.error.message ?? "request failed"}`);
  }
  if (payload.result?.isError) {
    const diagnostic = payload.result.content?.find((item) => item.type === "text")?.text;
    throw new Error(`Fuyao MCP tool failed${diagnostic ? `: ${diagnostic.slice(0, 240)}` : ""}`);
  }
  const structured = payload.result?.structuredContent;
  if (structured) return structured;
  const text = payload.result?.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Fuyao MCP returned no structured content");
  try {
    return JSON.parse(text) as FuyaoToolEnvelope<T>;
  } catch {
    throw new Error("Fuyao MCP returned invalid JSON");
  }
}

export class FuyaoMcpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly sessions = new Map<FuyaoMcpEndpoint, Promise<string>>();
  private tickerCache = new Map<string, Promise<FuyaoTicker[]>>();

  constructor(options: FuyaoMcpOptions) {
    if (!options.apiKey.trim()) throw new Error("FUYAO_API_KEY is not configured");
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_FUYAO_MCP_BASE_URL).replace(/\/+$/, "");
    this.fetcher = options.fetcher ?? fetch;
  }

  private endpointUrl(endpoint: FuyaoMcpEndpoint): string {
    return `${this.baseUrl}/${endpoint}`;
  }

  private headers(sessionId?: string): Headers {
    const headers = new Headers({
      "X-api-key": this.apiKey,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    });
    if (sessionId) headers.set("Mcp-Session-Id", sessionId);
    return headers;
  }

  private async initialize(endpoint: FuyaoMcpEndpoint): Promise<string> {
    const response = await this.fetcher(this.endpointUrl(endpoint), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: FUYAO_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "PanLayer", version: "1.0.0" },
        },
      }),
      signal: AbortSignal.timeout(FUYAO_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Fuyao MCP initialize ${response.status}`);
    const sessionId = response.headers.get("mcp-session-id");
    await response.text();
    if (!sessionId) throw new Error("Fuyao MCP session id is missing");
    return sessionId;
  }

  private getSession(endpoint: FuyaoMcpEndpoint): Promise<string> {
    let session = this.sessions.get(endpoint);
    if (!session) {
      session = this.initialize(endpoint).catch((error) => {
        this.sessions.delete(endpoint);
        throw error;
      });
      this.sessions.set(endpoint, session);
    }
    return session;
  }

  async call<T>(
    endpoint: FuyaoMcpEndpoint,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const sessionId = await this.getSession(endpoint);
    const response = await this.fetcher(this.endpointUrl(endpoint), {
      method: "POST",
      headers: this.headers(sessionId),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
      signal: AbortSignal.timeout(FUYAO_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Fuyao MCP ${tool} ${response.status}`);
    const envelope = parseToolPayload(await response.json() as FuyaoMcpResponse<T>);
    if (envelope.code !== 0) {
      throw new Error(`Fuyao ${tool} code ${envelope.code}: ${envelope.message || "request failed"}`);
    }
    return envelope.data;
  }

  async listTickers(assetType: "a-share" | "fund-etf"): Promise<FuyaoTicker[]> {
    let cached = this.tickerCache.get(assetType);
    if (!cached) {
      cached = this.call<FuyaoSnapshotData<FuyaoTicker>>(
        "meta",
        "get_meta_tickers_list",
        { asset_type: assetType, limit: 10_000, offset: 0 },
      ).then((data) => data.item ?? []).catch((error) => {
        this.tickerCache.delete(assetType);
        throw error;
      });
      this.tickerCache.set(assetType, cached);
    }
    return cached;
  }

  async searchTickers(query: string, assetType: "a-share" | "fund-etf", limit = 10): Promise<FuyaoTicker[]> {
    const data = await this.call<FuyaoSnapshotData<FuyaoTicker>>(
      "meta",
      "get_meta_tickers_search",
      { q: query, asset_type: assetType, limit: Math.min(20, Math.max(1, limit)) },
    );
    return data.item ?? [];
  }

  async fetchAShareQuotes(symbols: string[]): Promise<Quote[]> {
    const normalized = [...new Set(symbols.map((symbol) => securityMeta(symbol).symbol))];
    const tickersPromise = this.listTickers("a-share");
    const requested = normalized.length > 0
      ? normalized
      : (await tickersPromise).map((item) => securityMeta(item.thscode).symbol);
    const rows: FuyaoPriceRow[] = [];
    for (let offset = 0; offset < requested.length; offset += FUYAO_QUOTE_BATCH_SIZE) {
      const batch = requested.slice(offset, offset + FUYAO_QUOTE_BATCH_SIZE);
      const data = await this.call<FuyaoSnapshotData<FuyaoPriceRow>>(
        "a-share",
        "get_a_share_prices_snapshot",
        { thscodes: batch.join(",") },
      );
      rows.push(...(data.item ?? []));
    }
    const coverage = rows.length / Math.max(1, requested.length);
    if (coverage < MINIMUM_FUYAO_QUOTE_COVERAGE) {
      throw new Error(`Fuyao A-share coverage ${(coverage * 100).toFixed(2)}%`);
    }
    const names = new Map((await tickersPromise).map((item) => [securityMeta(item.thscode).symbol, item.name]));
    return rows.flatMap((row) => {
      const meta = securityMeta(row.thscode);
      const previousClose = finiteNumber(row.prev_price);
      const price = finiteNumber(row.last_price);
      if (price <= 0 || previousClose <= 0) return [];
      const name = names.get(meta.symbol) ?? row.ticker ?? meta.code;
      const roundPrice = (value: number) => Math.round(value * 100) / 100;
      return [{
        symbol: meta.symbol,
        name,
        exchange: meta.exchange,
        board: meta.board,
        isST: /ST|退/.test(name),
        isNoLimitDay: false,
        previousClose,
        open: finiteNumber(row.open_price, price),
        price,
        high: finiteNumber(row.high_price, price),
        low: finiteNumber(row.low_price, price),
        pctChange: finiteNumber(row.price_change_ratio_pct),
        amount: finiteNumber(row.turnover),
        turnoverRate: 0,
        limitUpPrice: roundPrice(previousClose * (1 + meta.limitRate)),
        limitDownPrice: roundPrice(previousClose * (1 - meta.limitRate)),
        sector: "未分类",
        firstLimitTime: null,
        limitStreak: 0,
      }];
    }).filter((item) => !item.isST);
  }

  async fetchIndexSnapshots(date: string, now = new Date()): Promise<IndexSnapshot[]> {
    const receivedAt = now.toISOString();
    if (date === beijingDate(now)) {
      const data = await this.call<FuyaoSnapshotData<FuyaoIndexRow>>(
        "a-share-index",
        "get_a_share_index_prices_snapshot",
        { thscodes: INDEX_DEFINITIONS.map((item) => item.symbol).join(",") },
      );
      const bySymbol = new Map((data.item ?? []).map((item) => [securityMeta(item.thscode).symbol, item]));
      return INDEX_DEFINITIONS.map((definition) => {
        const row = bySymbol.get(definition.symbol);
        return {
          symbol: definition.symbol,
          name: definition.name,
          price: row ? finiteNumber(row.last_price) : null,
          pctChange: row ? finiteNumber(row.price_change_ratio_pct) : null,
          amount: row ? finiteNumber(row.turnover) : null,
          marketTime: `${date}T15:00:00+08:00`,
          receivedAt,
          source: "扶摇 Fuyao",
          status: row ? "complete" as const : "failed" as const,
          message: row ? "扶摇指数行情快照" : "扶摇指数快照缺失",
        };
      });
    }

    const target = Date.parse(`${date}T00:00:00+08:00`);
    const start = target - 7 * 24 * 60 * 60 * 1_000;
    return Promise.all(INDEX_DEFINITIONS.map(async (definition) => {
      try {
        const data = await this.call<FuyaoHistoricalData>(
          "a-share-index",
          "get_a_share_index_prices_historical",
          { thscode: definition.symbol, interval: "1d", start, end: target },
        );
        const row = (data.item ?? []).find((item) => dateFromMilliseconds(item.date_ms) === date);
        const previous = (data.item ?? [])
          .filter((item) => item.date_ms < (row?.date_ms ?? 0))
          .toSorted((left, right) => left.date_ms - right.date_ms)
          .at(-1);
        const price = row ? finiteNumber(row.close_price) : null;
        const previousClose = previous ? finiteNumber(previous.close_price) : null;
        const pctChange = price && previousClose
          ? Number((((price - previousClose) / previousClose) * 100).toFixed(6))
          : null;
        return {
          symbol: definition.symbol,
          name: definition.name,
          price,
          pctChange,
          amount: row ? finiteNumber(row.turnover) : null,
          marketTime: `${date}T15:00:00+08:00`,
          receivedAt,
          source: "扶摇 Fuyao 历史K线",
          status: row ? "partial" as const : "failed" as const,
          message: row ? "扶摇单源历史指数日线" : "扶摇历史指数日线缺失",
        };
      } catch (error) {
        return {
          symbol: definition.symbol,
          name: definition.name,
          price: null,
          pctChange: null,
          amount: null,
          marketTime: `${date}T15:00:00+08:00`,
          receivedAt,
          source: "扶摇 Fuyao",
          status: "failed" as const,
          message: error instanceof Error ? error.message : "扶摇历史指数请求失败",
        };
      }
    }));
  }

  async fetchFundDailyBars(symbol: string, now = new Date()): Promise<MarketBar[]> {
    const normalized = securityMeta(symbol).symbol;
    const end = now.getTime();
    const start = end - 5 * 365 * 24 * 60 * 60 * 1_000;
    const data = await this.call<FuyaoHistoricalData>(
      "fund",
      "get_fund_market_historical",
      { thscode: normalized, interval: "1d", start, end },
    );
    return (data.item ?? []).flatMap((row) => {
      const close = finiteNumber(row.close_price);
      if (!row.date_ms || close <= 0) return [];
      return [{
        time: dateFromMilliseconds(row.date_ms),
        open: finiteNumber(row.open_price, close),
        high: finiteNumber(row.high_price, close),
        low: finiteNumber(row.low_price, close),
        close,
        volume: finiteNumber(row.volume),
        amount: finiteNumber(row.turnover),
      }];
    }).toSorted((left, right) => left.time.localeCompare(right.time));
  }

  async searchEtfSnapshots(query: string, limit = 10): Promise<EtfSnapshot[]> {
    const tickers = await this.searchTickers(query, "fund-etf", limit);
    const results: EtfSnapshot[] = [];
    for (const ticker of tickers.slice(0, Math.min(10, limit))) {
      try {
        const data = await this.call<FuyaoSnapshotData<FuyaoPriceRow>>(
          "fund",
          "get_fund_market_snapshot",
          { thscode: securityMeta(ticker.thscode).symbol },
        );
        const row = data.item?.[0];
        const price = finiteNumber(row?.last_price);
        if (!row || price <= 0) continue;
        const classified = classifyEtf(ticker.name);
        const exchange = ticker.exchange === "SH" ? "SH" : ticker.exchange === "SZ" ? "SZ" : "OTHER";
        results.push({
          symbol: ticker.ticker,
          name: ticker.name,
          category: classified.category,
          tags: classified.tags,
          exchange,
          price,
          pctChange: finiteNumber(row.price_change_ratio_pct),
          amount: finiteNumber(row.turnover),
          averageAmount20: null,
          scale: null,
          turnoverRate: null,
          status: "active",
          updatedAt: new Date(data.timestamp ?? Date.now()).toISOString(),
        });
      } catch {
        // A search result without a verifiable market snapshot is not exposed
        // as a zero-price ETF.
      }
    }
    return results;
  }
}

export function createFuyaoMcpClient(options: FuyaoMcpOptions): FuyaoMcpClient {
  return new FuyaoMcpClient(options);
}

export function mergeVerifiedIndexSnapshots(
  fuyao: IndexSnapshot[],
  existing: IndexSnapshot[],
): IndexSnapshot[] {
  const fuyaoBySymbol = new Map(fuyao.map((item) => [item.symbol, item]));
  const existingBySymbol = new Map(existing.map((item) => [item.symbol, item]));
  return INDEX_DEFINITIONS.map((definition) => {
    const primary = fuyaoBySymbol.get(definition.symbol);
    const cross = existingBySymbol.get(definition.symbol);
    const primaryValid = Boolean(
      primary
      && primary.price !== null
      && primary.pctChange !== null
      && primary.status !== "failed",
    );
    const crossValid = Boolean(
      cross
      && cross.price !== null
      && cross.pctChange !== null
      && cross.status !== "failed",
    );
    if (primaryValid && crossValid) {
      const priceAgreement = Math.abs(primary.price! - cross.price!) / Math.max(1, cross.price!) <= 0.003;
      const directionAgreement = Math.abs(primary.pctChange! - cross.pctChange!) <= 0.3;
      const complete = priceAgreement && directionAgreement;
      return {
        ...primary,
        amount: primary.amount ?? cross.amount,
        source: `扶摇 Fuyao / ${cross.source}`,
        status: complete ? "complete" : "partial",
        message: complete ? "扶摇与原有指数源交叉一致" : "扶摇与原有指数源存在差异，已保留来源证据",
      };
    }
    if (primaryValid) {
      return { ...primary, status: "partial", message: "扶摇指数可用，原有交叉源暂缺" };
    }
    if (cross) return cross;
    return primary ?? {
      symbol: definition.symbol,
      name: definition.name,
      price: null,
      pctChange: null,
      amount: null,
      marketTime: null,
      receivedAt: new Date().toISOString(),
      source: "扶摇 Fuyao / 原有指数源",
      status: "failed",
      message: "指数数据源均不可用",
    };
  });
}
