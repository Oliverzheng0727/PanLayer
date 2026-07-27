import { createEastmoneyProvider } from "../data/eastmoney";
import { createFuyaoMcpClient, mergeVerifiedIndexSnapshots } from "../data/fuyao-mcp";
import { withRetry } from "../data/resilience";
import { bucketLimitLadder, rankLeaders, rankSectors } from "../domain/metrics";
import { buildMarketComparison, withoutStBoardPools } from "../domain/comparison";
import type { Board, DailyReview, Exchange, Quote, SectorMetric } from "../domain/types";
import type { IndexSnapshot } from "../data/provider";
import {
  fetchHistoricalBoardPools,
  fetchRecentTradingDates,
  type HistoricalBoardPools,
  type HistoricalPoolItem,
} from "./backfill-sources";

const PROGRESS_KEY = "history-backfill-v5-evidence-safe";
const EMPTY_POOLS: HistoricalBoardPools = {
  limitUp: [],
  broken: [],
  limitDown: [],
  yesterdayLimitUp: [],
};

export interface HistoryBackfillProgress {
  target: number;
  completed: number;
  remaining: number;
  dates: string[];
}

interface StoredProgress {
  endDate: string;
  days: number;
  dates: string[];
  completed: string[];
}

function securityMeta(code: string): { exchange: Exchange; board: Board; limitRate: number } {
  if (/^(9|8|4)/.test(code)) return { exchange: "BJ", board: "BEIJING", limitRate: .3 };
  if (/^688/.test(code)) return { exchange: "SH", board: "STAR", limitRate: .2 };
  if (/^(300|301)/.test(code)) return { exchange: "SZ", board: "CHINEXT", limitRate: .2 };
  if (/^6/.test(code)) return { exchange: "SH", board: "MAIN", limitRate: .1 };
  return { exchange: "SZ", board: "MAIN", limitRate: .1 };
}

function poolItemToQuote(item: HistoricalPoolItem): Quote {
  const meta = securityMeta(item.code);
  const price = 1;
  const previousClose = price / (1 + meta.limitRate);
  return {
    symbol: `${item.code}.${meta.exchange}`,
    name: item.name,
    exchange: meta.exchange,
    board: meta.board,
    isST: false,
    isNoLimitDay: false,
    previousClose,
    open: price,
    price,
    high: price,
    low: previousClose,
    pctChange: item.pctChange ?? 0,
    amount: item.amount ?? 0,
    turnoverRate: 0,
    limitUpPrice: price,
    limitDownPrice: previousClose * (1 - meta.limitRate),
    sector: item.industry || "未分类",
    firstLimitTime: item.firstLimitTime,
    limitStreak: Math.max(1, item.limitStreak),
  };
}

function buildBackfillSectors(items: HistoricalPoolItem[]): SectorMetric[] {
  const groups = new Map<string, HistoricalPoolItem[]>();
  for (const item of items) {
    const sector = item.industry || "未分类";
    groups.set(sector, [...(groups.get(sector) ?? []), item]);
  }
  return rankSectors([...groups].map(([name, group]) => ({
    name,
    limitUpCount: group.length,
    averagePct: Number((
      group.flatMap((item) => item.pctChange === null ? [] : [item.pctChange])
        .reduce((sum, value) => sum + value, 0)
      / Math.max(1, group.filter((item) => item.pctChange !== null).length)
    ).toFixed(2)),
    amountGrowthPct: null,
    maxStreak: Math.max(0, ...group.map((item) => item.limitStreak)),
  }))).slice(0, 20);
}

export function buildBackfilledReview(
  date: string,
  pools: HistoricalBoardPools,
  marginBalance: number | null,
  receivedAt: string,
  indices: IndexSnapshot[] = [],
  poolSource = "东方财富历史四池",
): DailyReview {
  const validPools = withoutStBoardPools(pools);
  const limitUps = validPools.limitUp.map(poolItemToQuote);
  const sectors = buildBackfillSectors(validPools.limitUp);
  return {
    date,
    status: "partial",
    source: `历史回补 · ${poolSource} / 新浪交易日历`,
    updatedAt: receivedAt,
    breadth: [],
    metrics: {
      limitUp: validPools.limitUp.length,
      limitDown: validPools.limitDown.length,
      consecutive: validPools.limitUp.filter((item) => item.limitStreak >= 2).length,
      largeRise: null,
      high120: null,
      allTimeHigh: null,
      marginBalance,
    },
    premium: { openPct: null, closePct: null, sampleSize: 0 },
    ladder: bucketLimitLadder(limitUps),
    sectors,
    leaders: rankLeaders(limitUps).slice(0, 20),
    structure: {
      status: "complete",
      source: poolSource,
      message: `历史涨停池 ${validPools.limitUp.length} 只，已修复连板高度、行业与首次封板时间`,
      receivedAt,
    },
    comparison: buildMarketComparison({
      date,
      quotes: [],
      pools: validPools,
      marketAggregate: null,
      indices,
      sectors,
      source: poolSource,
      receivedAt,
    }),
    historyMeta: { backfilled: true, receivedAt },
  };
}

