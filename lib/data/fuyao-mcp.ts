import type {
  Board,
  Exchange,
  Quote,
  SectorMetric,
  StructuredMarketSignals,
  StructuredSignalEvidence,
} from "../domain/types";
import { classifyEtf } from "../etf/catalog";
import type { MarketBar } from "../etf/bars";
import type {
  AdjustedBar,
  BoardPoolItem,
  EtfSnapshot,
  IndexSnapshot,
  MarketAggregate,
} from "./provider";

export type FuyaoMcpEndpoint = "meta" | "a-share" | "a-share-index" | "fund";

export interface FuyaoMcpOptions {
  apiKey: string;
  baseUrl?: string;
  restBaseUrl?: string;
  fetcher?: typeof fetch;
  transport?: "rest-first" | "mcp-only";
}

interface FuyaoToolEnvelope<T> {
  code: number;
  message: string;
  request_id?: string;
  data: T;
}

export interface FuyaoMorningBriefEvidence {
  schemaVersion: 1;
  provider: "扶摇 Fuyao";
  status: "complete" | "partial" | "failed";
  referenceDate: string;
  marketTime: string;
  receivedAt: string;
  datasetTotal: number;
  datasetSuccess: number;
  requestIds: string[];
  indices: IndexSnapshot[];
  limitUpPool: null | {
    total: number;
    leaders: Array<{
      symbol: string;
      name: string;
      streak: number;
      firstLimitTime: string | null;
      reason: string | null;
      sealMoney: number | null;
    }>;
  };
  ladder: null | {
    highest: number;
    counts: Record<"two" | "three" | "four" | "five" | "six" | "sevenPlus", number>;
    leaders: Array<{ symbol: string; name: string; height: number }>;
  };
  hotStocks: Array<{
    symbol: string;
    name: string;
    rank: number;
    rankChange: number;
    heat: number | null;
  }>;
  dragonTiger: Array<{
    symbol: string;
    name: string;
    netValue: number | null;
    organizationNetValue: number | null;
    hotMoneyNetValue: number | null;
    concepts: string[];
  }>;
  errors: string[];
}

export interface FuyaoLimitUpSnapshot {
  items: BoardPoolItem[];
  total: number;
  requestIds: string[];
  evidence: StructuredSignalEvidence;
}

export interface FuyaoEtfCatalogMerge {
  items: EtfSnapshot[];
  masterCount: number;
  matchedCount: number;
  supplementalCount: number;
  coveragePct: number;
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

interface FuyaoLimitUpRow {
  thscode: string;
  name: string;
  continue_day_cnt?: number;
  seal_money?: number;
  max_seal_money?: number;
  last_price?: number;
  price_change_ratio_pct?: number;
  limit_up_time?: string;
  limit_up_reason?: string;
  is_st?: boolean;
}

interface FuyaoLimitUpPoolData {
  timestamp?: number;
  pagination?: { total?: number; pages?: number };
  item?: FuyaoLimitUpRow[];
}

interface FuyaoLadderStock {
  thscode: string;
  name: string;
  board_num?: number;
}

interface FuyaoLadderData {
  timestamp?: number;
  item?: Array<{
    date: string;
    boards?: Record<string, FuyaoLadderStock[]>;
  }>;
}

interface FuyaoHotStockRow {
  thscode: string;
  name: string;
  rank?: number;
  rank_change?: number;
  heat?: string | number;
  analyse?: string;
  analyse_title?: string;
}

interface FuyaoHotStockData {
  timestamp?: number;
  item?: FuyaoHotStockRow[];
}

interface FuyaoDragonTigerRow {
  thscode: string;
  name: string;
  net_value?: number;
  org_net_value?: number;
  hot_money_net_value?: number;
  concept_list?: Array<{ name?: string }>;
}

interface FuyaoDragonTigerData {
  timestamp?: number;
  trade_date?: string;
  stock_items?: FuyaoDragonTigerRow[];
}

interface FuyaoAnomalyRow {
  thscode: string;
  stock_name?: string;
  tag_name?: string;
  analysis_content?: string;
  keyword_list?: string[];
}

interface FuyaoAnomalyData {
  timestamp?: number;
  item?: FuyaoAnomalyRow[];
}

interface FuyaoIndexCatalogRow {
  thscode: string;
  name: string;
}

interface FuyaoIndexCatalogData {
  timestamp?: number;
  item?: FuyaoIndexCatalogRow[];
}

interface FuyaoIndexConstituentRow {
  thscode: string;
  ticker?: string;
  name?: string;
}

interface FuyaoIndexConstituentData {
  timestamp?: number;
  item?: FuyaoIndexConstituentRow[];
}

const DEFAULT_FUYAO_MCP_BASE_URL = "https://fuyao.aicubes.cn/mcp";
const DEFAULT_FUYAO_REST_BASE_URL = "https://fuyao.aicubes.cn";
const FUYAO_PROTOCOL_VERSION = "2025-03-26";
const FUYAO_REQUEST_TIMEOUT_MS = 12_000;
const FUYAO_HISTORICAL_TIMEOUT_MS = 30_000;
const FUYAO_QUOTE_BATCH_SIZE = 100;
const MINIMUM_FUYAO_QUOTE_COVERAGE = 0.95;

const FUYAO_REST_PATHS: Readonly<Record<string, string>> = {
  get_meta_tickers_list: "/api/meta/tickers/list",
  get_meta_tickers_search: "/api/meta/tickers/search",
  get_a_share_prices_snapshot: "/api/a-share/prices/snapshot",
  get_a_share_prices_historical: "/api/a-share/prices/historical",
  get_a_share_special_data_limit_up_pool: "/api/a-share/special-data/limit-up-pool",
  get_a_share_special_data_limit_up_ladder: "/api/a-share/special-data/limit-up-ladder",
  get_a_share_special_data_skyrocket_list: "/api/a-share/special-data/skyrocket-list",
  get_a_share_special_data_hot_stock_list: "/api/a-share/special-data/hot-stock-list",
  get_a_share_special_data_dragon_tiger_list: "/api/a-share/special-data/dragon-tiger-list",
  get_a_share_special_data_anomaly_analysis_stock: "/api/a-share/special-data/anomaly-analysis-stock",
  get_a_share_special_data_anomal_17ac564c9ba3: "/api/a-share/special-data/anomaly-analysis-stock",
  get_a_share_index_catalog_ths_index_list: "/api/a-share-index/catalog/ths-index-list",
  get_a_share_index_catalog_e220748f341b: "/api/a-share-index/catalog/ths-index-list",
  get_a_share_index_constituents_ths_stock_list: "/api/a-share-index/constituents/ths-stock-list",
  get_a_share_index_constit_d27621e4aae9: "/api/a-share-index/constituents/ths-stock-list",
  get_a_share_index_prices_snapshot: "/api/a-share-index/prices/snapshot",
  get_a_share_index_prices_historical: "/api/a-share-index/prices/historical",
  get_fund_market_snapshot: "/api/fund/market/snapshot",
  get_fund_market_historical: "/api/fund/market/historical",
};

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

function etfSecurityMeta(value: string): {
  symbol: string;
  code: string;
  exchange: "SH" | "SZ" | "OTHER";
} {
  const [code, suffix] = value.toUpperCase().split(".");
  const exchange = suffix === "SH" || (!suffix && code.startsWith("5"))
    ? "SH"
    : suffix === "SZ" || (!suffix && code.startsWith("1")) ? "SZ" : "OTHER";
  return {
    symbol: exchange === "OTHER" ? code : `${code}.${exchange}`,
    code,
    exchange,
  };
}

function quoteFromPriceRow(row: FuyaoPriceRow, name: string): Quote | null {
  const meta = securityMeta(row.thscode);
  const previousClose = finiteNumber(row.prev_price);
  const price = finiteNumber(row.last_price);
  if (price <= 0 || previousClose <= 0) return null;
  const roundPrice = (value: number) => Math.round(value * 100) / 100;
  return {
    symbol: meta.symbol,
    name,
    exchange: meta.exchange,
    board: meta.board,
    isST: /(?:\*?ST|退)/i.test(name),
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
  };
}

function signalEvidence(input: {
  requestId?: string;
  marketTime: string | null;
  receivedAt: string;
  rawCount: number;
  validCount: number;
  coveragePct?: number | null;
  status: StructuredSignalEvidence["status"];
  message?: string;
}): StructuredSignalEvidence {
  return {
    source: "扶摇 Fuyao",
    requestId: input.requestId ?? null,
    marketTime: input.marketTime,
    receivedAt: input.receivedAt,
    rawCount: input.rawCount,
    validCount: input.validCount,
    coveragePct: input.coveragePct ?? null,
    status: input.status,
    message: input.message ?? "",
  };
}

function normalizedSectorName(value: string): string {
  return value
    .replaceAll("概念", "")
    .replaceAll("行业", "")
    .replaceAll("板块", "")
    .replaceAll(" ", "")
    .toLocaleLowerCase("zh-CN");
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

class FuyaoRestTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FuyaoRestTransportError";
  }
}

