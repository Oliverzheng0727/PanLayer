import type { MarketDataProvider } from "../data/provider";
import type { DailyReview } from "../domain/types";
import { withRetry } from "../data/resilience";

export const HISTORY_CONTRIBUTION_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS history_bar_contributions (
    symbol TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    is_st INTEGER NOT NULL,
    first_date TEXT NOT NULL,
    target_date TEXT NOT NULL,
    bars_json TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS history_contribution_progress_idx ON history_bar_contributions(target_date, status)",
];

interface ContributionBar {
  date: string;
  pctChange: number;
  amount: number | null;
}

interface ContributionRow {
  symbol: string;
  name: string;
  is_st: number;
  first_date: string;
  target_date: string;
  bars_json: string;
  source: string;
  status: string;
  updated_at: string;
}

export interface HistoryContributionProgress {
  completed: number;
  target: number;
  failed: number;
  remaining: number;
  coveragePct: number;
  updatedAt: string | null;
}

function parseBars(value: string): ContributionBar[] {
  try {
    const rows = JSON.parse(value) as unknown;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const item = row as Partial<ContributionBar>;
      const pctChange = Number(item.pctChange);
      const amount = item.amount === null || item.amount === undefined ? null : Number(item.amount);
      return typeof item.date === "string"
        && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
        && Number.isFinite(pctChange)
        && (amount === null || Number.isFinite(amount) && amount >= 0)
        ? [{ date: item.date, pctChange, amount }]
        : [];
    });
  } catch {
    return [];
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}

export async function readHistoryContributionProgress(
  db: D1Database,
  targetDate: string,
): Promise<HistoryContributionProgress> {
  void targetDate;
  const [target, completed, failed, latest] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM stocks").first<{ count: number }>(),
    db.prepare(
      "SELECT COUNT(*) AS count FROM history_bar_contributions WHERE status = 'complete'",
    ).first<{ count: number }>(),
    db.prepare(
      "SELECT COUNT(*) AS count FROM history_bar_contributions WHERE status = 'failed'",
    ).first<{ count: number }>(),
    db.prepare(
      "SELECT MAX(updated_at) AS updated_at FROM history_bar_contributions",
    ).first<{ updated_at: string | null }>(),
  ]);
  const targetCount = Number(target?.count ?? 0);
  const completedCount = Number(completed?.count ?? 0);
  return {
    completed: completedCount,
    target: targetCount,
    failed: Number(failed?.count ?? 0),
    remaining: Math.max(0, targetCount - completedCount),
    coveragePct: targetCount > 0
      ? Number((completedCount / targetCount * 100).toFixed(2))
      : 0,
    updatedAt: latest?.updated_at ?? null,
  };
}

