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
  amountGrowthPct: number | null;
  maxStreak: number;
}

export interface ComparisonStock {
  code: string;
  name: string;
  isLimitUp?: boolean;
  pctChange: number | null;
  amount: number | null;
  sector: string;
  limitStreak: number;
  firstLimitTime: string | null;
}

export interface ComparisonIndex {
  symbol: string;
  name: string;
  price: number | null;
  pctChange: number | null;
  amount: number | null;
  marketTime: string | null;
  receivedAt: string;
  source: string;
  status: "complete" | "partial" | "failed";
  message: string;
}

export interface MetricEvidence {
  source: string;
  formula: string;
  marketTime: string | null;
  receivedAt: string;
  sampleSize: number;
  coveragePct: number | null;
  status: "complete" | "partial" | "failed";
  message: string;
}

export interface DailyComparison {
  brokenCount: number | null;
  largeDownCount: number | null;
  sealRate: number | null;
  yesterdaySuccessRate: number | null;
  yesterdaySuccessSampleSize: number;
  continuation: {
    positiveRate: number;
    averagePct: number;
    promotionRate: number;
    sampleSize: number;
  } | null;
  marketAmount: number | null;
  marketCoveragePct: number | null;
  maxBoard: { height: number; stocks: ComparisonStock[] } | null;
  brokenBoard: { count: number | null; rate: number | null; sampleSize: number; stocks: ComparisonStock[] };
  mainSectors: SectorMetric[];
  cycleLeader: ComparisonStock | null;
  recognition: ComparisonStock[];
  indices: ComparisonIndex[];
  evidence: Record<string, MetricEvidence>;
}

export interface DailyReview {
  date: string;
  status: "complete" | "partial" | "failed" | "demo";
  source: string;
  updatedAt: string;
  unavailableReason?: string;
  breadth: Array<Breadth & { time: string }>;
  breadthMeta?: {
    expected: number;
    captured: number;
    missing: string[];
    status: "complete" | "partial";
  };
  metrics: {
    limitUp: number | null;
    limitDown: number | null;
    consecutive: number | null;
    largeRise: number | null;
    high20?: number | null;
    high120: number | null;
    allTimeHigh: number | null;
    marginBalance: number | null;
  };
  premium: { openPct: number | null; closePct: number | null; sampleSize: number };
  ladder: Record<"first" | "second" | "third" | "fourth" | "fivePlus", Quote[]>;
  sectors: SectorMetric[];
  leaders: Quote[];
  structure?: {
    status: "complete" | "partial" | "failed";
    source: string;
    message: string;
    receivedAt: string;
  };
  comparison?: DailyComparison;
  historyMeta?: {
    backfilled: boolean;
    receivedAt: string;
  };
}
