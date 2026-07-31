import type { MarketDataProvider } from "../data/provider";
import type { DailyReview, Quote } from "../domain/types";
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
  `CREATE TABLE IF NOT EXISTS history_contribution_failures (
    symbol TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL,
    next_retry_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS history_contribution_retry_idx ON history_contribution_failures(next_retry_at, attempts)",
  `CREATE TABLE IF NOT EXISTS history_daily_contributions (
    trade_date TEXT NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    is_st INTEGER NOT NULL,
    pct_change REAL NOT NULL,
    amount REAL,
    source TEXT NOT NULL,
    received_at TEXT NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY (trade_date, symbol)
  )`,
  "CREATE INDEX IF NOT EXISTS history_daily_contribution_date_idx ON history_daily_contributions(trade_date, status, received_at)",
  `CREATE TABLE IF NOT EXISTS history_daily_contribution_meta (
    trade_date TEXT PRIMARY KEY,
    expected_count INTEGER NOT NULL,
    valid_count INTEGER NOT NULL,
    non_st_count INTEGER NOT NULL,
    coverage_pct REAL NOT NULL,
    source TEXT NOT NULL,
    market_time TEXT,
    received_at TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT ''
  )`,
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

interface DailyContributionRow {
  trade_date: string;
  symbol: string;
  name: string;
  is_st: number;
  pct_change: number;
  amount: number | null;
  source: string;
  received_at: string;
  status: string;
}

interface DailyContributionMetaRow {
  trade_date: string;
  expected_count: number;
  valid_count: number;
  non_st_count: number;
  coverage_pct: number;
  source: string;
  market_time: string | null;
  received_at: string;
  status: string;
  message: string;
}

export interface HistoryContributionProgress {
  /** Reusable contribution rows; this baseline does not reset each trade day. */
  completed: number;
  target: number;
  /** Rows refreshed through targetDate. */
  dailyCompleted: number;
  dailyRemaining: number;
  dailyCoveragePct: number;
  /** True once the immutable close snapshot reaches the accepted coverage threshold. */
  dailyComplete: boolean;
  failed: number;
  /** Remaining rows in the reusable historical baseline. */
  remaining: number;
  coveragePct: number;
  updatedAt: string | null;
  nextRetryAt?: string | null;
  batchAttempted?: number;
  batchSucceeded?: number;
  targetDate: string;
  dailySource?: string | null;
}

export interface DailyHistoryContributionResult {
  targetDate: string;
  expectedCount: number;
  validCount: number;
  nonSTCount: number;
  coveragePct: number;
  status: "complete" | "partial" | "failed";
  source: string;
  marketTime: string | null;
  receivedAt: string;
  message: string;
}

export interface HistoryContributionProvider {
  getAdjustedBars(symbol: string): Promise<Awaited<ReturnType<MarketDataProvider["getAdjustedBars"]>>>;
  getAdjustedBarsForRange?(
    symbol: string,
    startDate: string,
    endDate: string,
  ): Promise<Awaited<ReturnType<MarketDataProvider["getAdjustedBars"]>>>;
}

export function historyContributionRetryDelayMinutes(attempts: number): number {
  const delays = [15, 60, 360, 1_440];
  return delays[Math.min(Math.max(0, Math.trunc(attempts) - 1), delays.length - 1)];
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

export function mergeContributionBars(
  existing: ContributionBar[],
  incoming: ContributionBar[],
  backfillDates: string[],
): ContributionBar[] {
  const allowed = new Set(backfillDates);
  const merged = new Map<string, ContributionBar>();
  for (const bar of [...existing, ...incoming]) {
    if (
      !allowed.has(bar.date)
      || !Number.isFinite(bar.pctChange)
      || (bar.amount !== null && (!Number.isFinite(bar.amount) || bar.amount < 0))
    ) {
      continue;
    }
    merged.set(bar.date, {
      date: bar.date,
      pctChange: Number(bar.pctChange),
      amount: bar.amount === null ? null : Number(bar.amount),
    });
  }
  return [...merged.values()]
    .toSorted((left, right) => left.date.localeCompare(right.date))
    .slice(-Math.min(120, backfillDates.length));
}

export async function readDailyHistoryContributionMeta(
  db: D1Database,
  targetDate: string,
): Promise<DailyHistoryContributionResult | null> {
  const row = await db.prepare(
    `SELECT trade_date, expected_count, valid_count, non_st_count, coverage_pct,
            source, market_time, received_at, status, message
       FROM history_daily_contribution_meta
      WHERE trade_date = ?`,
  ).bind(targetDate).first<DailyContributionMetaRow>();
  if (!row) return null;
  return {
    targetDate: row.trade_date,
    expectedCount: Number(row.expected_count),
    validCount: Number(row.valid_count),
    nonSTCount: Number(row.non_st_count),
    coveragePct: Number(row.coverage_pct),
    status: row.status === "complete"
      ? "complete"
      : row.status === "partial"
        ? "partial"
        : "failed",
    source: row.source,
    marketTime: row.market_time,
    receivedAt: row.received_at,
    message: row.message,
  };
}

export async function persistDailyHistoryContributions({
  db,
  targetDate,
  quotes,
  source,
  marketTime,
  upstreamStatus = "complete",
  receivedAt = new Date().toISOString(),
  minimumCoveragePct = 95,
}: {
  db: D1Database;
  targetDate: string;
  quotes: Quote[];
  source: string;
  marketTime: string | null;
  upstreamStatus?: "complete" | "partial" | "failed";
  receivedAt?: string;
  minimumCoveragePct?: number;
}): Promise<DailyHistoryContributionResult> {
  const [currentUniverse, existingComplete] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM stocks").first<{ count: number }>(),
    readDailyHistoryContributionMeta(db, targetDate),
  ]);
  // A completed daily snapshot is immutable. This prevents a later forced or
  // degraded rerun from partially overwriting the rows referenced by its meta.
  if (existingComplete?.status === "complete") return existingComplete;
  const unique = new Map<string, Quote>();
  for (const quote of quotes) {
    if (
      !quote.symbol
      || !Number.isFinite(quote.pctChange)
      || !Number.isFinite(quote.amount)
      || quote.amount < 0
    ) {
      continue;
    }
    unique.set(quote.symbol, quote);
  }
  const rows = [...unique.values()];
  const expectedCount = Math.max(Number(currentUniverse?.count ?? 0), rows.length);
  const coveragePct = expectedCount > 0
    ? Number((rows.length / expectedCount * 100).toFixed(2))
    : 0;
  const status: DailyHistoryContributionResult["status"] = upstreamStatus === "failed"
    ? "failed"
    : coveragePct >= minimumCoveragePct && upstreamStatus === "complete"
    ? "complete"
    : rows.length > 0
      ? "partial"
      : "failed";
  // json_each keeps a 5k-stock snapshot to a handful of D1 statements instead
  // of one statement per row, staying safely below per-invocation query limits.
  const rowsPerStatement = 1_000;
  for (let offset = 0; offset < rows.length; offset += rowsPerStatement) {
    const payload = rows.slice(offset, offset + rowsPerStatement).map((quote) => ({
      symbol: quote.symbol,
      name: quote.name,
      isST: quote.isST ? 1 : 0,
      pctChange: Number(quote.pctChange),
      amount: Number(quote.amount),
    }));
    await db.prepare(
      `INSERT INTO history_daily_contributions
        (trade_date, symbol, name, is_st, pct_change, amount, source, received_at, status)
       SELECT ?,
              CAST(json_extract(value, '$.symbol') AS TEXT),
              CAST(json_extract(value, '$.name') AS TEXT),
              CAST(json_extract(value, '$.isST') AS INTEGER),
              CAST(json_extract(value, '$.pctChange') AS REAL),
              CAST(json_extract(value, '$.amount') AS REAL),
              ?, ?, 'complete'
         FROM json_each(?)
        WHERE true
       ON CONFLICT(trade_date, symbol) DO UPDATE SET
         name=excluded.name,
         is_st=excluded.is_st,
         pct_change=excluded.pct_change,
         amount=excluded.amount,
         source=excluded.source,
         received_at=excluded.received_at,
         status=excluded.status`,
    ).bind(targetDate, source, receivedAt, JSON.stringify(payload)).run();
  }
  const nonSTCount = rows.filter((quote) => !quote.isST).length;
  const message = status === "complete"
    ? `收盘快照增量 ${rows.length}/${expectedCount}，无需逐股重拉历史K线`
    : `收盘快照覆盖 ${rows.length}/${expectedCount}（${coveragePct}%）${
      upstreamStatus !== "complete" ? `；上游核验状态 ${upstreamStatus}` : ""
    }`;
  await db.prepare(
    `INSERT INTO history_daily_contribution_meta
      (trade_date, expected_count, valid_count, non_st_count, coverage_pct,
       source, market_time, received_at, status, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(trade_date) DO UPDATE SET
       expected_count=excluded.expected_count,
       valid_count=excluded.valid_count,
       non_st_count=excluded.non_st_count,
       coverage_pct=excluded.coverage_pct,
       source=excluded.source,
       market_time=excluded.market_time,
       received_at=excluded.received_at,
       status=excluded.status,
       message=excluded.message`,
  ).bind(
    targetDate,
    expectedCount,
    rows.length,
    nonSTCount,
    coveragePct,
    source,
    marketTime,
    receivedAt,
    status,
    message,
  ).run();
  return {
    targetDate,
    expectedCount,
    validCount: rows.length,
    nonSTCount,
    coveragePct,
    status,
    source,
    marketTime,
    receivedAt,
    message,
  };
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
  const [target, completed, daily, failed, latest, nextRetry, dailyMeta] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM stocks").first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS count
         FROM history_bar_contributions c
         JOIN stocks s ON s.symbol = c.symbol
        WHERE c.status = 'complete'`,
    ).first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(DISTINCT symbol) AS count
         FROM (
           SELECT c.symbol AS symbol
             FROM history_bar_contributions c
             JOIN stocks s ON s.symbol = c.symbol
            WHERE c.status = 'complete' AND c.target_date >= ?
           UNION ALL
           SELECT d.symbol AS symbol
             FROM history_daily_contributions d
             JOIN history_daily_contribution_meta m
               ON m.trade_date = d.trade_date
              AND m.received_at = d.received_at
             JOIN stocks s ON s.symbol = d.symbol
            WHERE d.trade_date = ? AND d.status = 'complete'
         )`,
    ).bind(targetDate, targetDate).first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS count
         FROM history_contribution_failures f
         JOIN stocks s ON s.symbol = f.symbol
         LEFT JOIN history_bar_contributions c ON c.symbol = f.symbol
        WHERE c.symbol IS NULL OR c.status <> 'complete'`,
    ).first<{ count: number }>(),
    db.prepare(
      `SELECT MAX(updated_at) AS updated_at FROM (
        SELECT updated_at FROM history_bar_contributions
        UNION ALL
        SELECT updated_at FROM history_contribution_failures
        UNION ALL
        SELECT received_at AS updated_at FROM history_daily_contribution_meta
      )`,
    ).first<{ updated_at: string | null }>(),
    db.prepare(
      `SELECT MIN(f.next_retry_at) AS next_retry_at
         FROM history_contribution_failures f
         LEFT JOIN history_bar_contributions c ON c.symbol = f.symbol
        WHERE c.symbol IS NULL OR c.status <> 'complete'`,
    ).first<{ next_retry_at: string | null }>(),
    readDailyHistoryContributionMeta(db, targetDate),
  ]);
  const targetCount = Number(target?.count ?? 0);
  const completedCount = Number(completed?.count ?? 0);
  const dailyCompleted = Number(daily?.count ?? 0);
  const dailyCoveragePct = dailyMeta
    ? Number(dailyMeta.coveragePct)
    : targetCount > 0
      ? Number((dailyCompleted / targetCount * 100).toFixed(2))
      : 0;
  const dailyComplete = dailyMeta?.status === "complete" && dailyCoveragePct >= 95;
  return {
    completed: completedCount,
    target: targetCount,
    dailyCompleted,
    dailyRemaining: Math.max(0, targetCount - dailyCompleted),
    dailyCoveragePct,
    dailyComplete,
    failed: Number(failed?.count ?? 0),
    remaining: Math.max(0, targetCount - completedCount),
    coveragePct: targetCount > 0
      ? Number((completedCount / targetCount * 100).toFixed(2))
      : 0,
    updatedAt: latest?.updated_at ?? null,
    nextRetryAt: nextRetry?.next_retry_at ?? null,
    targetDate,
    dailySource: dailyMeta?.source ?? null,
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
  provider: HistoryContributionProvider;
  targetDate: string;
  backfillDates: string[];
  source: string;
  batchSize?: number;
  concurrency?: number;
}): Promise<HistoryContributionProgress> {
  const nowIso = new Date().toISOString();
  const dailyMeta = await readDailyHistoryContributionMeta(db, targetDate);
  const dailySnapshotReady = dailyMeta?.status === "complete"
    && dailyMeta.coveragePct >= 95;
  if (dailySnapshotReady) {
    await db.prepare(
      `DELETE FROM history_contribution_failures
        WHERE symbol IN (
          SELECT symbol FROM history_bar_contributions WHERE status = 'complete'
        )`,
    ).run();
  }
  const candidates = await db.prepare(
    `SELECT s.symbol, s.name,
            c.first_date, c.target_date, c.bars_json, c.status AS contribution_status,
            c.updated_at AS contribution_updated_at,
            f.updated_at AS failure_updated_at,
            COALESCE(f.attempts, 0) AS failure_attempts
       FROM stocks s
       LEFT JOIN history_bar_contributions c ON c.symbol = s.symbol
       LEFT JOIN history_contribution_failures f ON f.symbol = s.symbol
      WHERE (
        c.symbol IS NULL
        OR (? = 0 AND c.target_date < ?)
        OR c.status <> 'complete'
      )
        AND (f.symbol IS NULL OR f.next_retry_at <= ?)
      ORDER BY CASE WHEN c.symbol IS NULL THEN 0 ELSE 1 END,
        COALESCE(c.target_date, '') ASC,
        CASE
          WHEN f.updated_at IS NULL AND c.updated_at IS NULL THEN 0
          ELSE 1
        END,
        COALESCE(f.updated_at, c.updated_at, '') ASC,
        COALESCE(f.attempts, 0),
        s.symbol
      LIMIT ?`,
  ).bind(
    dailySnapshotReady ? 1 : 0,
    targetDate,
    nowIso,
    Math.min(48, Math.max(1, batchSize)),
  ).all<{
    symbol: string;
    name: string;
    first_date: string | null;
    target_date: string | null;
    bars_json: string | null;
    contribution_status: string | null;
    contribution_updated_at: string | null;
    failure_updated_at: string | null;
    failure_attempts: number;
  }>();
  const dateSet = new Set(backfillDates);
  const receivedAt = new Date().toISOString();
  const results = await mapWithConcurrency(
    candidates.results ?? [],
    Math.min(6, Math.max(1, concurrency)),
    async (candidate) => {
      try {
        const existingBars = parseBars(candidate.bars_json ?? "[]");
        const bootstrap = !candidate.first_date || existingBars.length === 0;
        const lastCachedDate = existingBars.at(-1)?.date
          ?? backfillDates.at(0)
          ?? targetDate;
        const allBars = bootstrap || !provider.getAdjustedBarsForRange
          ? await withRetry(
              () => provider.getAdjustedBars(candidate.symbol),
              { retries: 1, delayMs: 250 },
            )
          : await provider.getAdjustedBarsForRange(
              candidate.symbol,
              lastCachedDate,
              targetDate,
            );
        const firstDate = candidate.first_date
          ?? allBars.find((bar) => bar.date && bar.close > 0)?.date
          ?? "";
        const incoming: ContributionBar[] = allBars.flatMap((bar) => (
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
        const targetBar = incoming.find((bar) => bar.date === targetDate);
        if (!bootstrap && !targetBar) {
          throw new Error("增量日K未覆盖目标交易日");
        }
        const bars = mergeContributionBars(existingBars, incoming, backfillDates);
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
  const statements: D1PreparedStatement[] = [];
  for (const result of results) {
    if (result.status === "complete") {
      statements.push(
        db.prepare(
          `INSERT INTO history_bar_contributions
            (symbol, name, is_st, first_date, target_date, bars_json, source, status, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'complete', ?)
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
          source,
          receivedAt,
        ),
        db.prepare("DELETE FROM history_contribution_failures WHERE symbol = ?").bind(result.symbol),
      );
      continue;
    }
    const attempts = Number(result.failure_attempts ?? 0) + 1;
    const nextRetryAt = new Date(
      Date.now() + historyContributionRetryDelayMinutes(attempts) * 60_000,
    ).toISOString();
    statements.push(db.prepare(
      `INSERT INTO history_contribution_failures
        (symbol, attempts, last_error, next_retry_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET
         attempts=excluded.attempts,
         last_error=excluded.last_error,
         next_retry_at=excluded.next_retry_at,
         updated_at=excluded.updated_at`,
    ).bind(
      result.symbol,
      attempts,
      result.error.replace(/\s+/g, " ").slice(0, 500),
      nextRetryAt,
      receivedAt,
    ));
  }
  for (let offset = 0; offset < statements.length; offset += 100) {
    await db.batch(statements.slice(offset, offset + 100));
  }
  const progress = await readHistoryContributionProgress(db, targetDate);
  return {
    ...progress,
    batchAttempted: results.length,
    batchSucceeded: results.filter((result) => result.status === "complete").length,
  };
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
  reviewDates,
}: {
  db: D1Database;
  targetDate: string;
  minimumCoveragePct?: number;
  reviewDates?: string[];
}): Promise<{ patched: number; dates: number; contributionCoveragePct: number }> {
  const progress = await readHistoryContributionProgress(db, targetDate);
  const dailyMeta = await readDailyHistoryContributionMeta(db, targetDate);
  if (
    progress.coveragePct < minimumCoveragePct
    && !(dailyMeta?.status === "complete" && dailyMeta.coveragePct >= minimumCoveragePct)
  ) {
    return { patched: 0, dates: 0, contributionCoveragePct: progress.coveragePct };
  }
  const normalizedReviewDates = [...new Set((reviewDates ?? []).filter((date) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= targetDate
  ))];
  const reviewQuery = normalizedReviewDates.length > 0
    ? `SELECT trade_date, payload FROM daily_reviews
        WHERE trade_date IN (${normalizedReviewDates.map(() => "?").join(", ")})
        ORDER BY trade_date DESC`
    : "SELECT trade_date, payload FROM daily_reviews WHERE trade_date <= ? ORDER BY trade_date DESC LIMIT 120";
  const reviewBindings = normalizedReviewDates.length > 0 ? normalizedReviewDates : [targetDate];
  const dailyDateClause = normalizedReviewDates.length > 0
    ? `IN (${normalizedReviewDates.map(() => "?").join(", ")})`
    : `IN (
        SELECT trade_date FROM daily_reviews
         WHERE trade_date <= ?
         ORDER BY trade_date DESC
         LIMIT 120
      )`;
  const dailyBindings = normalizedReviewDates.length > 0 ? normalizedReviewDates : [targetDate];
  const dailyOnly = normalizedReviewDates.length === 1
    && normalizedReviewDates[0] === targetDate
    && dailyMeta?.status === "complete"
    && dailyMeta.coveragePct >= minimumCoveragePct;
  const [contributions, reviews, dailyContributions, dailyMetadata] = await Promise.all([
    dailyOnly
      ? Promise.resolve({ results: [] as ContributionRow[] })
      : db.prepare(
          `SELECT symbol, name, is_st, first_date, target_date, bars_json, source, status, updated_at
             FROM history_bar_contributions
            WHERE status = 'complete'`,
        ).all<ContributionRow>(),
    db.prepare(reviewQuery).bind(...reviewBindings)
      .all<{ trade_date: string; payload: string }>(),
    db.prepare(
      `SELECT trade_date, symbol, name, is_st, pct_change, amount,
              source, received_at, status
         FROM history_daily_contributions
        WHERE trade_date ${dailyDateClause}
          AND status = 'complete'
        ORDER BY trade_date DESC`,
    ).bind(...dailyBindings).all<DailyContributionRow>(),
    db.prepare(
      `SELECT trade_date, expected_count, valid_count, non_st_count, coverage_pct,
              source, market_time, received_at, status, message
         FROM history_daily_contribution_meta
        WHERE trade_date ${dailyDateClause}
        ORDER BY trade_date DESC`,
    ).bind(...dailyBindings).all<DailyContributionMetaRow>(),
  ]);
  const rows = (contributions.results ?? []).map((row) => ({
    ...row,
    bars: new Map(parseBars(row.bars_json).map((bar) => [bar.date, bar])),
  }));
  const dailyMetaByDate = new Map(
    (dailyMetadata.results ?? []).map((row) => [row.trade_date, row]),
  );
  const dailyByDate = new Map<string, DailyContributionRow[]>();
  for (const row of dailyContributions.results ?? []) {
    const meta = dailyMetaByDate.get(row.trade_date);
    if (!meta || meta.received_at !== row.received_at) continue;
    dailyByDate.set(row.trade_date, [...(dailyByDate.get(row.trade_date) ?? []), row]);
  }
  const hasStUniverse = rows.some((row) => Boolean(row.is_st));
  const statements: D1PreparedStatement[] = [];
  const verifiedAt = new Date().toISOString();
  for (const stored of reviews.results ?? []) {
    let review: DailyReview;
    try {
      review = JSON.parse(stored.payload) as DailyReview;
    } catch {
      continue;
    }
    const dailyRows = dailyByDate.get(stored.trade_date) ?? [];
    const storedDailyMeta = dailyMetaByDate.get(stored.trade_date);
    const dailyReady = storedDailyMeta?.status === "complete"
      && Number(storedDailyMeta.coverage_pct) >= minimumCoveragePct
      && dailyRows.length > 0;
    const eligibleNonST = dailyReady
      ? dailyRows.filter((row) => !row.is_st)
      : rows.filter((row) => !row.is_st && row.first_date && row.first_date <= stored.trade_date);
    const validNonST = dailyReady
      ? eligibleNonST.flatMap((row) => Number.isFinite(row.pct_change)
          ? [{ date: stored.trade_date, pctChange: row.pct_change, amount: row.amount }]
          : [])
      : eligibleNonST.flatMap((row) => {
          const bar = "bars" in row ? row.bars.get(stored.trade_date) : null;
          return bar && Number.isFinite(bar.pctChange) ? [bar] : [];
        });
    const breadthCoverage = dailyReady
      ? Number(storedDailyMeta!.coverage_pct)
      : eligibleNonST.length > 0
        ? Math.min(
            progress.coveragePct,
            Number((validNonST.length / eligibleNonST.length * 100).toFixed(2)),
          )
        : 0;
    const eligibleAll = dailyReady
      ? dailyRows
      : rows.filter((row) => row.first_date && row.first_date <= stored.trade_date);
    const validAmount = dailyReady
      ? dailyRows.flatMap((row) => row.amount !== null && Number.isFinite(row.amount)
          ? [row.amount]
          : [])
      : eligibleAll.flatMap((row) => {
          const bar = "bars" in row ? row.bars.get(stored.trade_date) : null;
          return bar?.amount !== null && bar?.amount !== undefined && Number.isFinite(bar.amount)
            ? [bar.amount]
            : [];
        });
    const amountCoverage = dailyReady
      ? Number(storedDailyMeta!.coverage_pct)
      : eligibleAll.length > 0
        ? Math.min(
            progress.coveragePct,
            Number((validAmount.length / eligibleAll.length * 100).toFixed(2)),
          )
        : 0;
    const breadthReady = breadthCoverage >= minimumCoveragePct;
    const amountReady = (dailyReady || hasStUniverse) && amountCoverage >= minimumCoveragePct;
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
                  source: dailyReady
                    ? `${storedDailyMeta!.source}收盘快照`
                    : "全市场历史前复权日K成交额聚合",
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
            dailyReady
              ? `${storedDailyMeta!.source}收盘快照`
              : "全市场历史前复权日K聚合",
            breadthCoverage,
            verifiedAt,
            breadthReady ? null : "非ST日K覆盖率未达到95%",
          ),
          marketAmount: fieldState(
            amountReady ? "complete" : "pending",
            dailyReady
              ? `${storedDailyMeta!.source}收盘快照`
              : "全市场历史前复权日K成交额聚合",
            amountCoverage,
            verifiedAt,
            amountReady
              ? null
              : hasStUniverse
                ? "含ST全A成交额覆盖率未达到95%"
                : "股票主数据尚未覆盖ST，不能按含ST全A口径回写",
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
