export type Exchange = "SH" | "SZ" | "BJ";
export type Board = "MAIN" | "CHINEXT" | "STAR" | "BEIJING";

export interface Quote {
  symbol: string;
  name: string;
  exchange: Exchange;
  board: Board;
  isST: boolean;
  isNoLimitDay: boolean;
  previousClose: number;
  open: number;
  price: number;
  high: number;
  low: number;
  pctChange: number;
  amount: number;
  turnoverRate: number;
  limitUpPrice: number;
  limitDownPrice: number;
  sector: string;
  firstLimitTime: string | null;
  limitStreak: number;
}

export interface Breadth {
  rising: number;
  falling: number;
  flat: number;
}

export interface SectorMetric {
  name: string;
  limitUpCount: number;
  averagePct: number;
  amountGrowthPct: number;
  maxStreak: number;
}

export interface DailyReview {
  date: string;
  status: "complete" | "partial" | "failed" | "demo";
  source: string;
  updatedAt: string;
  breadth: Array<Breadth & { time: string }>;
  metrics: {
    limitUp: number;
    limitDown: number;
    consecutive: number;
    largeRise: number;
    high120: number | null;
    allTimeHigh: number | null;
    marginBalance: number | null;
  };
  premium: { openPct: number | null; closePct: number | null; sampleSize: number };
  ladder: Record<"first" | "second" | "third" | "fourth" | "fivePlus", Quote[]>;
  sectors: SectorMetric[];
  leaders: Quote[];
}