export function buildEvidenceOnlyBackfilledReview(
  date: string,
  marginBalance: number | null,
  receivedAt: string,
  indices: IndexSnapshot[],
  unavailableReason: string,
): DailyReview {
  const source = "历史回补 · 东方财富历史指数/两融 / 新浪交易日历";
  const comparison = buildMarketComparison({
    date,
    quotes: [],
    pools: EMPTY_POOLS,
    marketAggregate: null,
    indices,
    sectors: [],
    source,
    receivedAt,
  });
  const poolEvidenceKeys = [
    "brokenCount",
    "sealRate",
    "yesterdaySuccessRate",
    "continuation",
    "brokenBoard",
    "maxBoard",
    "mainSectors",
    "cycleLeader",
    "recognition",
    "poolConsistency",
  ];
  const evidence = { ...comparison.evidence };
  for (const key of poolEvidenceKeys) {
    const current = evidence[key];
    if (!current) continue;
    evidence[key] = {
      ...current,
      status: "failed",
      sampleSize: 0,
      message: unavailableReason,
    };
  }
  return {
    date,
    status: "partial",
    source,
    updatedAt: receivedAt,
    unavailableReason,
    breadth: [],
    metrics: {
      limitUp: null,
      limitDown: null,
      consecutive: null,
      largeRise: null,
      high20: null,
      high120: null,
      allTimeHigh: null,
      marginBalance,
    },
    premium: { openPct: null, closePct: null, sampleSize: 0 },
    ladder: { first: [], second: [], third: [], fourth: [], fivePlus: [] },
    sectors: [],
    leaders: [],
    structure: {
      status: "failed",
      source: "东方财富历史四池",
      message: unavailableReason,
      receivedAt,
    },
    comparison: {
      ...comparison,
      brokenCount: null,
      sealRate: null,
      yesterdaySuccessRate: null,
      yesterdaySuccessSampleSize: 0,
      continuation: null,
      maxBoard: null,
      brokenBoard: { count: null, rate: null, sampleSize: 0, stocks: [] },
      mainSectors: [],
      cycleLeader: null,
      recognition: [],
      evidence,
    },
    historyMeta: { backfilled: true, receivedAt },
  };
}

function mergeEvidenceOnlyBackfill(
  existing: DailyReview,
  backfilled: DailyReview,
): DailyReview {
  const existingIndices = existing.comparison?.indices ?? [];
  const backfilledIndices = backfilled.comparison?.indices ?? [];
  const comparison = existing.comparison
    ? {
      ...existing.comparison,
      indices: existingIndices.length > 0 ? existingIndices : backfilledIndices,
      evidence: {
        ...backfilled.comparison?.evidence,
        ...existing.comparison.evidence,
        ...(existingIndices.length === 0 && backfilled.comparison?.evidence.indices
          ? { indices: backfilled.comparison.evidence.indices }
          : {}),
      },
    }
    : backfilled.comparison;
  return {
    ...existing,
    status: existing.status === "failed" ? "partial" : existing.status,
    source: [...new Set([
      ...existing.source.split(" / ").filter(Boolean),
      ...backfilled.source.split(" / ").filter(Boolean),
    ])].join(" / "),
    updatedAt: backfilled.updatedAt,
    metrics: {
      ...existing.metrics,
      marginBalance: existing.metrics.marginBalance ?? backfilled.metrics.marginBalance,
    },
    comparison,
    historyMeta: existing.historyMeta ?? backfilled.historyMeta,
  };
}

