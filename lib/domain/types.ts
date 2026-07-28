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
  turnoverRate: number | null;
  limitUpPrice: number;
  limitDownPrice: number;
  sector: string;
  firstLimitTime: string | null;
  limitStreak: number;
  listingDate?: string | null;
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

export interface StructuredSignalEvidence {
  source: string;
  requestId: string | null;
  marketTime: string | null;
  receivedAt: string;
  rawCount: number;
  validCount: number;
  coveragePct: number | null;
  status: "complete" | "partial" | "failed";
  message: string;
}

export interface StructuredMarketSignals {
  schemaVersion: 1;
  provider: "扶摇 Fuyao";
  referenceDate: string;
  marketTime: string;
  receivedAt: string;
  status: "complete" | "partial" | "failed";
  datasetTotal: number;
  datasetSuccess: number;
  requestIds: string[];
  hotStocks: Array<{
    symbol: string;
    name: string;
    rank: number;
    rankChange: number;
    heat: number | null;
  }>;
  skyrocket: Array<{
    symbol: string;
    name: string;
    rank: number;
    rankChange: number;
    heat: number | null;
    analysis: string | null;
  }>;
  dragonTiger: Array<{
    symbol: string;
    name: string;
    netValue: number | null;
    organizationNetValue: number | null;
    hotMoneyNetValue: number | null;
    concepts: string[];
  }>;
  anomalies: Array<{
    symbol: string;
    name: string;
    title: string | null;
    analysis: string | null;
    keywords: string[];
  }>;
  sectors: SectorMetric[];
  evidence: Record<string, StructuredSignalEvidence>;
  errors: string[];
}

export interface RecognitionRankingItem {
  rank: number;
  symbol: string;
  name: string;
  tier: "first" | "second";
  limitStreak: number;
  pctChange: number;
  amount: number;
  volume: number;
  turnoverRate: number;
  averageVolume3: number;
  averageVolume30: number;
  volumeRatio: number;
  hotRank: number;
  hotRankChange: number;
  hotHeat: number | null;
  concepts: string[];
  topic: string;
  topicSource: string;
  priceVolumeState: "上涨放量" | "回调缩量" | "上涨未充分放量" | "回调放量";
  scores: {
    streak: number;
    liquidity: number;
    popularity: number;
    total: number;
  };
  highlights: string[];
}

export interface RecognitionRanking {
  schemaVersion: 1 | 2;
  status: "complete" | "partial" | "failed";
  referenceDate: string;
  marketTime: string;
  receivedAt: string;
  source: string;
  items: RecognitionRankingItem[];
  firstTierCount: number;
  secondTierCount: number;
  filters: {
    ladderCandidates: number;
    excludedBase: number;
    excludedAmount: number;
    excludedTurnover: number;
    excludedListingAge: number;
    excludedHotRank: number;
    excludedVolumeHistory: number;
    excludedVolumeCondition: number;
    qualified: number;
  };
  evidence: {
    hotListSource: string;
    quoteSource: string;
    barsSource: string;
    ladderSource: string;
    hotListStatus: "complete" | "partial" | "failed";
    hotListCount: number;
    barCandidateCount: number;
    barSuccessCount: number;
    message: string;
  };
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
    schemaVersion?: 2;
    fields?: Record<string, {
      status: "complete" | "partial" | "pending" | "unavailable";
      source: string;
      coveragePct: number | null;
      reason: string | null;
      verifiedAt: string;
    }>;
  };
  structuredSignals?: StructuredMarketSignals;
  recognitionRanking?: RecognitionRanking;
}
