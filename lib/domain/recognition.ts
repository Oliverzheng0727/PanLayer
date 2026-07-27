import type { AdjustedBar, BoardPoolItem } from "../data/provider";
import type { PopularitySnapshot } from "../data/ths-popularity";
import type {
  Quote,
  RecognitionRanking,
  RecognitionRankingItem,
  StructuredMarketSignals,
} from "./types";

export interface RecognitionBars {
  symbol: string;
  bars: AdjustedBar[];
  source: string;
}

const MINIMUM_AMOUNT = 300_000_000;
const MINIMUM_TURNOVER = 8;

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

function dateDifferenceDays(left: string, right: string): number {
  return Math.floor(
    (new Date(`${left}T00:00:00Z`).getTime() - new Date(`${right}T00:00:00Z`).getTime())
      / 86_400_000,
  );
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function amountScore(amount: number): number {
  const progress = clamp(
    Math.log(amount / MINIMUM_AMOUNT) / Math.log(2_000_000_000 / MINIMUM_AMOUNT),
  );
  return round(5 + 15 * progress);
}

function fallbackPopularity(
  date: string,
  receivedAt: string,
  signals: StructuredMarketSignals | undefined,
): PopularitySnapshot | null {
  if (!signals?.hotStocks.length) return null;
  return {
    source: "扶摇 Fuyao 热股榜（降级）",
    status: "partial",
    marketTime: `${date}T15:00:00+08:00`,
    receivedAt,
    rawCount: signals.hotStocks.length,
    items: signals.hotStocks
      .filter((item) => item.rank >= 1 && item.rank <= 30)
      .map((item) => ({
        symbol: item.symbol,
        name: item.name,
        rank: item.rank,
        rankChange: item.rankChange,
        heat: item.heat,
        concepts: [],
        analysisTitle: null,
      })),
    message: "同花顺热榜不可用，使用扶摇热股榜降级；排名状态标记为部分",
  };
}

export function buildRecognitionRanking({
  date,
  quotes,
  limitUpPool,
  popularity,
  bars,
  structuredSignals,
  quoteSource,
  ladderSource,
  receivedAt,
}: {
  date: string;
  quotes: Quote[];
  limitUpPool: BoardPoolItem[];
  popularity: PopularitySnapshot;
  bars: RecognitionBars[];
  structuredSignals?: StructuredMarketSignals;
  quoteSource: string;
  ladderSource: string;
  receivedAt: string;
}): RecognitionRanking {
  const effectivePopularity = popularity.items.length > 0
    ? popularity
    : fallbackPopularity(date, receivedAt, structuredSignals) ?? popularity;
  const hotBySymbol = new Map(effectivePopularity.items.map((item) => [item.symbol, item]));
  const quoteByCode = new Map(quotes.map((item) => [item.symbol.split(".")[0], item]));
  const barsBySymbol = new Map(bars.map((item) => [item.symbol, item]));
  const anomalyBySymbol = new Map(
    structuredSignals?.anomalies.map((item) => [item.symbol, item]) ?? [],
  );
  const filters: RecognitionRanking["filters"] = {
    ladderCandidates: limitUpPool.length,
    excludedBase: 0,
    excludedAmount: 0,
    excludedTurnover: 0,
    excludedListingAge: 0,
    excludedHotRank: 0,
    excludedVolumeHistory: 0,
    excludedVolumeCondition: 0,
    qualified: 0,
  };
  const maxStreak = Math.max(1, ...limitUpPool.map((item) => Math.max(1, item.limitStreak)));
  const qualified: Omit<RecognitionRankingItem, "rank" | "tier">[] = [];

  for (const pool of limitUpPool) {
    const quote = quoteByCode.get(pool.code);
    if (
      !quote
      || quote.price <= 0
      || quote.isST
      || quote.isNoLimitDay
      || /(?:\*?ST|退)/i.test(quote.name)
    ) {
      filters.excludedBase += 1;
      continue;
    }
    if (!Number.isFinite(quote.amount) || quote.amount < MINIMUM_AMOUNT) {
      filters.excludedAmount += 1;
      continue;
    }
    if (!Number.isFinite(quote.turnoverRate) || quote.turnoverRate <= MINIMUM_TURNOVER) {
      filters.excludedTurnover += 1;
      continue;
    }
    const hot = hotBySymbol.get(quote.symbol);
    if (!hot || hot.rank < 1 || hot.rank > 30) {
      filters.excludedHotRank += 1;
      continue;
    }
    const history = barsBySymbol.get(quote.symbol);
    const usableBars = (history?.bars ?? [])
      .filter((item) =>
        item.date <= date
        && Number.isFinite(item.close)
        && item.close > 0
        && Number.isFinite(item.volume)
        && (item.volume ?? 0) > 0)
      .toSorted((left, right) => left.date.localeCompare(right.date));
    const earliestDate = usableBars[0]?.date ?? null;
    const listingDate = quote.listingDate ?? earliestDate;
    if (!listingDate || dateDifferenceDays(date, listingDate) < 7) {
      filters.excludedListingAge += 1;
      continue;
    }
    if (usableBars.length < 30 || usableBars.at(-1)?.date !== date) {
      filters.excludedVolumeHistory += 1;
      continue;
    }
    const latest30 = usableBars.slice(-30);
    const latest3 = latest30.slice(-3);
    const volume = latest30.at(-1)!.volume!;
    const averageVolume3 = average(latest3.map((item) => item.volume!));
    const averageVolume30 = average(latest30.map((item) => item.volume!));
    if (!(averageVolume3 > averageVolume30 && volume >= averageVolume30)) {
      filters.excludedVolumeCondition += 1;
      continue;
    }

    const volumeRatio = averageVolume3 / averageVolume30;
    const volumeScore = round(12 * clamp(volumeRatio - 1));
    const priceVolumeState: RecognitionRankingItem["priceVolumeState"] =
      quote.pctChange >= 0
        ? volume >= averageVolume3 ? "上涨放量" : "上涨未充分放量"
        : volume <= averageVolume3 ? "回调缩量" : "回调放量";
    const structureScore = priceVolumeState === "上涨放量" || priceVolumeState === "回调缩量"
      ? 8 : priceVolumeState === "上涨未充分放量" ? 4 : 0;
    const liquidity = round(amountScore(quote.amount) + volumeScore + structureScore);
    const streak = round(
      Math.min(30, 25 * Math.max(1, pool.limitStreak) / maxStreak + (pool.limitStreak === maxStreak ? 5 : 0)),
    );
    const popularityScore = round((31 - hot.rank) / 30 * 30);
    const total = round(streak + liquidity + popularityScore);
    const anomaly = anomalyBySymbol.get(quote.symbol);
    const concepts = hot.concepts.length > 0
      ? hot.concepts
      : anomaly?.keywords.slice(0, 6) ?? [];
    const topic = hot.analysisTitle
      || concepts.join(" / ")
      || (pool.industry && pool.industry !== "未分类" ? pool.industry : null)
      || anomaly?.title
      || "暂缺";
    const topicSource = hot.analysisTitle || hot.concepts.length > 0
      ? effectivePopularity.source
      : pool.industry && pool.industry !== "未分类"
        ? ladderSource
        : anomaly ? "扶摇 Fuyao 异动原因" : "暂缺";
    qualified.push({
      symbol: quote.symbol,
      name: quote.name || pool.name,
      limitStreak: Math.max(1, pool.limitStreak),
      pctChange: quote.pctChange,
      amount: quote.amount,
      volume,
      turnoverRate: quote.turnoverRate,
      averageVolume3: round(averageVolume3, 0),
      averageVolume30: round(averageVolume30, 0),
      volumeRatio: round(volumeRatio, 2),
      hotRank: hot.rank,
      hotRankChange: hot.rankChange,
      hotHeat: hot.heat,
      concepts,
      topic,
      topicSource,
      priceVolumeState,
      scores: { streak, liquidity, popularity: popularityScore, total },
      highlights: [
        `${Math.max(1, pool.limitStreak)}板`,
        `热榜第${hot.rank}`,
        `3日/30日量比 ${round(volumeRatio, 2)}倍`,
        priceVolumeState,
      ],
    });
  }

  const sorted = qualified.toSorted((left, right) =>
    right.scores.total - left.scores.total
    || left.hotRank - right.hotRank
    || right.limitStreak - left.limitStreak
    || right.amount - left.amount
    || left.symbol.localeCompare(right.symbol));
  const items = sorted.map((item, index): RecognitionRankingItem => ({
    ...item,
    rank: index + 1,
    tier: item.scores.total >= 75 || (item.limitStreak === maxStreak && item.hotRank <= 10)
      ? "first"
      : "second",
  }));
  filters.qualified = items.length;
  const barSuccessCount = bars.filter((item) => item.bars.length >= 30).length;
  const hotStatus = effectivePopularity.status;
  const status = hotStatus === "failed"
    ? "failed"
    : barSuccessCount < bars.length || hotStatus === "partial" ? "partial" : "complete";
  const barSources = [...new Set(bars.map((item) => item.source).filter(Boolean))];
  return {
    schemaVersion: 1,
    status,
    referenceDate: date,
    marketTime: `${date}T15:00:00+08:00`,
    receivedAt,
    source: [
      effectivePopularity.source,
      quoteSource,
      ladderSource,
      ...barSources,
    ].filter(Boolean).join(" / "),
    items,
    firstTierCount: items.filter((item) => item.tier === "first").length,
    secondTierCount: items.filter((item) => item.tier === "second").length,
    filters,
    evidence: {
      hotListSource: effectivePopularity.source,
      quoteSource,
      barsSource: barSources.join(" / ") || "暂缺",
      ladderSource,
      hotListStatus: hotStatus,
      hotListCount: effectivePopularity.items.length,
      barCandidateCount: bars.length,
      barSuccessCount,
      message: [
        effectivePopularity.message,
        items.length > 0
          ? `严格门槛入围 ${items.length} 只`
          : "当日没有股票同时满足全部硬门槛；不会放宽条件或使用 AI 补充名单",
      ].filter(Boolean).join("；"),
    },
  };
}