export function mergeBackfilledStructure(
  existing: DailyReview,
  backfilled: DailyReview,
): DailyReview {
  const sources = [...new Set([
    ...existing.source.split(" / ").filter(Boolean),
    ...backfilled.source.split(" / ").filter(Boolean),
  ])].join(" / ");
  const existingComparison = existing.comparison;
  const backfilledComparison = backfilled.comparison;
  const preserveExistingAggregate = (
    key: "largeDownCount" | "marketAmount",
  ) => existingComparison?.[key] !== null && existingComparison?.[key] !== undefined;
  const preserveExistingIndices = Boolean(existingComparison?.indices.length);
  const preserveExistingSectors = Boolean(
    existingComparison?.mainSectors.length
    && existingComparison.evidence?.mainSectors?.status === "complete",
  );
  const comparison = backfilledComparison
    ? {
      ...backfilledComparison,
      largeDownCount: preserveExistingAggregate("largeDownCount")
        ? existingComparison!.largeDownCount
        : backfilledComparison.largeDownCount,
      marketAmount: preserveExistingAggregate("marketAmount")
        ? existingComparison!.marketAmount
        : backfilledComparison.marketAmount,
      marketCoveragePct: preserveExistingAggregate("marketAmount")
        ? existingComparison!.marketCoveragePct
        : backfilledComparison.marketCoveragePct,
      mainSectors: preserveExistingSectors
        ? existingComparison!.mainSectors
        : backfilledComparison.mainSectors,
      indices: preserveExistingIndices
        ? existingComparison!.indices
        : backfilledComparison.indices,
      evidence: {
        ...backfilledComparison.evidence,
        ...(preserveExistingAggregate("largeDownCount") && existingComparison?.evidence?.largeDownCount
          ? { largeDownCount: existingComparison.evidence.largeDownCount }
          : {}),
        ...(preserveExistingAggregate("marketAmount") && existingComparison?.evidence?.marketAmount
          ? { marketAmount: existingComparison.evidence.marketAmount }
          : {}),
        ...(preserveExistingSectors && existingComparison?.evidence?.mainSectors
          ? { mainSectors: existingComparison.evidence.mainSectors }
          : {}),
        ...(preserveExistingIndices && existingComparison?.evidence?.indices
          ? { indices: existingComparison.evidence.indices }
          : {}),
      },
    }
    : existingComparison;
  return {
    ...existing,
    status: existing.status === "failed" ? "partial" : existing.status,
    source: sources,
    updatedAt: backfilled.updatedAt,
    metrics: {
      ...existing.metrics,
      limitUp: backfilled.metrics.limitUp,
      limitDown: backfilled.metrics.limitDown,
      consecutive: backfilled.metrics.consecutive,
      marginBalance: existing.metrics.marginBalance ?? backfilled.metrics.marginBalance,
    },
    ladder: backfilled.ladder,
    sectors: backfilled.sectors,
    leaders: backfilled.leaders,
    structure: backfilled.structure,
    comparison,
    historyMeta: existing.historyMeta ?? backfilled.historyMeta,
  };
}