class FuyaoBusinessError extends Error {
  readonly code: number;

  constructor(tool: string, code: number, message: string) {
    super(`Fuyao ${tool} code ${code}: ${message || "request failed"}`);
    this.name = "FuyaoBusinessError";
    this.code = code;
  }
}

function deriveFuyaoRestBaseUrl(mcpBaseUrl: string): string {
  try {
    const url = new URL(mcpBaseUrl);
    url.pathname = url.pathname.replace(/\/mcp\/?$/, "") || "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_FUYAO_REST_BASE_URL;
  }
}

function appendRestQuery(url: URL, args: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      url.searchParams.set(key, value.join(","));
      continue;
    }
    if (typeof value === "object") {
      url.searchParams.set(key, JSON.stringify(value));
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

export class FuyaoMcpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly restBaseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly transport: "rest-first" | "mcp-only";
  private readonly sessions = new Map<FuyaoMcpEndpoint, Promise<string>>();
  private tickerCache = new Map<string, Promise<FuyaoTicker[]>>();

  constructor(options: FuyaoMcpOptions) {
    if (!options.apiKey.trim()) throw new Error("FUYAO_API_KEY is not configured");
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_FUYAO_MCP_BASE_URL).replace(/\/+$/, "");
    this.restBaseUrl = (options.restBaseUrl ?? deriveFuyaoRestBaseUrl(this.baseUrl)).replace(/\/+$/, "");
    this.fetcher = options.fetcher ?? fetch;
    this.transport = options.transport ?? "rest-first";
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

  private async callMcpEnvelope<T>(
    endpoint: FuyaoMcpEndpoint,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<FuyaoToolEnvelope<T>> {
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
      throw new FuyaoBusinessError(tool, envelope.code, envelope.message);
    }
    return envelope;
  }

  private async callRestEnvelope<T>(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<FuyaoToolEnvelope<T>> {
    const path = FUYAO_REST_PATHS[tool];
    if (!path) throw new FuyaoRestTransportError(`Fuyao REST mapping missing for ${tool}`);
    const url = new URL(path, `${this.restBaseUrl}/`);
    appendRestQuery(url, args);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "GET",
        headers: {
          "X-api-key": this.apiKey,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(
          path.endsWith("/historical") ? FUYAO_HISTORICAL_TIMEOUT_MS : FUYAO_REQUEST_TIMEOUT_MS,
        ),
      });
    } catch (error) {
      throw new FuyaoRestTransportError(
        `Fuyao REST ${tool} transport failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new FuyaoRestTransportError(`Fuyao REST ${tool} HTTP ${response.status}`);
    }
    let envelope: FuyaoToolEnvelope<T>;
    try {
      envelope = await response.json() as FuyaoToolEnvelope<T>;
    } catch {
      throw new FuyaoRestTransportError(`Fuyao REST ${tool} returned invalid JSON`);
    }
    if (!Number.isFinite(envelope.code)) {
      throw new FuyaoRestTransportError(`Fuyao REST ${tool} returned an invalid envelope`);
    }
    if (envelope.code !== 0) {
      throw new FuyaoBusinessError(tool, envelope.code, envelope.message);
    }
    return envelope;
  }

  private async callEnvelope<T>(
    endpoint: FuyaoMcpEndpoint,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<FuyaoToolEnvelope<T>> {
    if (this.transport === "mcp-only") {
      return this.callMcpEnvelope<T>(endpoint, tool, args);
    }
    try {
      return await this.callRestEnvelope<T>(tool, args);
    } catch (error) {
      if (error instanceof FuyaoBusinessError) throw error;
      try {
        return await this.callMcpEnvelope<T>(endpoint, tool, args);
      } catch (fallbackError) {
        const restMessage = error instanceof Error ? error.message : String(error);
        const mcpMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(`${restMessage}; MCP fallback failed: ${mcpMessage}`);
      }
    }
  }

  async call<T>(
    endpoint: FuyaoMcpEndpoint,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    return (await this.callEnvelope<T>(endpoint, tool, args)).data;
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

  async fetchAShareQuotes(
    symbols: string[],
    options: { includeST?: boolean } = {},
  ): Promise<Quote[]> {
    const normalized = [...new Set(symbols.map((symbol) => securityMeta(symbol).symbol))];
    const tickersPromise = this.listTickers("a-share");
    const requested = normalized.length > 0
      ? normalized
      : (await tickersPromise).map((item) => securityMeta(item.thscode).symbol);
    const rows: FuyaoPriceRow[] = [];
    const batches = Array.from(
      { length: Math.ceil(requested.length / FUYAO_QUOTE_BATCH_SIZE) },
      (_, index) => requested.slice(index * FUYAO_QUOTE_BATCH_SIZE, (index + 1) * FUYAO_QUOTE_BATCH_SIZE),
    );
    let cursor = 0;
    const worker = async () => {
      while (cursor < batches.length) {
        const batch = batches[cursor++];
        const data = await this.call<FuyaoSnapshotData<FuyaoPriceRow>>(
          "a-share",
          "get_a_share_prices_snapshot",
          { thscodes: batch.join(",") },
        );
        rows.push(...(data.item ?? []));
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, batches.length) }, worker));
    const coverage = rows.length / Math.max(1, requested.length);
    if (coverage < MINIMUM_FUYAO_QUOTE_COVERAGE) {
      throw new Error(`Fuyao A-share coverage ${(coverage * 100).toFixed(2)}%`);
    }
    const names = new Map((await tickersPromise).map((item) => [securityMeta(item.thscode).symbol, item.name]));
    return rows.flatMap((row) => {
      const meta = securityMeta(row.thscode);
      const name = names.get(meta.symbol) ?? row.ticker ?? meta.code;
      const quote = quoteFromPriceRow(row, name);
      return quote ? [quote] : [];
    }).filter((item) => options.includeST || !item.isST);
  }

  async fetchMarketAggregate(
    symbols: string[],
    at: string,
    now = new Date(),
  ): Promise<MarketAggregate> {
    const quotes = await this.fetchAShareQuotes(symbols, { includeST: true });
    const expected = symbols.length > 0 ? symbols.length : (await this.listTickers("a-share")).length;
    const valid = quotes.filter((item) => Number.isFinite(item.amount) && item.amount >= 0);
    const coveragePct = Number((valid.length / Math.max(1, expected) * 100).toFixed(2));
    const complete = coveragePct >= 95;
    return {
      amount: complete
        ? Number((valid.reduce((sum, item) => sum + item.amount, 0) / 100_000_000).toFixed(2))
        : null,
      rawCount: quotes.length,
      validCount: valid.length,
      coveragePct,
      marketTime: `${beijingDate(now)}T${at}:00+08:00`,
      receivedAt: now.toISOString(),
      source: "扶摇 Fuyao",
      status: complete ? "complete" : valid.length > 0 ? "partial" : "failed",
      message: complete
        ? "扶摇沪深京全 A（含 ST）成交额覆盖完整"
        : `扶摇全 A 成交额覆盖率 ${coveragePct}%`,
    };
  }

  async fetchAShareAdjustedBars(
    symbol: string,
    now = new Date(),
    options: { lookbackDays?: number } = {},
  ): Promise<AdjustedBar[]> {
    const end = now.getTime();
    const lookbackDays = Math.max(45, options.lookbackDays ?? 10 * 365);
    const start = end - lookbackDays * 24 * 60 * 60 * 1_000;
    const data = await this.call<FuyaoHistoricalData>(
      "a-share",
      "get_a_share_prices_historical",
      {
        thscode: securityMeta(symbol).symbol,
        interval: "1d",
        adjust: "forward",
        start,
        end,
        offset: 0,
      },
    );
    const bars = (data.item ?? []).flatMap((row) => {
      const close = finiteNumber(row.close_price);
      if (!row.date_ms || close <= 0) return [];
      return [{
        date: dateFromMilliseconds(row.date_ms),
        close,
        volume: row.volume === undefined ? undefined : finiteNumber(row.volume),
        amount: row.turnover === undefined ? undefined : finiteNumber(row.turnover),
      }];
    }).toSorted((left, right) => left.date.localeCompare(right.date));
    return bars.map((bar, index) => ({
      ...bar,
      pctChange: index > 0 && bars[index - 1].close > 0
        ? Number(((bar.close / bars[index - 1].close - 1) * 100).toFixed(6))
        : undefined,
    }));
  }

  async fetchLimitUpPoolSnapshot(date: string, now = new Date()): Promise<FuyaoLimitUpSnapshot> {
    const dateMs = Date.parse(`${date}T00:00:00+08:00`);
    const first = await this.callEnvelope<FuyaoLimitUpPoolData>(
      "a-share",
      "get_a_share_special_data_limit_up_pool",
      {
        date_ms: dateMs,
        page: 1,
        size: 200,
        sort_field: "continue_day_cnt",
        sort_dir: "desc",
      },
    );
    const pages = Math.max(1, finiteNumber(first.data.pagination?.pages, 1));
    const rest = pages > 1
      ? await Promise.all(Array.from({ length: pages - 1 }, (_, index) =>
          this.callEnvelope<FuyaoLimitUpPoolData>(
            "a-share",
            "get_a_share_special_data_limit_up_pool",
            {
              date_ms: dateMs,
              page: index + 2,
              size: 200,
              sort_field: "continue_day_cnt",
              sort_dir: "desc",
            },
          ),
        ))
      : [];
    const envelopes = [first, ...rest];
    const raw = envelopes.flatMap((item) => item.data.item ?? []);
    const valid = [...new Map(raw
      .filter((item) => item.thscode && item.name && !item.is_st && !/(?:\*?ST|退)/i.test(item.name))
      .map((item) => [securityMeta(item.thscode).code, item]))
      .values()];
    const receivedAt = now.toISOString();
    const marketTime = `${date}T15:00:00+08:00`;
    const items = valid.map((item): BoardPoolItem => ({
      code: securityMeta(item.thscode).code,
      name: item.name,
      pctChange: item.price_change_ratio_pct === undefined ? null : finiteNumber(item.price_change_ratio_pct),
      amount: null,
      industry: item.limit_up_reason?.trim() || "未分类",
      limitStreak: Math.max(1, finiteNumber(item.continue_day_cnt, 1)),
      previousLimitStreak: Math.max(0, finiteNumber(item.continue_day_cnt, 1) - 1),
      firstLimitTime: item.limit_up_time?.trim() || null,
    }));
    const total = finiteNumber(first.data.pagination?.total, valid.length);
    const status = total > 0 && valid.length === total ? "complete" : valid.length > 0 ? "partial" : "failed";
    return {
      items,
      total,
      requestIds: envelopes.flatMap((item) => item.request_id ? [item.request_id] : []),
      evidence: signalEvidence({
        requestId: first.request_id,
        marketTime,
        receivedAt,
        rawCount: raw.length,
        validCount: valid.length,
        coveragePct: total > 0 ? Number((valid.length / total * 100).toFixed(2)) : null,
        status,
        message: status === "complete" ? "扶摇涨停池完整" : `扶摇涨停池 ${valid.length}/${total}`,
      }),
    };
  }

  private async fetchFuyaoSectorMetrics(
    limitUpItems: BoardPoolItem[],
    date: string,
    now: Date,
  ): Promise<{
    sectors: SectorMetric[];
    evidence: StructuredSignalEvidence;
    requestIds: string[];
  }> {
    const [industry, concept] = await Promise.all([
      this.callEnvelope<FuyaoIndexCatalogData>(
        "a-share-index",
        "get_a_share_index_catalog_e220748f341b",
        { tag: "industry" },
      ),
      this.callEnvelope<FuyaoIndexCatalogData>(
        "a-share-index",
        "get_a_share_index_catalog_e220748f341b",
        { tag: "cn_concept" },
      ),
    ]);
    const catalog = [...(industry.data.item ?? []), ...(concept.data.item ?? [])];
    const reasonGroups = new Map<string, BoardPoolItem[]>();
    for (const item of limitUpItems) {
      const reasons = item.industry
        .split(/[+,，、/；;｜|]/)
        .map((value) => value.trim())
        .filter((value) => value && value !== "未分类");
      for (const reason of reasons.length > 0 ? reasons : [item.industry]) {
        reasonGroups.set(reason, [...(reasonGroups.get(reason) ?? []), item]);
      }
    }
    const matches = [...reasonGroups]
      .toSorted((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0], "zh-CN"))
      .flatMap(([reason, stocks]) => {
        const normalized = normalizedSectorName(reason);
        const match = catalog.find((item) => {
          const candidate = normalizedSectorName(item.name);
          return candidate === normalized || candidate.includes(normalized) || normalized.includes(candidate);
        });
        return match ? [{ reason, stocks, index: match }] : [];
      })
      .filter((item, index, rows) => rows.findIndex((other) => other.index.thscode === item.index.thscode) === index)
      .slice(0, 12);
    if (matches.length === 0) {
      return {
        sectors: [],
        requestIds: [industry.request_id, concept.request_id].filter((item): item is string => Boolean(item)),
        evidence: signalEvidence({
          requestId: industry.request_id,
          marketTime: `${date}T15:00:00+08:00`,
          receivedAt: now.toISOString(),
          rawCount: catalog.length,
          validCount: 0,
          status: "partial",
          message: "扶摇板块目录可用，但涨停原因未匹配到标准行业或概念指数",
        }),
      };
    }
    const snapshot = await this.callEnvelope<FuyaoSnapshotData<FuyaoIndexRow>>(
      "a-share-index",
      "get_a_share_index_prices_snapshot",
      { thscodes: matches.map((item) => item.index.thscode).join(",") },
    );
    const snapshotBySymbol = new Map((snapshot.data.item ?? []).map((item) => [item.thscode, item]));
    const constituentResults = await Promise.allSettled(matches.map((item) =>
      this.callEnvelope<FuyaoIndexConstituentData>(
        "a-share-index",
        "get_a_share_index_constit_d27621e4aae9",
        { thscode: item.index.thscode },
      ),
    ));
    const sectors = matches.flatMap((item, index): SectorMetric[] => {
      const row = snapshotBySymbol.get(item.index.thscode);
      if (!row) return [];
      const constituents = constituentResults[index].status === "fulfilled"
        ? new Set((constituentResults[index] as PromiseFulfilledResult<FuyaoToolEnvelope<FuyaoIndexConstituentData>>).value.data.item?.map((stock) => securityMeta(stock.thscode).code))
        : new Set<string>();
      const verifiedStocks = constituents.size > 0
        ? item.stocks.filter((stock) => constituents.has(stock.code))
        : item.stocks;
      return [{
        name: item.index.name || item.reason,
        limitUpCount: verifiedStocks.length,
        averagePct: finiteNumber(row.price_change_ratio_pct),
        amountGrowthPct: null,
        maxStreak: Math.max(0, ...verifiedStocks.map((stock) => stock.limitStreak)),
      }];
    }).toSorted((left, right) =>
      right.limitUpCount - left.limitUpCount
      || right.averagePct - left.averagePct
      || right.maxStreak - left.maxStreak
      || left.name.localeCompare(right.name, "zh-CN"));
    const requestIds = [
      industry.request_id,
      concept.request_id,
      snapshot.request_id,
      ...constituentResults.flatMap((result) =>
        result.status === "fulfilled" && result.value.request_id ? [result.value.request_id] : []),
    ].filter((item): item is string => Boolean(item));
    return {
      sectors,
      requestIds,
      evidence: signalEvidence({
        requestId: snapshot.request_id,
        marketTime: `${date}T15:00:00+08:00`,
        receivedAt: now.toISOString(),
        rawCount: matches.length,
        validCount: sectors.length,
        coveragePct: Number((sectors.length / Math.max(1, matches.length) * 100).toFixed(2)),
        status: sectors.length === matches.length ? "complete" : sectors.length > 0 ? "partial" : "failed",
        message: `扶摇板块指数 ${sectors.length}/${matches.length}，成分股用于核验涨停归属`,
      }),
    };
  }

  async fetchStructuredMarketSignals(
    date: string,
    now = new Date(),
    limitUpSnapshot?: FuyaoLimitUpSnapshot,
    options: { disabledDatasets?: ReadonlySet<"anomalies" | "sectors"> } = {},
  ): Promise<StructuredMarketSignals> {
    const receivedAt = now.toISOString();
    const marketTime = `${date}T15:00:00+08:00`;
    const evidence: Record<string, StructuredSignalEvidence> = {};
    const errors: string[] = [];
    const requestIds: string[] = [];
    let datasetSuccess = 0;
    const datasetTotal = 7;
    const [poolResult, ladderResult, hotResult, skyrocketResult, dragonResult] = await Promise.allSettled([
      limitUpSnapshot
        ? Promise.resolve(limitUpSnapshot)
        : this.fetchLimitUpPoolSnapshot(date, now),
      this.callEnvelope<FuyaoLadderData>("a-share", "get_a_share_special_data_limit_up_ladder", {}),
      this.callEnvelope<FuyaoHotStockData>("a-share", "get_a_share_special_data_hot_stock_list", { period: "day" }),
      this.callEnvelope<FuyaoHotStockData>("a-share", "get_a_share_special_data_skyrocket_list", { period: "day" }),
      this.callEnvelope<FuyaoDragonTigerData>("a-share", "get_a_share_special_data_dragon_tiger_list", {
        board_type: "all",
        date,
      }),
    ]);

    const pool = poolResult.status === "fulfilled" ? poolResult.value : null;
    if (pool) {
      datasetSuccess += 1;
      evidence.limitUpPool = pool.evidence;
      requestIds.push(...pool.requestIds);
    } else {
      const message = poolResult.status === "rejected" && poolResult.reason instanceof Error ? poolResult.reason.message : "扶摇涨停池失败";
      errors.push(`涨停池：${message}`);
      evidence.limitUpPool = signalEvidence({ marketTime, receivedAt, rawCount: 0, validCount: 0, status: "failed", message });
    }

    const ladderTarget = ladderResult.status === "fulfilled"
      ? ladderResult.value.data.item?.find((item) => item.date === date)
      : null;
    if (ladderTarget) {
      datasetSuccess += 1;
      if (ladderResult.status === "fulfilled" && ladderResult.value.request_id) requestIds.push(ladderResult.value.request_id);
      const count = Object.values(ladderTarget.boards ?? {}).reduce((sum, items) => sum + items.length, 0);
      evidence.ladder = signalEvidence({
        requestId: ladderResult.status === "fulfilled" ? ladderResult.value.request_id : undefined,
        marketTime,
        receivedAt,
        rawCount: count,
        validCount: count,
        status: "complete",
        message: "扶摇近30交易日连板矩阵已匹配当前交易日",
      });
    } else {
      const message = ladderResult.status === "rejected" && ladderResult.reason instanceof Error
        ? ladderResult.reason.message : `${date} 无扶摇连板矩阵`;
      errors.push(`连板梯队：${message}`);
      evidence.ladder = signalEvidence({ marketTime, receivedAt, rawCount: 0, validCount: 0, status: "failed", message });
    }

    const mapHot = (rows: FuyaoHotStockRow[]) => rows
      .filter((item) => item.thscode && item.name && !/(?:\*?ST|退|转债)/i.test(item.name))
      .slice(0, 30)
      .map((item) => ({
        symbol: securityMeta(item.thscode).symbol,
        name: item.name,
        rank: Math.max(1, finiteNumber(item.rank, 1)),
        rankChange: finiteNumber(item.rank_change),
        heat: item.heat === undefined ? null : finiteNumber(item.heat),
      }));
    const hotStocks = hotResult.status === "fulfilled" ? mapHot(hotResult.value.data.item ?? []) : [];
    if (hotResult.status === "fulfilled") {
      datasetSuccess += 1;
      if (hotResult.value.request_id) requestIds.push(hotResult.value.request_id);
    } else errors.push(`热股榜：${hotResult.reason instanceof Error ? hotResult.reason.message : String(hotResult.reason)}`);
    evidence.hotStocks = signalEvidence({
      requestId: hotResult.status === "fulfilled" ? hotResult.value.request_id : undefined,
      marketTime,
      receivedAt,
      rawCount: hotResult.status === "fulfilled" ? hotResult.value.data.item?.length ?? 0 : 0,
      validCount: hotStocks.length,
      status: hotResult.status === "fulfilled" ? "complete" : "failed",
      message: hotResult.status === "fulfilled" ? "扶摇24小时热股榜" : "扶摇热股榜失败",
    });

    const skyrocket = skyrocketResult.status === "fulfilled"
      ? (skyrocketResult.value.data.item ?? [])
          .filter((item) => item.thscode && item.name && !/(?:\*?ST|退|转债)/i.test(item.name))
          .slice(0, 30)
          .map((item) => ({
            symbol: securityMeta(item.thscode).symbol,
            name: item.name,
            rank: Math.max(1, finiteNumber(item.rank, 1)),
            rankChange: finiteNumber(item.rank_change),
            heat: item.heat === undefined ? null : finiteNumber(item.heat),
            analysis: item.analyse?.trim() || item.analyse_title?.trim() || null,
          }))
      : [];
    if (skyrocketResult.status === "fulfilled") {
      datasetSuccess += 1;
      if (skyrocketResult.value.request_id) requestIds.push(skyrocketResult.value.request_id);
    } else errors.push(`飙升榜：${skyrocketResult.reason instanceof Error ? skyrocketResult.reason.message : String(skyrocketResult.reason)}`);
    evidence.skyrocket = signalEvidence({
      requestId: skyrocketResult.status === "fulfilled" ? skyrocketResult.value.request_id : undefined,
      marketTime,
      receivedAt,
      rawCount: skyrocketResult.status === "fulfilled" ? skyrocketResult.value.data.item?.length ?? 0 : 0,
      validCount: skyrocket.length,
      status: skyrocketResult.status === "fulfilled" ? "complete" : "failed",
      message: skyrocketResult.status === "fulfilled" ? "扶摇日内飙升榜" : "扶摇飙升榜失败",
    });

    const dragonTiger = dragonResult.status === "fulfilled"
      ? (dragonResult.value.data.stock_items ?? [])
          .filter((item) => item.thscode && item.name && !/(?:\*?ST|退|转债)/i.test(item.name))
          .map((item) => ({
            symbol: securityMeta(item.thscode).symbol,
            name: item.name,
            netValue: item.net_value === undefined ? null : finiteNumber(item.net_value),
            organizationNetValue: item.org_net_value === undefined ? null : finiteNumber(item.org_net_value),
            hotMoneyNetValue: item.hot_money_net_value === undefined ? null : finiteNumber(item.hot_money_net_value),
            concepts: (item.concept_list ?? []).flatMap((concept) => concept.name ? [concept.name] : []).slice(0, 6),
          }))
          .toSorted((left, right) => Math.abs(right.netValue ?? 0) - Math.abs(left.netValue ?? 0))
          .slice(0, 30)
      : [];
    if (dragonResult.status === "fulfilled") {
      datasetSuccess += 1;
      if (dragonResult.value.request_id) requestIds.push(dragonResult.value.request_id);
    } else errors.push(`龙虎榜：${dragonResult.reason instanceof Error ? dragonResult.reason.message : String(dragonResult.reason)}`);
    evidence.dragonTiger = signalEvidence({
      requestId: dragonResult.status === "fulfilled" ? dragonResult.value.request_id : undefined,
      marketTime,
      receivedAt,
      rawCount: dragonResult.status === "fulfilled" ? dragonResult.value.data.stock_items?.length ?? 0 : 0,
      validCount: dragonTiger.length,
      status: dragonResult.status === "fulfilled" ? "complete" : "failed",
      message: dragonResult.status === "fulfilled" ? "扶摇龙虎榜" : "扶摇龙虎榜失败",
    });

    const anomalySymbols = [...new Set([
      ...hotStocks.slice(0, 15).map((item) => item.symbol),
      ...skyrocket.slice(0, 15).map((item) => item.symbol),
      ...dragonTiger.slice(0, 15).map((item) => item.symbol),
      ...(pool?.items.slice(0, 15).map((item) => {
        const exchange = item.code.startsWith("6") ? "SH" : /^(8|9|4)/.test(item.code) ? "BJ" : "SZ";
        return `${item.code}.${exchange}`;
      }) ?? []),
    ])].slice(0, 50);
    let anomalies: StructuredMarketSignals["anomalies"] = [];
    if (options.disabledDatasets?.has("anomalies")) {
      const message = "扶摇异动原因接口无权限/不可用，已启动24小时熔断";
      errors.push(`异动原因：${message}`);
      evidence.anomalies = signalEvidence({
        marketTime,
        receivedAt,
        rawCount: anomalySymbols.length,
        validCount: 0,
        status: "failed",
        message,
      });
    } else if (anomalySymbols.length > 0) {
      try {
        const anomaly = await this.callEnvelope<FuyaoAnomalyData>(
          "a-share",
          "get_a_share_special_data_anomal_17ac564c9ba3",
          { thscodes: anomalySymbols.join(",") },
        );
        anomalies = (anomaly.data.item ?? []).map((item) => ({
          symbol: securityMeta(item.thscode).symbol,
          name: item.stock_name?.trim() || securityMeta(item.thscode).code,
          title: item.tag_name?.trim() || null,
          analysis: item.analysis_content?.trim() || null,
          keywords: (item.keyword_list ?? []).filter(Boolean).slice(0, 8),
        }));
        datasetSuccess += 1;
        if (anomaly.request_id) requestIds.push(anomaly.request_id);
        evidence.anomalies = signalEvidence({
          requestId: anomaly.request_id,
          marketTime,
          receivedAt,
          rawCount: anomalySymbols.length,
          validCount: anomalies.length,
          coveragePct: Number((anomalies.length / Math.max(1, anomalySymbols.length) * 100).toFixed(2)),
          status: anomalies.length > 0 ? "complete" : "partial",
          message: "扶摇异动原因仅作为客观标签",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`异动原因：${message}`);
        evidence.anomalies = signalEvidence({ marketTime, receivedAt, rawCount: anomalySymbols.length, validCount: 0, status: "failed", message });
      }
    } else {
      evidence.anomalies = signalEvidence({ marketTime, receivedAt, rawCount: 0, validCount: 0, status: "partial", message: "无可查询异动标的" });
    }

    let sectors: SectorMetric[] = [];
    if (options.disabledDatasets?.has("sectors")) {
      const message = "扶摇指数目录接口无权限/不可用，已启动24小时熔断";
      errors.push(`板块：${message}`);
      evidence.sectors = signalEvidence({
        marketTime,
        receivedAt,
        rawCount: 0,
        validCount: 0,
        status: "failed",
        message,
      });
    } else try {
      const sectorResult = await this.fetchFuyaoSectorMetrics(pool?.items ?? [], date, now);
      sectors = sectorResult.sectors;
      evidence.sectors = sectorResult.evidence;
      requestIds.push(...sectorResult.requestIds);
      if (sectors.length > 0) datasetSuccess += 1;
      else errors.push("板块：未形成可验证板块快照");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`板块：${message}`);
      evidence.sectors = signalEvidence({ marketTime, receivedAt, rawCount: 0, validCount: 0, status: "failed", message });
    }

    const status = datasetSuccess === datasetTotal
      ? "complete"
      : datasetSuccess === 0 ? "failed" : "partial";
    return {
      schemaVersion: 1,
      provider: "扶摇 Fuyao",
      referenceDate: date,
      marketTime,
      receivedAt,
      status,
      datasetTotal,
      datasetSuccess,
      requestIds: [...new Set(requestIds)],
      hotStocks,
      skyrocket,
      dragonTiger,
      anomalies,
      sectors,
      evidence,
      errors,
    };
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

  async fetchMorningBriefEvidence(referenceDate: string, now = new Date()): Promise<FuyaoMorningBriefEvidence> {
    const receivedAt = now.toISOString();
    const marketTime = `${referenceDate}T15:00:00+08:00`;
    const requestIds: string[] = [];
    const errors: string[] = [];
    let datasetSuccess = 0;
    const datasetTotal = 5;
    const dateMs = Date.parse(`${referenceDate}T00:00:00+08:00`);

    const [indicesResult, poolResult, ladderResult, hotResult, dragonResult] = await Promise.allSettled([
      this.fetchIndexSnapshots(referenceDate, now),
      this.callEnvelope<FuyaoLimitUpPoolData>("a-share", "get_a_share_special_data_limit_up_pool", {
        date_ms: dateMs,
        page: 1,
        size: 200,
        sort_field: "continue_day_cnt",
        sort_dir: "desc",
      }),
      this.callEnvelope<FuyaoLadderData>("a-share", "get_a_share_special_data_limit_up_ladder", {}),
      this.callEnvelope<FuyaoHotStockData>("a-share", "get_a_share_special_data_hot_stock_list", { period: "day" }),
      this.callEnvelope<FuyaoDragonTigerData>("a-share", "get_a_share_special_data_dragon_tiger_list", {
        board_type: "all",
        date: referenceDate,
      }),
    ]);

    const indices = indicesResult.status === "fulfilled"
      ? indicesResult.value.filter((item) => item.price !== null && item.status !== "failed")
      : [];
    if (indices.length === INDEX_DEFINITIONS.length) datasetSuccess += 1;
    else errors.push(indicesResult.status === "rejected"
      ? `指数：${indicesResult.reason instanceof Error ? indicesResult.reason.message : String(indicesResult.reason)}`
      : `指数：${indices.length}/${INDEX_DEFINITIONS.length}`);

    let limitUpPool: FuyaoMorningBriefEvidence["limitUpPool"] = null;
    if (poolResult.status === "fulfilled") {
      datasetSuccess += 1;
      if (poolResult.value.request_id) requestIds.push(poolResult.value.request_id);
      const rows = (poolResult.value.data.item ?? []).filter((item) => !item.is_st);
      limitUpPool = {
        total: finiteNumber(poolResult.value.data.pagination?.total, rows.length),
        leaders: rows.slice(0, 20).map((item) => ({
          symbol: securityMeta(item.thscode).symbol,
          name: item.name,
          streak: Math.max(1, finiteNumber(item.continue_day_cnt, 1)),
          firstLimitTime: item.limit_up_time ?? null,
          reason: item.limit_up_reason ?? null,
          sealMoney: item.seal_money === undefined ? null : finiteNumber(item.seal_money),
        })),
      };
    } else {
      errors.push(`涨停池：${poolResult.reason instanceof Error ? poolResult.reason.message : String(poolResult.reason)}`);
    }

    let ladder: FuyaoMorningBriefEvidence["ladder"] = null;
    if (ladderResult.status === "fulfilled") {
      if (ladderResult.value.request_id) requestIds.push(ladderResult.value.request_id);
      const target = ladderResult.value.data.item?.find((item) => item.date === referenceDate);
      if (target) {
        datasetSuccess += 1;
        const groups: Array<[keyof NonNullable<FuyaoMorningBriefEvidence["ladder"]>["counts"], string, number]> = [
          ["two", "two_board", 2],
          ["three", "three_board", 3],
          ["four", "four_board", 4],
          ["five", "five_board", 5],
          ["six", "six_board", 6],
          ["sevenPlus", "seven_over", 7],
        ];
        const leaders = groups.flatMap(([, group, minimum]) => (target.boards?.[group] ?? []).map((item) => ({
          symbol: securityMeta(item.thscode).symbol,
          name: item.name,
          height: Math.max(minimum, finiteNumber(item.board_num, minimum)),
        }))).toSorted((left, right) => right.height - left.height || left.symbol.localeCompare(right.symbol));
        ladder = {
          highest: leaders[0]?.height ?? 0,
          counts: Object.fromEntries(groups.map(([key, group]) => [key, target.boards?.[group]?.length ?? 0])) as NonNullable<FuyaoMorningBriefEvidence["ladder"]>["counts"],
          leaders: leaders.slice(0, 20),
        };
      } else {
        errors.push(`连板梯队：${referenceDate} 无对应记录`);
      }
    } else {
      errors.push(`连板梯队：${ladderResult.reason instanceof Error ? ladderResult.reason.message : String(ladderResult.reason)}`);
    }

    const hotStocks = hotResult.status === "fulfilled"
      ? (hotResult.value.data.item ?? []).filter((item) => !/ST|退/.test(item.name)).slice(0, 20).map((item) => ({
          symbol: securityMeta(item.thscode).symbol,
          name: item.name,
          rank: Math.max(1, finiteNumber(item.rank, 1)),
          rankChange: finiteNumber(item.rank_change),
          heat: item.heat === undefined ? null : finiteNumber(item.heat),
        }))
      : [];
    if (hotResult.status === "fulfilled") {
      datasetSuccess += 1;
      if (hotResult.value.request_id) requestIds.push(hotResult.value.request_id);
    } else {
      errors.push(`热股榜：${hotResult.reason instanceof Error ? hotResult.reason.message : String(hotResult.reason)}`);
    }

    const dragonTiger = dragonResult.status === "fulfilled"
      ? (dragonResult.value.data.stock_items ?? [])
          .filter((item) => !/ST|退|转债/.test(item.name))
          .map((item) => ({
            symbol: securityMeta(item.thscode).symbol,
            name: item.name,
            netValue: item.net_value === undefined ? null : finiteNumber(item.net_value),
            organizationNetValue: item.org_net_value === undefined ? null : finiteNumber(item.org_net_value),
            hotMoneyNetValue: item.hot_money_net_value === undefined ? null : finiteNumber(item.hot_money_net_value),
            concepts: (item.concept_list ?? []).flatMap((concept) => concept.name ? [concept.name] : []).slice(0, 4),
          }))
          .toSorted((left, right) => Math.abs(right.netValue ?? 0) - Math.abs(left.netValue ?? 0))
          .slice(0, 20)
      : [];
    if (dragonResult.status === "fulfilled") {
      datasetSuccess += 1;
      if (dragonResult.value.request_id) requestIds.push(dragonResult.value.request_id);
    } else {
      errors.push(`龙虎榜：${dragonResult.reason instanceof Error ? dragonResult.reason.message : String(dragonResult.reason)}`);
    }

    const status = datasetSuccess === datasetTotal
      ? "complete"
      : datasetSuccess === 0 ? "failed" : "partial";
    return {
      schemaVersion: 1,
      provider: "扶摇 Fuyao",
      status,
      referenceDate,
      marketTime,
      receivedAt,
      datasetTotal,
      datasetSuccess,
      requestIds: [...new Set(requestIds)],
      indices,
      limitUpPool,
      ladder,
      hotStocks,
      dragonTiger,
      errors,
    };
  }

  async fetchFundDailyBars(symbol: string, now = new Date()): Promise<MarketBar[]> {
    const normalized = etfSecurityMeta(symbol).symbol;
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

  async mergeEtfMasterCatalog(marketItems: EtfSnapshot[]): Promise<FuyaoEtfCatalogMerge> {
    const tickers = await this.listTickers("fund-etf");
    if (tickers.length === 0) throw new Error("Fuyao ETF master catalog is empty");
    const marketBySymbol = new Map(
      marketItems.map((item) => [etfSecurityMeta(item.symbol).symbol, item]),
    );
    const masterSymbols = new Set<string>();
    const matched = tickers.flatMap((ticker): EtfSnapshot[] => {
      const symbol = etfSecurityMeta(ticker.thscode).symbol;
      masterSymbols.add(symbol);
      const quote = marketBySymbol.get(symbol);
      if (!quote) return [];
      const classified = classifyEtf(ticker.name);
      return [{
        ...quote,
        symbol: ticker.ticker,
        name: ticker.name,
        category: classified.category,
        tags: classified.tags,
        exchange: ticker.exchange === "SH" ? "SH" : ticker.exchange === "SZ" ? "SZ" : "OTHER",
      }];
    });
    const supplemental = marketItems.filter(
      (item) => !masterSymbols.has(etfSecurityMeta(item.symbol).symbol),
    );
    const items = [...new Map(
      [...matched, ...supplemental].map((item) => [item.symbol, item]),
    ).values()];
    return {
      items,
      masterCount: tickers.length,
      matchedCount: matched.length,
      supplementalCount: supplemental.length,
      coveragePct: Number((matched.length / Math.max(1, tickers.length) * 100).toFixed(2)),
    };
  }

  async fetchEtfSnapshot(symbol: string, ticker?: FuyaoTicker): Promise<EtfSnapshot> {
    const normalized = etfSecurityMeta(symbol).symbol;
    const resolvedTicker = ticker ?? (await this.searchTickers(normalized, "fund-etf", 1))[0];
    if (!resolvedTicker) throw new Error(`Fuyao ETF ${normalized} is not in the master catalog`);
    const data = await this.call<FuyaoSnapshotData<FuyaoPriceRow>>(
      "fund",
      "get_fund_market_snapshot",
      { thscode: normalized },
    );
    const row = data.item?.[0];
    const price = finiteNumber(row?.last_price);
    if (!row || price <= 0) throw new Error(`Fuyao ETF ${normalized} snapshot is empty`);
    const classified = classifyEtf(resolvedTicker.name);
    const exchange = resolvedTicker.exchange === "SH" ? "SH" : resolvedTicker.exchange === "SZ" ? "SZ" : "OTHER";
    return {
      symbol: resolvedTicker.ticker,
      name: resolvedTicker.name,
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
    };
  }

  async fetchEtfSnapshots(symbols: string[], concurrency = 4): Promise<EtfSnapshot[]> {
    const tickers = await this.listTickers("fund-etf");
    const tickerBySymbol = new Map(tickers.map((item) => [etfSecurityMeta(item.thscode).symbol, item]));
    const requested = [...new Set(symbols.map((symbol) => etfSecurityMeta(symbol).symbol))]
      .flatMap((symbol) => tickerBySymbol.has(symbol) ? [symbol] : []);
    const results: EtfSnapshot[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < requested.length) {
        const symbol = requested[cursor++];
        try {
          results.push(await this.fetchEtfSnapshot(symbol, tickerBySymbol.get(symbol)));
        } catch {
          // Failed symbols are omitted so callers cannot mistake zero-filled
          // values for verified Fuyao quotes.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), requested.length) }, worker));
    return results;
  }

  async searchEtfSnapshots(query: string, limit = 10): Promise<EtfSnapshot[]> {
    const tickers = await this.searchTickers(query, "fund-etf", limit);
    const results: EtfSnapshot[] = [];
    for (const ticker of tickers.slice(0, Math.min(10, limit))) {
      try {
        results.push(await this.fetchEtfSnapshot(ticker.thscode, ticker));
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
    const primaryValid = primary
      && primary.price !== null
      && primary.pctChange !== null
      && primary.status !== "failed";
    const crossValid = cross
      && cross.price !== null
      && cross.pctChange !== null
      && cross.status !== "failed";
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
