import type { Quote, SectorMetric } from "../domain/types";

export interface AdjustedBar {
  date: string;
  close: number;
}

export interface EtfSnapshot {
  symbol: string;
  name: string;
  category: string;
  price: number;
  pctChange: number;
  amount: number;
  scale: number | null;
}

export interface MarketDataProvider {
  readonly name: string;
  getUniverse(): Promise<Quote[]>;
  getQuotes(at: string): Promise<Quote[]>;
  getLimitPool(date: string): Promise<Quote[]>;
  getAdjustedBars(symbol: string): Promise<AdjustedBar[]>;
  getSectors(date: string): Promise<SectorMetric[]>;
  getEtfs(date: string): Promise<EtfSnapshot[]>;
  getMarginBalance(date: string): Promise<number | null>;
}
