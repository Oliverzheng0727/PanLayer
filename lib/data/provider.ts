import type { Quote, SectorMetric } from "../domain/types";

export type MarketDatumStatus = "complete" | "partial" | "failed";

export interface AdjustedBar {
  date: string;
  close: number;
  volume?: number;
  amount?: number;
  pctChange?: number;
}

export interface BoardPoolItem {
  code: string;
  name: string;
  pctChange: number | null;
  amount: number | null;
  industry: string;
  limitStreak: number;
  previousLimitStreak: number;
  firstLimitTime: string | null;
}

export interface BoardPools {
  limitUp: BoardPoolItem[];
  broken: BoardPoolItem[];
  limitDown: BoardPoolItem[];
  yesterdayLimitUp: BoardPoolItem[];
}

export interface MarketAggregate {
  amount: number | null;
  rawCount: number;
  validCount: number;
  coveragePct: number;
  marketTime: string | null;
  receivedAt: string;
  source: string;
  status: MarketDatumStatus;
  message: string;
}

export interface IndexSnapshot {
  symbol: string;
  name: string;
  price: number | null;
  pctChange: number | null;
  amount: number | null;
  marketTime: string | null;
  receivedAt: string;
  source: string;
  status: MarketDatumStatus;
  message: string;
}

export interface EtfSnapshot {
  symbol: string;
  name: string;
  category: string;
  tags: string[];
  exchange: "SH" | "SZ" | "OTHER";
  price: number;
  pctChange: number;
  amount: number;
  averageAmount20: number | null;
  scale: number | null;
  turnoverRate: number | null;
  status: "active" | "paused" | "delisted";
  updatedAt: string;
}

export interface MarketDataProvider {
  readonly name: string;
  getUniverse(): Promise<Quote[]>;
  getQuotes(at: string): Promise<Quote[]>;
  getLimitPool(date: string): Promise<Quote[]>;
  getBoardPools(date: string): Promise<BoardPools>;
  getMarketAggregate(at: string): Promise<MarketAggregate>;
  getIndexSnapshots(date: string): Promise<IndexSnapshot[]>;
  getAdjustedBars(symbol: string): Promise<AdjustedBar[]>;
  getSectors(date: string): Promise<SectorMetric[]>;
  getEtfs(date: string): Promise<EtfSnapshot[]>;
  getMarginBalance(date: string): Promise<number | null>;
}