function parseStoredProgress(value: string | undefined, endDate: string, days: number): StoredProgress | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as StoredProgress;
    if (parsed.endDate !== endDate || parsed.days !== days || !Array.isArray(parsed.dates) || !Array.isArray(parsed.completed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function loadProgress(db: D1Database, endDate: string, days: number, fetcher: typeof fetch): Promise<StoredProgress> {
  const row = await db.prepare("SELECT value FROM bootstrap_state WHERE key = ?").bind(PROGRESS_KEY).first<{ value: string }>();
  const stored = parseStoredProgress(row?.value, endDate, days);
  if (stored) return stored;
  const dates = await fetchRecentTradingDates(endDate, days, fetcher);
  if (dates.length !== days) throw new Error(`history backfill trading dates ${dates.length}/${days}`);
  const dateSet = new Set(dates);
  let existingCompleted: string[] = [];
  try {
    const result = await db.prepare(
      "SELECT trade_date, payload FROM daily_reviews WHERE trade_date BETWEEN ? AND ?",
    ).bind(dates.at(-1), dates[0]).all<{ trade_date: string; payload: string }>();
    existingCompleted = (result.results ?? []).flatMap((item) => {
      if (!dateSet.has(item.trade_date)) return [];
      try {
        const review = JSON.parse(item.payload) as DailyReview;
        const alreadyBackfilled = review.historyMeta?.backfilled === true;
        const verifiedCloseReview = review.status !== "demo"
          && review.structure?.status === "complete"
          && Boolean(review.comparison);
        return alreadyBackfilled || verifiedCloseReview ? [item.trade_date] : [];
      } catch {
        return [];
      }
    });
  } catch {
    existingCompleted = [];
  }
  return { endDate, days, dates, completed: existingCompleted };
}

async function saveProgress(db: D1Database, progress: StoredProgress) {
  await db.prepare(
    "INSERT INTO bootstrap_state (key, value, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
  ).bind(PROGRESS_KEY, JSON.stringify(progress), new Date().toISOString()).run();
}

async function readExistingReview(db: D1Database, date: string): Promise<DailyReview | null> {
  const row = await db.prepare("SELECT payload FROM daily_reviews WHERE trade_date = ?").bind(date).first<{ payload: string }>();
  if (!row?.payload) return null;
  try {
    return JSON.parse(row.payload) as DailyReview;
  } catch {
    return null;
  }
}

async function persistBackfilledReview(db: D1Database, review: DailyReview) {
  await db.prepare(
    "INSERT INTO daily_reviews (trade_date, payload, source, status, updated_at) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(trade_date) DO UPDATE SET payload=excluded.payload, source=excluded.source, " +
    "status=excluded.status, updated_at=excluded.updated_at",
  ).bind(review.date, JSON.stringify(review), review.source, review.status, review.updatedAt).run();
}

function normalizeMarginBalance(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return value > 1_000_000 ? Number((value / 100_000_000).toFixed(2)) : value;
}

export async function runHistoryBackfillBatch({
  db,
  endDate,
  days,
  batchSize = 5,
  fetcher = fetch,
  fuyaoApiKey,
  fuyaoBaseUrl,
}: {
  db: D1Database;
  endDate: string;
  days: number;
  batchSize?: number;
  fetcher?: typeof fetch;
  fuyaoApiKey?: string;
  fuyaoBaseUrl?: string;
}): Promise<HistoryBackfillProgress> {
  const progress = await loadProgress(db, endDate, days, fetcher);
  const completed = new Set(progress.completed);
  const pending = progress.dates.filter((date) => !completed.has(date)).slice(0, Math.max(1, batchSize));
  const provider = createEastmoneyProvider(fetcher);
  const fuyao = fuyaoApiKey
    ? createFuyaoMcpClient({ apiKey: fuyaoApiKey, baseUrl: fuyaoBaseUrl, fetcher })
    : null;
  const fuyaoRecentDates = new Set(progress.dates.slice(0, 30));

  for (let offset = 0; offset < pending.length; offset += 2) {
    const pair = pending.slice(offset, offset + 2);
    const results = await Promise.all(pair.map(async (date) => {
      const existing = await readExistingReview(db, date);
      try {
        const [poolResult, marginBalance, existingIndices, fuyaoPool] = await Promise.all([
          withRetry(
            () => fetchHistoricalBoardPools(date, fetcher),
            { retries: 2, delayMs: 180 },
          ).then((pools) => ({ pools, error: null as string | null }))
            .catch((error) => ({
              pools: null,
              error: error instanceof Error ? error.message : String(error),
            })),
          withRetry(
            () => provider.getMarginBalance(date),
            { retries: 2, delayMs: 180 },
          ).catch(() => null),
          withRetry(
            () => provider.getIndexSnapshots(date),
            { retries: 1, delayMs: 180 },
          ).catch(() => []),
          fuyao && fuyaoRecentDates.has(date)
            ? withRetry(
                () => fuyao.fetchLimitUpPoolSnapshot(date),
                { retries: 1, delayMs: 180 },
              ).catch(() => null)
            : Promise.resolve(null),
        ]);
        const indices = fuyao
          ? mergeVerifiedIndexSnapshots(
            await withRetry(
              () => fuyao.fetchIndexSnapshots(date),
              { retries: 1, delayMs: 180 },
            ).catch(() => []),
            existingIndices,
          )
          : existingIndices;
        const receivedAt = new Date().toISOString();
        let backfilled: DailyReview;
        if (poolResult.pools) {
          const pools: HistoricalBoardPools = fuyaoPool?.items.length
            ? { ...poolResult.pools, limitUp: fuyaoPool.items }
            : poolResult.pools;
          const poolSource = fuyaoPool?.items.length
            ? "扶摇 Fuyao 历史涨停池 / 东方财富炸板、跌停及昨日涨停池"
            : "东方财富历史四池";
          backfilled = buildBackfilledReview(
            date,
            pools,
            normalizeMarginBalance(marginBalance),
            receivedAt,
            indices,
            poolSource,
          );
        } else {
          const unavailableReason =
            `历史四池超出公开源可回溯窗口：${poolResult.error ?? "来源暂不可用"}；` +
            "涨跌停、炸板和连板等字段保持暂缺，不写入伪造零值";
          backfilled = buildEvidenceOnlyBackfilledReview(
            date,
            normalizeMarginBalance(marginBalance),
            receivedAt,
            indices,
            unavailableReason,
          );
        }
        const review = existing
          ? poolResult.pools
            ? mergeBackfilledStructure(existing, backfilled)
            : mergeEvidenceOnlyBackfill(existing, backfilled)
          : backfilled;
        await persistBackfilledReview(db, review);
        return { date, completed: true };
      } catch {
        return { date, completed: false };
      }
    }));
    for (const result of results) if (result.completed) completed.add(result.date);
  }

  const nextProgress = { ...progress, completed: progress.dates.filter((date) => completed.has(date)) };
  await saveProgress(db, nextProgress);
  return {
    target: progress.dates.length,
    completed: nextProgress.completed.length,
    remaining: progress.dates.length - nextProgress.completed.length,
    dates: progress.dates,
  };
}
