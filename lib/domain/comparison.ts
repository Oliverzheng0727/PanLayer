import type { BoardPoolItem, BoardPools, IndexSnapshot, MarketAggregate } from "../data/provider";
import { classifyLimitStatus, rankSectors } from "./metrics";
import type {
  ComparisonStock,
  DailyComparison,
  MetricEvidence,
  Quote,
  SectorMetric,
} from "./types";

const percentage = (part: number, total: number): number | null =>
  total > 0 ? Number(((part / total) * 100).toFixed(2)) : null;

const mean = (values: number[]): number | null =>
  values.length > 0
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
    : null;

const isExcludedName = (name: string) => /(?:\*?ST|退)/i.test(name);

export function withoutStBoardPools(pools: BoardPools): BoardPools {
  const keep = (item: BoardPoolItem) => !isExcludedName(item.name);
  return {
    limitUp: pools.limitUp.filter(keep),
    broken: pools.broken.filter(keep),
    limitDown: pools.limitDown.filter(keep),
    yesterdayLimitUp: pools.yesterdayLimitUp.filter(keep),
  };
}

function comparisonStock(item: BoardPoolItem, isLimitUp: boolean): ComparisonStock {
  return {
    code: item.code,
    name: item.name,
    isLimitUp,
    pctChange: item.pctChange,
    amount: item.amount,
    sector: item.industry || "未分类",
    limitStreak: item.limitStreak,
    firstLimitTime: item.firstLimitTime,
  };
}

function rankPoolStocks(items: BoardPoolItem[], isLimitUp: boolean): ComparisonStock[] {
  return items
    .map((item) => comparisonStock(item, isLimitUp))
    .toSorted((left, right) =>
      right.limitStreak - left.limitStreak
      || Number(Boolean(right.isLimitUp)) - Number(Boolean(left.isLimitUp))
      || (left.firstLimitTime ?? "99:99:99").localeCompare(right.firstLimitTime ?? "99:99:99")
      || (right.amount ?? 0) - (left.amount ?? 0)
      || left.code.localeCompare(right.code),
    );
}

function evidence(input: {
  source: string;
  formula: string;
  marketTime: string | null;
  receivedAt: string;
  sampleSize: number;
  coveragePct?: number | null;
  status: MetricEvidence["status"];
  message?: string;
}): MetricEvidence {
  return {
    source: input.source,
    formula: input.formula,
    marketTime: input.marketTime,
    receivedAt: input.receivedAt,
    sampleSize: input.sampleSize,
    coveragePct: input.coveragePct ?? null,
    status: input.status,
    message: input.message ?? "",
  };
}

