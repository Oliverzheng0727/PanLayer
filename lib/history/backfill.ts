import { createEastmoneyProvider } from "../data/eastmoney";
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

const PROGRESS_KEY = "history-backfill-v4-structure-repair";

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
): DailyReview {
  const validPools = withoutStBoardPools(pools);
  const limitUps = validPools.limitUp.map(poolItemToQuote);
  const sectors = buildBackfillSectors(validPools.limitUp);
  return {
    date,
    status: "partial",
    source: "历史回补 · 东方财富涨跌停池 / 新浪交易日历",
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
      source: "东方财富历史四池",
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
      source: "东方财富历史涨跌停池",
      receivedAt,
    }),
    historyMeta: { backfilled: true, receivedAt },
  };
}

export function mergeBackfilledStructure(
  existing: DailyReview,
  backfilled: DailyReview,
): DailyReview {
  const sources = [...new Set([
    ...existing.source.split(" / ").filter(Boolean),
    "东方财富历史四池",
  ])].join(" / ");
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
    comparison: backfilled.comparison,
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
  return { endDate, days, dates, completed: [] };
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

function hasCompleteStructureEvidence(review: DailyReview | null): boolean {
  const comparison = review?.comparison;
  if (!review || review.structure?.status !== "complete" || !comparison) return false;
  const requiredEvidence = ["brokenCount", "sealRate", "yesterdaySuccessRate", "continuation", "brokenBoard", "maxBoard", "cycleLeader", "recognition"];
  return requiredEvidence.every((key) => {
    const item = comparison.evidence?.[key];
    return Boolean(item && item.status !== "failed");
  })
    && Array.isArray(review.ladder?.first)
    && Array.isArray(review.sectors)
    && Array.isArray(review.leaders);
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
}: {
  db: D1Database;
  endDate: string;
  days: number;
  batchSize?: number;
  fetcher?: typeof fetch;
}): Promise<HistoryBackfillProgress> {
  const progress = await loadProgress(db, endDate, days, fetcher);
  const completed = new Set(progress.completed);
  const pending = progress.dates.filter((date) => !completed.has(date)).slice(0, Math.max(1, batchSize));
  const provider = createEastmoneyProvider(fetcher);

  for (let offset = 0; offset < pending.length; offset += 2) {
    const pair = pending.slice(offset, offset + 2);
    const results = await Promise.all(pair.map(async (date) => {
      const existing = await readExistingReview(db, date);
      // Older records may have been marked structurally complete before the
      // historical comparison payload existed. Re-run those dates once; a
      // fully evidenced record remains idempotently skipped.
      if (hasCompleteStructureEvidence(existing)) return { date, completed: true };
      try {
        const [pools, marginBalance, indices] = await Promise.all([
          fetchHistoricalBoardPools(date, fetcher),
          provider.getMarginBalance(date).catch(() => null),
          provider.getIndexSnapshots(date).catch(() => []),
        ]);
        const receivedAt = new Date().toISOString();
        const backfilled = buildBackfilledReview(date, pools, normalizeMarginBalance(marginBalance), receivedAt, indices);
        const review = existing ? mergeBackfilledStructure(existing, backfilled) : backfilled;
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