export async function runHistoryContributionBatch({
  db,
  provider,
  targetDate,
  backfillDates,
  source,
  batchSize = 48,
  concurrency = 4,
}: {
  db: D1Database;
  provider: Pick<MarketDataProvider, "getAdjustedBars">;
  targetDate: string;
  backfillDates: string[];
  source: string;
  batchSize?: number;
  concurrency?: number;
}): Promise<HistoryContributionProgress> {
  const retryBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  const candidates = await db.prepare(
    `SELECT s.symbol, s.name
       FROM stocks s
       LEFT JOIN history_bar_contributions c ON c.symbol = s.symbol
      WHERE c.symbol IS NULL
         OR c.target_date < ?
         OR (c.status <> 'complete' AND c.updated_at <= ?)
      ORDER BY CASE WHEN c.symbol IS NULL THEN 0 ELSE 1 END, s.symbol
      LIMIT ?`,
  ).bind(targetDate, retryBefore, Math.min(100, Math.max(1, batchSize)))
    .all<{ symbol: string; name: string }>();
  const dateSet = new Set(backfillDates);
  const receivedAt = new Date().toISOString();
  const results = await mapWithConcurrency(
    candidates.results ?? [],
    Math.min(6, Math.max(1, concurrency)),
    async (candidate) => {
      try {
        const allBars = await withRetry(
          () => provider.getAdjustedBars(candidate.symbol),
          { retries: 1, delayMs: 250 },
        );
        const firstDate = allBars.find((bar) => bar.date && bar.close > 0)?.date ?? "";
        const bars: ContributionBar[] = allBars.flatMap((bar) => (
          dateSet.has(bar.date)
          && Number.isFinite(bar.pctChange)
          && (bar.amount === undefined || Number.isFinite(bar.amount) && bar.amount >= 0)
            ? [{
                date: bar.date,
                pctChange: Number(bar.pctChange),
                amount: bar.amount === undefined ? null : Number(bar.amount),
              }]
            : []
        ));
        if (!firstDate || bars.length === 0) throw new Error("历史日K未覆盖目标交易日");
        return {
          ...candidate,
          firstDate,
          bars,
          status: "complete",
          error: "",
        };
      } catch (error) {
        return {
          ...candidate,
          firstDate: "",
          bars: [] as ContributionBar[],
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
  if (results.length > 0) {
    await db.batch(results.map((result) => db.prepare(
      `INSERT INTO history_bar_contributions
        (symbol, name, is_st, first_date, target_date, bars_json, source, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET
         name=excluded.name,
         is_st=excluded.is_st,
         first_date=excluded.first_date,
         target_date=excluded.target_date,
         bars_json=excluded.bars_json,
         source=excluded.source,
         status=excluded.status,
         updated_at=excluded.updated_at`,
    ).bind(
      result.symbol,
      result.name,
      /(?:\*?ST|退)/i.test(result.name) ? 1 : 0,
      result.firstDate,
      targetDate,
      JSON.stringify(result.bars),
      result.error ? `${source} · ${result.error.slice(0, 180)}` : source,
      result.status,
      receivedAt,
    )));
  }
  return readHistoryContributionProgress(db, targetDate);
}

function fieldState(
  status: "complete" | "pending",
  source: string,
  coveragePct: number,
  verifiedAt: string,
  reason: string | null,
) {
  return { status, source, coveragePct, reason, verifiedAt } as const;
}

export async function patchHistoricalReviewsFromContributions({
  db,
  targetDate,
  minimumCoveragePct = 95,
}: {
  db: D1Database;
  targetDate: string;
  minimumCoveragePct?: number;
}): Promise<{ patched: number; dates: number; contributionCoveragePct: number }> {
  const progress = await readHistoryContributionProgress(db, targetDate);
  if (progress.coveragePct < minimumCoveragePct) {
    return { patched: 0, dates: 0, contributionCoveragePct: progress.coveragePct };
  }
  const [contributions, reviews] = await Promise.all([
    db.prepare(
      `SELECT symbol, name, is_st, first_date, target_date, bars_json, source, status, updated_at
         FROM history_bar_contributions
        WHERE status = 'complete'`,
    ).all<ContributionRow>(),
    db.prepare(
      "SELECT trade_date, payload FROM daily_reviews WHERE trade_date <= ? ORDER BY trade_date DESC LIMIT 120",
    ).bind(targetDate).all<{ trade_date: string; payload: string }>(),
  ]);
  const rows = (contributions.results ?? []).map((row) => ({
    ...row,
    bars: new Map(parseBars(row.bars_json).map((bar) => [bar.date, bar])),
  }));
  const statements: D1PreparedStatement[] = [];
  const verifiedAt = new Date().toISOString();
  for (const stored of reviews.results ?? []) {
    let review: DailyReview;
    try {
      review = JSON.parse(stored.payload) as DailyReview;
    } catch {
      continue;
    }
    const eligibleNonST = rows.filter((row) => !row.is_st && row.first_date && row.first_date <= stored.trade_date);
    const validNonST = eligibleNonST.flatMap((row) => {
      const bar = row.bars.get(stored.trade_date);
      return bar && Number.isFinite(bar.pctChange) ? [bar] : [];
    });
    const breadthCoverage = eligibleNonST.length > 0
      ? Number((validNonST.length / eligibleNonST.length * 100).toFixed(2))
      : 0;
    const eligibleAll = rows.filter((row) => row.first_date && row.first_date <= stored.trade_date);
    const validAmount = eligibleAll.flatMap((row) => {
      const bar = row.bars.get(stored.trade_date);
      return bar?.amount !== null && bar?.amount !== undefined && Number.isFinite(bar.amount)
        ? [bar.amount]
        : [];
    });
    const amountCoverage = eligibleAll.length > 0
      ? Number((validAmount.length / eligibleAll.length * 100).toFixed(2))
      : 0;
    const breadthReady = breadthCoverage >= minimumCoveragePct;
    const amountReady = amountCoverage >= minimumCoveragePct;
    if (!breadthReady && !amountReady) continue;
    const breadth15 = breadthReady
      ? {
          time: "15:00",
          rising: validNonST.filter((bar) => bar.pctChange > 0).length,
          falling: validNonST.filter((bar) => bar.pctChange < 0).length,
          flat: validNonST.filter((bar) => bar.pctChange === 0).length,
        }
      : null;
    const breadthByTime = new Map(review.breadth.map((item) => [item.time, item]));
    if (breadth15 && !breadthByTime.has("15:00")) breadthByTime.set("15:00", breadth15);
    const historyMeta = review.historyMeta ?? { backfilled: true, receivedAt: verifiedAt };
    const patched: DailyReview = {
      ...review,
      breadth: [...breadthByTime.values()].toSorted((left, right) => left.time.localeCompare(right.time)),
      comparison: review.comparison
        ? {
            ...review.comparison,
            marketAmount: amountReady
              ? Number((validAmount.reduce((sum, value) => sum + value, 0) / 100_000_000).toFixed(2))
              : review.comparison.marketAmount,
            marketCoveragePct: amountReady ? amountCoverage : review.comparison.marketCoveragePct,
            evidence: {
              ...review.comparison.evidence,
              ...(amountReady ? {
                marketAmount: {
                  source: "全市场历史前复权日K成交额聚合",
                  formula: "沪深京全A（含ST）有效成交额之和",
                  marketTime: `${stored.trade_date}T15:00:00+08:00`,
                  receivedAt: verifiedAt,
                  sampleSize: validAmount.length,
                  coveragePct: amountCoverage,
                  status: "complete",
                  message: `历史成交额覆盖率 ${amountCoverage}%`,
                },
              } : {}),
            },
          }
        : review.comparison,
      historyMeta: {
        ...historyMeta,
        schemaVersion: 2,
        receivedAt: verifiedAt,
        fields: {
          ...historyMeta.fields,
          breadth: fieldState(
            breadthReady ? "complete" : "pending",
            "全市场历史前复权日K聚合",
            breadthCoverage,
            verifiedAt,
            breadthReady ? null : "非ST日K覆盖率未达到95%",
          ),
          marketAmount: fieldState(
            amountReady ? "complete" : "pending",
            "全市场历史前复权日K成交额聚合",
            amountCoverage,
            verifiedAt,
            amountReady ? null : "含ST全A成交额覆盖率未达到95%",
          ),
        },
      },
    };
    statements.push(db.prepare(
      "UPDATE daily_reviews SET payload = ?, updated_at = ? WHERE trade_date = ?",
    ).bind(JSON.stringify(patched), verifiedAt, stored.trade_date));
  }
  for (let offset = 0; offset < statements.length; offset += 100) {
    await db.batch(statements.slice(offset, offset + 100));
  }
  return {
    patched: statements.length,
    dates: reviews.results?.length ?? 0,
    contributionCoveragePct: progress.coveragePct,
  };
}