export function buildMarketComparison({
  date,
  quotes,
  pools,
  marketAggregate,
  indices,
  sectors,
  source,
  receivedAt,
}: {
  date: string;
  quotes: Quote[];
  pools: BoardPools;
  marketAggregate: MarketAggregate | null;
  indices: IndexSnapshot[];
  sectors: SectorMetric[];
  source: string;
  receivedAt: string;
}): DailyComparison {
  const validPools = withoutStBoardPools(pools);
  const marketTime = `${date}T15:00:00+08:00`;
  const limitCodes = new Set(validPools.limitUp.map((item) => item.code));
  const closeLimitCodes = new Set(quotes
    .filter((item) => !item.isST && classifyLimitStatus(item) === "limit-up")
    .map((item) => item.symbol.split(".")[0]));
  const missingFromClose = [...limitCodes].filter((code) => !closeLimitCodes.has(code));
  const missingFromPool = [...closeLimitCodes].filter((code) => !limitCodes.has(code));
  const poolUnionSize = new Set([...limitCodes, ...closeLimitCodes]).size;
  const poolDifference = missingFromClose.length + missingFromPool.length;
  const poolMismatch = quotes.length > 0
    && poolDifference >= 2
    && poolDifference / Math.max(1, poolUnionSize) >= .1;
  const poolConsistencyMessage = quotes.length === 0
    ? "缺少全市场收盘快照，未执行涨停池交叉校验"
    : poolMismatch
      ? `涨停池 ${limitCodes.size}；收盘价计算 ${closeLimitCodes.size}；池有价无 ${missingFromClose.slice(0, 12).join("、") || "无"}；价有池无 ${missingFromPool.slice(0, 12).join("、") || "无"}`
      : `涨停池 ${limitCodes.size}；收盘价计算 ${closeLimitCodes.size}；差异 ${poolDifference}`;
  const poolEvidenceStatus: MetricEvidence["status"] = quotes.length === 0
    ? "partial"
    : poolMismatch ? "partial" : "complete";
  const validYesterday = validPools.yesterdayLimitUp.filter((item) => item.pctChange !== null);
  const previousMultiBoards = validYesterday.filter((item) => item.previousLimitStreak >= 2);
  const brokenStocks = previousMultiBoards.filter((item) => !limitCodes.has(item.code));
  const promoted = previousMultiBoards.filter((item) => limitCodes.has(item.code)).length;
  const continuationPcts = previousMultiBoards.flatMap((item) =>
    item.pctChange === null ? [] : [item.pctChange],
  );
  const continuationAverage = mean(continuationPcts);
  const ranked = rankPoolStocks(validPools.limitUp, true);
  const recognitionRanked = [
    ...rankPoolStocks(validPools.limitUp, true),
    ...rankPoolStocks(validPools.broken, false),
  ].toSorted((left, right) =>
    right.limitStreak - left.limitStreak
    || Number(Boolean(right.isLimitUp)) - Number(Boolean(left.isLimitUp))
    || (left.firstLimitTime ?? "99:99:99").localeCompare(right.firstLimitTime ?? "99:99:99")
    || (right.amount ?? 0) - (left.amount ?? 0)
    || left.code.localeCompare(right.code));
  const maxHeight = ranked[0]?.limitStreak ?? 0;
  const maxStocks = maxHeight > 0 ? ranked.filter((item) => item.limitStreak === maxHeight) : [];
  const largeDownCount = quotes.filter((item) =>
    !item.isST
    && Number.isFinite(item.pctChange)
    && item.pctChange <= -7
    && classifyLimitStatus(item) !== "limit-down",
  ).length;
  const boardAttempts = validPools.limitUp.length + validPools.broken.length;
  const sealRate = percentage(validPools.limitUp.length, boardAttempts);
  const yesterdaySuccessRate = percentage(
    validYesterday.filter((item) => (item.pctChange ?? 0) > 0).length,
    validYesterday.length,
  );
  const brokenRate = percentage(brokenStocks.length, previousMultiBoards.length);
  const comparisonEvidence: Record<string, MetricEvidence> = {
    brokenCount: evidence({
      source: "东方财富炸板池",
      formula: "当日曾触及涨停但收盘未封板的有效股票数",
      marketTime,
      receivedAt,
      sampleSize: validPools.broken.length,
      status: poolEvidenceStatus,
      message: poolConsistencyMessage,
    }),
    largeDownCount: evidence({
      source,
      formula: "剔除 ST 后，收盘跌幅 ≤ -7% 且未封跌停",
      marketTime,
      receivedAt,
      sampleSize: quotes.length,
      status: quotes.length > 0 ? "complete" : "partial",
    }),
    sealRate: evidence({
      source: "东方财富涨停池 / 炸板池",
      formula: "涨停家数 ÷（涨停家数 + 炸板家数）",
      marketTime,
      receivedAt,
      sampleSize: boardAttempts,
      status: boardAttempts > 0 && !poolMismatch ? "complete" : "partial",
      message: poolConsistencyMessage,
    }),
    yesterdaySuccessRate: evidence({
      source: "东方财富昨日涨停池",
      formula: "昨日涨停池今日收盘上涨数 ÷ 有效样本数",
      marketTime,
      receivedAt,
      sampleSize: validYesterday.length,
      status: validYesterday.length > 0 ? "complete" : "partial",
    }),
    continuation: evidence({
      source: "东方财富昨日涨停池 / 今日涨停池",
      formula: "昨日二板及以上样本的收红率、平均收盘涨幅与晋级率",
      marketTime,
      receivedAt,
      sampleSize: previousMultiBoards.length,
      status: previousMultiBoards.length > 0 ? "complete" : "partial",
    }),
    marketAmount: evidence({
      source: marketAggregate?.source ?? source,
      formula: "沪深京全 A（含 ST）有效成交额去重求和",
      marketTime: marketAggregate?.marketTime ?? marketTime,
      receivedAt: marketAggregate?.receivedAt ?? receivedAt,
      sampleSize: marketAggregate?.validCount ?? 0,
      coveragePct: marketAggregate?.coveragePct ?? null,
      status: marketAggregate?.status ?? "failed",
      message: marketAggregate?.message ?? "全市场成交额暂缺",
    }),
    brokenBoard: evidence({
      source: "东方财富昨日涨停池 / 今日涨停池",
      formula: "昨日二板及以上今日未封涨停数 ÷ 昨日二板及以上有效样本",
      marketTime,
      receivedAt,
      sampleSize: previousMultiBoards.length,
      status: previousMultiBoards.length > 0 ? "complete" : "partial",
    }),
    maxBoard: evidence({
      source: "东方财富涨停池",
      formula: "取当日涨停池最高连板高度，并列股票全部保留",
      marketTime,
      receivedAt,
      sampleSize: validPools.limitUp.length,
      status: poolEvidenceStatus,
      message: poolConsistencyMessage,
    }),
    mainSectors: evidence({
      source,
      formula: "依次比较涨停家数、板块平均涨幅、成交额增量、最高连板高度",
      marketTime,
      receivedAt,
      sampleSize: sectors.length,
      status: sectors.length > 0 && sectors.every((item) => item.amountGrowthPct !== null) ? "complete" : "partial",
      message: sectors.length > 0 && sectors.some((item) => item.amountGrowthPct === null)
        ? "成交额增量暂无可验证的昨日同口径板块快照；该项显示暂缺，排序使用其余真实字段"
        : "",
    }),
    cycleLeader: evidence({
      source: "东方财富涨停池",
      formula: "按连板高度、首次封板时间、成交额排序；至少二板才认定周期龙头",
      marketTime,
      receivedAt,
      sampleSize: validPools.limitUp.length,
      status: poolEvidenceStatus,
      message: poolConsistencyMessage,
    }),
    recognition: evidence({
      source: "东方财富涨停池",
      formula: "按连板高度、是否封板、首次封板时间、成交额排序取前五",
      marketTime,
      receivedAt,
      sampleSize: validPools.limitUp.length,
      status: poolEvidenceStatus,
      message: poolConsistencyMessage,
    }),
    indices: evidence({
      source: indices.map((item) => item.source).filter(Boolean).join(" / ") || "腾讯 / 东方财富",
      formula: "五大 A 股指数收盘点位、涨跌幅与成交额",
      marketTime: indices[0]?.marketTime ?? marketTime,
      receivedAt: indices[0]?.receivedAt ?? receivedAt,
      sampleSize: indices.length,
      status: indices.length === 5 && indices.every((item) => item.status === "complete") ? "complete" : indices.length > 0 ? "partial" : "failed",
    }),
    poolConsistency: evidence({
      source: `${source} / 东方财富涨停池`,
      formula: "东方财富涨停池代码与全市场收盘价涨停代码集合交叉比对",
      marketTime,
      receivedAt,
      sampleSize: poolUnionSize,
      status: poolEvidenceStatus,
      message: poolConsistencyMessage,
    }),
  };

  return {
    brokenCount: validPools.broken.length,
    largeDownCount: quotes.length > 0 ? largeDownCount : null,
    sealRate,
    yesterdaySuccessRate,
    yesterdaySuccessSampleSize: validYesterday.length,
    continuation: previousMultiBoards.length > 0 && continuationAverage !== null ? {
      positiveRate: percentage(continuationPcts.filter((value) => value > 0).length, continuationPcts.length) ?? 0,
      averagePct: continuationAverage,
      promotionRate: percentage(promoted, previousMultiBoards.length) ?? 0,
      sampleSize: previousMultiBoards.length,
    } : null,
    marketAmount: marketAggregate?.status === "complete" && marketAggregate.coveragePct >= 95
      ? marketAggregate.amount
      : null,
    marketCoveragePct: marketAggregate?.coveragePct ?? null,
    maxBoard: maxStocks.length > 0 ? { height: maxHeight, stocks: maxStocks } : null,
    brokenBoard: {
      count: previousMultiBoards.length > 0 ? brokenStocks.length : null,
      rate: brokenRate,
      sampleSize: previousMultiBoards.length,
      stocks: rankPoolStocks(brokenStocks, false),
    },
    mainSectors: rankSectors(sectors).slice(0, 3),
    cycleLeader: (recognitionRanked[0]?.limitStreak ?? 0) >= 2 ? recognitionRanked[0] : null,
    recognition: recognitionRanked.slice(0, 5),
    indices,
    evidence: comparisonEvidence,
  };
}
