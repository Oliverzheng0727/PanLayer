import type { NewHighState } from "./new-high-engine";
import { applyDailyQuoteToNewHighState } from "./new-high-engine";
import type { HighDetail } from "./high-details";
import type { NewHighStateStore } from "./new-high-pipeline";
import type { DailyReview } from "../domain/types";

export interface PersistedNewHighProgressSnapshot {
  targetDate: string;
  /** Stocks with a reusable historical baseline. This value never resets at a new trade date. */
  completed: number;
  currentCursor: number;
  target: number;
  /** Stocks whose state has also been advanced through targetDate. */
  dailyCompleted: number;
  /** States that genuinely need a full-history rebuild. */
  rebuildPending: number;
  failed: number;
  updatedAt: string;
}

const NEW_HIGH_PROGRESS_KEY = "new-high-progress-snapshot";
const NEW_HIGH_PROGRESS_V2_MIGRATION_KEY = "new-high-progress-v2-migrated";

export interface D1DailyNewHighRefreshBatchInput {
  db: D1Database;
  targetDate: string;
  /** The D1 worker budget is protected even if a caller supplies a larger value. */
  batchSize?: number;
  minimumCoveragePct?: number;
}

export interface D1DailyNewHighRefreshBatchResult {
  targetDate: string;
  target: number;
  dailyCompleted: number;
  dailyCoveragePct: number;
  remaining: number;
  /** Rows consumed by this invocation, including rows moved to the rebuild queue. */
  processed: number;
  /** New-high detail rows written by this invocation. */
  details: number;
  /** Stale or invalid states moved to the full-history rebuild queue. */
  rebuild: number;
  high20: number | null;
  high120: number | null;
  allTimeHigh: number | null;
  status: "complete" | "partial" | "failed";
  error: string | null;
}

interface DailyNewHighContributionRow {
  trade_date: string;
  symbol: string;
  contribution_name: string;
  pct_change: number;
  amount: number | null;
}

export interface NewHighStateRow {
  symbol: string;
  name: string;
  sector: string;
  last_date: string;
  last_close: number;
  closes_json: string;
  all_time_high: number;
  all_time_high_date: string;
  first_close: number;
  initialized_through: string;
}

export function applyNewHighCountsToReview(
  review: DailyReview,
  counts: { high20: number; high120: number; allTimeHigh: number },
): DailyReview {
  return {
    ...review,
    metrics: {
      ...review.metrics,
      ...counts,
    },
  };
}

export function encodeNewHighState(_state: NewHighState): NewHighStateRow {
  return {
    symbol: _state.symbol,
    name: _state.name,
    sector: _state.sector,
    last_date: _state.lastDate,
    last_close: _state.lastClose,
    closes_json: JSON.stringify(_state.closes),
    all_time_high: _state.allTimeHigh,
    all_time_high_date: _state.allTimeHighDate,
    first_close: _state.firstClose,
    initialized_through: _state.initializedThrough,
  };
}

export function decodeNewHighStateRow(_row: NewHighStateRow): NewHighState {
  let closes: unknown = [];
  try {
    closes = JSON.parse(_row.closes_json);
  } catch {
    closes = [];
  }
  return {
    symbol: _row.symbol,
    name: _row.name,
    sector: _row.sector,
    lastDate: _row.last_date,
    lastClose: Number(_row.last_close),
    closes: Array.isArray(closes)
      ? closes.map(Number).filter((value) => Number.isFinite(value) && value > 0)
      : [],
    allTimeHigh: Number(_row.all_time_high),
    allTimeHighDate: _row.all_time_high_date,
    firstClose: Number(_row.first_close),
    initializedThrough: _row.initialized_through,
  };
}

const STATE_UPSERT =
  "INSERT INTO new_high_states " +
  "(symbol, name, sector, last_date, last_close, closes_json, all_time_high, all_time_high_date, first_close, initialized_through, status, updated_at) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?) " +
  "ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, sector=excluded.sector, last_date=excluded.last_date, " +
  "last_close=excluded.last_close, closes_json=excluded.closes_json, all_time_high=excluded.all_time_high, " +
  "all_time_high_date=excluded.all_time_high_date, first_close=excluded.first_close, " +
  "initialized_through=excluded.initialized_through, status='active', updated_at=excluded.updated_at";

const DETAIL_UPSERT =
  "INSERT INTO new_high_details " +
  "(trade_date, type, symbol, name, sector, pct_change, close, high_price, amount, interval_pct, high_date, is_all_time) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
  "ON CONFLICT(trade_date, type, symbol) DO UPDATE SET name=excluded.name, sector=excluded.sector, " +
  "pct_change=excluded.pct_change, close=excluded.close, high_price=excluded.high_price, amount=excluded.amount, " +
  "interval_pct=excluded.interval_pct, high_date=excluded.high_date, is_all_time=excluded.is_all_time";

function stateStatement(db: D1Database, state: NewHighState) {
  const row = encodeNewHighState(state);
  return db.prepare(STATE_UPSERT).bind(
    row.symbol,
    row.name,
    row.sector,
    row.last_date,
    row.last_close,
    row.closes_json,
    row.all_time_high,
    row.all_time_high_date,
    row.first_close,
    row.initialized_through,
    new Date().toISOString(),
  );
}

function detailStatement(db: D1Database, detail: HighDetail) {
  return db.prepare(DETAIL_UPSERT).bind(
    detail.date,
    detail.type,
    detail.symbol,
    detail.name,
    detail.sector,
    detail.pctChange,
    detail.close,
    detail.highPrice,
    detail.amount,
    detail.intervalPct,
    detail.highDate,
    detail.isAllTime ? 1 : 0,
  );
}

async function runStatements(db: D1Database, statements: D1PreparedStatement[]) {
  for (let offset = 0; offset < statements.length; offset += 100) {
    await db.batch(statements.slice(offset, offset + 100));
  }
}

export function createD1NewHighStateStore(db: D1Database): NewHighStateStore {
  return {
    async listBootstrapCandidates(targetDate, limit) {
      const result = await db.prepare(
        "SELECT s.symbol, s.name, s.sector FROM stocks s " +
        "LEFT JOIN new_high_states h ON h.symbol = s.symbol " +
        "LEFT JOIN new_high_bootstrap_failures f ON f.symbol = s.symbol " +
        "WHERE UPPER(s.name) NOT LIKE '%ST%' AND " +
        "(h.symbol IS NULL OR h.status = 'rebuild') " +
        "AND (f.symbol IS NULL OR f.next_retry_at <= ?) " +
        "ORDER BY CASE WHEN f.symbol IS NULL THEN 0 ELSE 1 END, " +
        "CASE WHEN h.status = 'rebuild' THEN 0 ELSE 1 END, COALESCE(f.attempts, 0), s.symbol LIMIT ?",
      ).bind(new Date().toISOString(), limit).all<{ symbol: string; name: string; sector: string }>();
      return (result.results ?? []).map((row) => ({
        symbol: String(row.symbol),
        name: String(row.name),
        sector: String(row.sector || "未分类"),
      }));
    },

    async listBackfillDates(targetDate) {
      const result = await db.prepare(
        "SELECT trade_date FROM daily_reviews WHERE trade_date <= ? ORDER BY trade_date DESC LIMIT 120",
      ).bind(targetDate).all<{ trade_date: string }>();
      return (result.results ?? []).map((row) => String(row.trade_date));
    },

    async saveInitialization(state, details) {
      const statements: D1PreparedStatement[] = [
        db.prepare(
          "DELETE FROM new_high_details WHERE symbol = ? AND trade_date IN " +
          "(SELECT trade_date FROM daily_reviews WHERE trade_date <= ? ORDER BY trade_date DESC LIMIT 120)",
        ).bind(state.symbol, state.initializedThrough),
        stateStatement(db, state),
        ...details.map((detail) => detailStatement(db, detail)),
      ];
      await runStatements(db, statements);
    },

    async recordBootstrapFailure(symbol, message) {
      const previous = await db.prepare(
        "SELECT attempts FROM new_high_bootstrap_failures WHERE symbol = ?",
      ).bind(symbol).first<{ attempts: number }>();
      const attempts = Number(previous?.attempts ?? 0) + 1;
      const delays = [15, 60, 360, 1_440];
      const delayMinutes = delays[Math.min(attempts - 1, delays.length - 1)];
      const nextRetryAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
      const sanitized = message.replace(/\s+/g, " ").slice(0, 500);
      await db.prepare(
        `INSERT INTO new_high_bootstrap_failures
          (symbol, attempts, last_error, next_retry_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET attempts=excluded.attempts,
          last_error=excluded.last_error, next_retry_at=excluded.next_retry_at,
          updated_at=excluded.updated_at`,
      ).bind(symbol, attempts, sanitized, nextRetryAt, new Date().toISOString()).run();
    },

    async clearBootstrapFailure(symbol) {
      await db.prepare("DELETE FROM new_high_bootstrap_failures WHERE symbol = ?").bind(symbol).run();
    },

    async progress(targetDate) {
      const [target, completed] = await Promise.all([
        db.prepare("SELECT COUNT(*) AS count FROM stocks WHERE UPPER(name) NOT LIKE '%ST%'").first<{ count: number }>(),
        db.prepare(
          "SELECT COUNT(*) AS count FROM new_high_states WHERE status = 'active' AND initialized_through >= ?",
        ).bind(targetDate).first<{ count: number }>(),
      ]);
      return {
        completed: Number(completed?.count ?? 0),
        target: Number(target?.count ?? 0),
      };
    },

    async loadStates(symbols) {
      const rows: NewHighStateRow[] = [];
      for (let offset = 0; offset < symbols.length; offset += 300) {
        const chunk = symbols.slice(offset, offset + 300);
        if (chunk.length === 0) continue;
        const placeholders = chunk.map(() => "?").join(",");
        const result = await db.prepare(
          `SELECT symbol, name, sector, last_date, last_close, closes_json, all_time_high, all_time_high_date, first_close, initialized_through FROM new_high_states WHERE status = 'active' AND symbol IN (${placeholders})`,
        ).bind(...chunk).all<NewHighStateRow>();
        rows.push(...(result.results ?? []));
      }
      return rows.map(decodeNewHighStateRow);
    },

    async saveDaily(states, details, rebuildSymbols) {
      const detailsBySymbol = new Map<string, HighDetail[]>();
      details.forEach((detail) => {
        detailsBySymbol.set(
          detail.symbol,
          [...(detailsBySymbol.get(detail.symbol) ?? []), detail],
        );
      });
      const statements: D1PreparedStatement[] = [];
      for (const state of states) {
        statements.push(
          db.prepare("DELETE FROM new_high_details WHERE trade_date = ? AND symbol = ?")
            .bind(state.lastDate, state.symbol),
          stateStatement(db, state),
          ...(detailsBySymbol.get(state.symbol) ?? []).map((detail) => detailStatement(db, detail)),
        );
      }
      for (const symbol of rebuildSymbols) {
        statements.push(
          db.prepare("UPDATE new_high_states SET status = 'rebuild', updated_at = ? WHERE symbol = ?")
            .bind(new Date().toISOString(), symbol),
        );
      }
      await runStatements(db, statements);
    },

    async countDetails(date) {
      const result = await db.prepare(
        "SELECT type, COUNT(*) AS count FROM new_high_details WHERE trade_date = ? GROUP BY type",
      ).bind(date).all<{ type: string; count: number }>();
      const counts = new Map((result.results ?? []).map((row) => [String(row.type), Number(row.count)]));
      return {
        high20: counts.get("20d") ?? 0,
        high120: counts.get("120d") ?? 0,
        allTimeHigh: counts.get("all-time") ?? 0,
      };
    },
  };
}

function dailyNewHighTargetStatement(db: D1Database) {
  return db.prepare(
    "SELECT COUNT(*) AS count FROM stocks WHERE UPPER(name) NOT LIKE '%ST%'",
  );
}

function dailyNewHighCompletedStatement(db: D1Database, targetDate: string) {
  return db.prepare(
    `SELECT COUNT(*) AS count
       FROM stocks s
       JOIN new_high_states h ON h.symbol = s.symbol
      WHERE UPPER(s.name) NOT LIKE '%ST%'
        AND h.status = 'active'
        AND h.last_date >= ?`,
  ).bind(targetDate);
}

function dailyNewHighCoverage(completed: number, target: number) {
  return target > 0 ? Number((completed / target * 100).toFixed(2)) : 0;
}

function dailyNewHighResult(input: {
  targetDate: string;
  target: number;
  dailyCompleted: number;
  processed?: number;
  details?: number;
  rebuild?: number;
  minimumCoveragePct: number;
  counts?: { high20: number; high120: number; allTimeHigh: number };
  status?: "complete" | "partial" | "failed";
  error?: string | null;
}): D1DailyNewHighRefreshBatchResult {
  const dailyCoveragePct = dailyNewHighCoverage(input.dailyCompleted, input.target);
  const publishable = dailyCoveragePct >= input.minimumCoveragePct && Boolean(input.counts);
  return {
    targetDate: input.targetDate,
    target: input.target,
    dailyCompleted: input.dailyCompleted,
    dailyCoveragePct,
    remaining: Math.max(0, input.target - input.dailyCompleted),
    processed: input.processed ?? 0,
    details: input.details ?? 0,
    rebuild: input.rebuild ?? 0,
    high20: publishable ? input.counts!.high20 : null,
    high120: publishable ? input.counts!.high120 : null,
    allTimeHigh: publishable ? input.counts!.allTimeHigh : null,
    status: input.status ?? (publishable ? "complete" : "partial"),
    error: input.error ?? null,
  };
}

function dailyQuoteForContribution(
  state: NewHighState,
  row: DailyNewHighContributionRow,
) {
  const previousClose = Number(state.lastClose);
  const pctChange = Number(row.pct_change);
  const amount = Number(row.amount);
  if (
    row.amount === null
    || row.amount === undefined
    || !Number.isFinite(previousClose)
    || previousClose <= 0
    || !Number.isFinite(pctChange)
    || pctChange <= -100
    || !Number.isFinite(amount)
    || amount < 0
  ) return null;
  const price = previousClose * (1 + pctChange / 100);
  if (!Number.isFinite(price) || price <= 0) return null;
  const suffix = state.symbol.toUpperCase().split(".").at(-1);
  const exchange = suffix === "BJ" ? "BJ" : suffix === "SZ" ? "SZ" : "SH";
  const code = state.symbol.split(".")[0];
  const board = exchange === "BJ"
    ? "BEIJING"
    : exchange === "SZ" && /^(300|301)/.test(code)
      ? "CHINEXT"
      : exchange === "SH" && /^(688|689)/.test(code)
        ? "STAR"
        : "MAIN";
  return {
    symbol: state.symbol,
    name: row.contribution_name || state.name,
    exchange,
    board,
    isST: false,
    isNoLimitDay: false,
    previousClose,
    open: price,
    price,
    high: price,
    low: price,
    pctChange,
    amount,
    turnoverRate: null,
    limitUpPrice: 0,
    limitDownPrice: 0,
    sector: state.sector || "未分类",
    firstLimitTime: null,
    limitStreak: 0,
    listingDate: null,
    marketTime: row.trade_date,
  } as const;
}

/**
 * Advances at most 200 normalized new-high states through every immutable close
 * snapshot after each state's own last date. Snapshots store pct_change rather
 * than close, so adjusted closes are reconstructed sequentially from the
 * state's previous adjusted close. A missing intermediate day rebuilds only
 * that symbol. All writes for a batch are issued together and are idempotent by
 * date + symbol.
 */
async function runD1DailyNewHighRefreshBatchInternal({
  db,
  targetDate,
  batchSize = 200,
  minimumCoveragePct = 95,
}: D1DailyNewHighRefreshBatchInput): Promise<D1DailyNewHighRefreshBatchResult> {
  const boundedBatchSize = Math.min(200, Math.max(1, Math.floor(batchSize)));
  const coverageThreshold = Math.min(100, Math.max(1, minimumCoveragePct));
  const [targetRow, completedRow, metadata] = await Promise.all([
    dailyNewHighTargetStatement(db).first<{ count: number }>(),
    dailyNewHighCompletedStatement(db, targetDate).first<{ count: number }>(),
    db.prepare(
      `SELECT expected_count, valid_count, non_st_count, coverage_pct,
              source, received_at, status
         FROM history_daily_contribution_meta
        WHERE trade_date = ?
        ORDER BY received_at DESC
        LIMIT 1`,
    ).bind(targetDate).first<{
      expected_count: number;
      valid_count: number;
      non_st_count: number;
      coverage_pct: number;
      source: string;
      received_at: string;
      status: string;
    }>(),
  ]);
  const target = Number(targetRow?.count ?? 0);
  const initialCompleted = Number(completedRow?.count ?? 0);
  if (target <= 0) {
    return dailyNewHighResult({
      targetDate,
      target,
      dailyCompleted: initialCompleted,
      minimumCoveragePct: coverageThreshold,
      status: "failed",
      error: "new-high universe is empty",
    });
  }
  if (!metadata?.received_at || metadata.status !== "complete") {
    return dailyNewHighResult({
      targetDate,
      target,
      dailyCompleted: initialCompleted,
      minimumCoveragePct: coverageThreshold,
      status: "failed",
      error: metadata
        ? `daily contribution snapshot is ${metadata.status}`
        : "daily contribution snapshot is missing",
    });
  }

  const candidates = await db.prepare(
    `SELECT h.symbol, h.name, h.sector, h.last_date, h.last_close,
            h.closes_json, h.all_time_high, h.all_time_high_date,
            h.first_close, h.initialized_through
       FROM new_high_states h
       JOIN stocks s ON s.symbol = h.symbol
      WHERE UPPER(s.name) NOT LIKE '%ST%'
        AND h.status = 'active'
        AND h.last_date < ?
      ORDER BY h.symbol
      LIMIT ?`,
  ).bind(targetDate, boundedBatchSize).all<NewHighStateRow>();
  const candidateRows = candidates.results ?? [];
  if (candidateRows.length === 0) {
    const counts = initialCompleted >= target * coverageThreshold / 100
      ? await createD1NewHighStateStore(db).countDetails(targetDate)
      : undefined;
    return dailyNewHighResult({
      targetDate,
      target,
      dailyCompleted: initialCompleted,
      minimumCoveragePct: coverageThreshold,
      counts,
      status: counts ? "complete" : "partial",
      error: counts ? null : "no eligible daily contribution rows remain",
    });
  }

  const oldestCandidateDate = candidateRows
    .map((row) => row.last_date)
    .toSorted()
    .at(0)!;
  const expectedDateRows = await db.prepare(
    `SELECT trade_date
       FROM daily_reviews
      WHERE trade_date > ? AND trade_date <= ?
      ORDER BY trade_date`,
  ).bind(oldestCandidateDate, targetDate).all<{ trade_date: string }>();
  const expectedDates = (expectedDateRows.results ?? []).map((row) => String(row.trade_date));
  const candidateSymbols = candidateRows.map((row) => row.symbol);
  const contributionRows = await db.prepare(
    `SELECT d.trade_date, d.symbol, d.name AS contribution_name,
            d.pct_change, d.amount
       FROM history_daily_contributions d
       JOIN history_daily_contribution_meta m
         ON m.trade_date = d.trade_date
        AND m.received_at = d.received_at
        AND m.status = 'complete'
      WHERE d.symbol IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        AND d.trade_date > ?
        AND d.trade_date <= ?
        AND d.status = 'complete'
        AND d.is_st = 0
      ORDER BY d.symbol, d.trade_date`,
  ).bind(
    JSON.stringify(candidateSymbols),
    oldestCandidateDate,
    targetDate,
  ).all<DailyNewHighContributionRow>();
  const contributionsBySymbol = new Map<string, Map<string, DailyNewHighContributionRow>>();
  for (const row of contributionRows.results ?? []) {
    const byDate = contributionsBySymbol.get(row.symbol) ?? new Map();
    byDate.set(row.trade_date, row);
    contributionsBySymbol.set(row.symbol, byDate);
  }

  const updatedStates: NewHighState[] = [];
  const details: HighDetail[] = [];
  const rebuildSymbols: string[] = [];
  const processedWindows: Array<{ symbol: string; afterDate: string }> = [];
  for (const row of candidateRows) {
    const stateExpectedDates = expectedDates.filter((date) => date > row.last_date);
    const byDate = contributionsBySymbol.get(row.symbol);
    let state = decodeNewHighStateRow(row);
    const stateDetails: HighDetail[] = [];
    let requiresRebuild = stateExpectedDates.length === 0;
    for (const tradeDate of stateExpectedDates) {
      const contribution = byDate?.get(tradeDate);
      if (!contribution) {
        requiresRebuild = true;
        break;
      }
      const quote = dailyQuoteForContribution(state, contribution);
      if (!quote) {
        requiresRebuild = true;
        break;
      }
      const result = applyDailyQuoteToNewHighState(state, quote, tradeDate);
      if (result.status !== "updated") {
        requiresRebuild = true;
        break;
      }
      state = result.state;
      stateDetails.push(...result.details);
    }
    if (requiresRebuild || state.lastDate !== targetDate) {
      rebuildSymbols.push(row.symbol);
      continue;
    }
    updatedStates.push(state);
    details.push(...stateDetails);
    processedWindows.push({ symbol: row.symbol, afterDate: row.last_date });
  }

  const updatedAt = new Date().toISOString();
  const statePayload = updatedStates.map((state) => ({
    ...encodeNewHighState(state),
    updated_at: updatedAt,
  }));
  const detailPayload = details.map((detail) => ({
    trade_date: detail.date,
    type: detail.type,
    symbol: detail.symbol,
    name: detail.name,
    sector: detail.sector,
    pct_change: detail.pctChange,
    close: detail.close,
    high_price: detail.highPrice,
    amount: detail.amount,
    interval_pct: detail.intervalPct,
    high_date: detail.highDate,
    is_all_time: detail.isAllTime ? 1 : 0,
  }));
  if (processedWindows.length > 0 || rebuildSymbols.length > 0) {
    const detailChunks: Array<typeof detailPayload> = [];
    for (let offset = 0; offset < detailPayload.length; offset += 750) {
      detailChunks.push(detailPayload.slice(offset, offset + 750));
    }
    await db.batch([
      db.prepare(
        `DELETE FROM new_high_details
          WHERE trade_date <= ?
            AND EXISTS (
              SELECT 1
                FROM json_each(?) AS batch_item
               WHERE CAST(json_extract(batch_item.value, '$.symbol') AS TEXT) = new_high_details.symbol
                 AND new_high_details.trade_date > CAST(json_extract(batch_item.value, '$.afterDate') AS TEXT)
            )`,
      ).bind(targetDate, JSON.stringify(processedWindows)),
      db.prepare(
        `INSERT INTO new_high_states
          (symbol, name, sector, last_date, last_close, closes_json,
           all_time_high, all_time_high_date, first_close,
           initialized_through, status, updated_at)
         SELECT CAST(json_extract(value, '$.symbol') AS TEXT),
                CAST(json_extract(value, '$.name') AS TEXT),
                CAST(json_extract(value, '$.sector') AS TEXT),
                CAST(json_extract(value, '$.last_date') AS TEXT),
                CAST(json_extract(value, '$.last_close') AS REAL),
                CAST(json_extract(value, '$.closes_json') AS TEXT),
                CAST(json_extract(value, '$.all_time_high') AS REAL),
                CAST(json_extract(value, '$.all_time_high_date') AS TEXT),
                CAST(json_extract(value, '$.first_close') AS REAL),
                CAST(json_extract(value, '$.initialized_through') AS TEXT),
                'active',
                CAST(json_extract(value, '$.updated_at') AS TEXT)
           FROM json_each(?)
          WHERE true
         ON CONFLICT(symbol) DO UPDATE SET
           name=excluded.name, sector=excluded.sector,
           last_date=excluded.last_date, last_close=excluded.last_close,
           closes_json=excluded.closes_json,
           all_time_high=excluded.all_time_high,
           all_time_high_date=excluded.all_time_high_date,
           first_close=excluded.first_close,
           initialized_through=excluded.initialized_through,
           status='active', updated_at=excluded.updated_at`,
      ).bind(JSON.stringify(statePayload)),
      ...detailChunks.map((chunk) => db.prepare(
        `INSERT INTO new_high_details
          (trade_date, type, symbol, name, sector, pct_change, close,
           high_price, amount, interval_pct, high_date, is_all_time)
         SELECT CAST(json_extract(value, '$.trade_date') AS TEXT),
                CAST(json_extract(value, '$.type') AS TEXT),
                CAST(json_extract(value, '$.symbol') AS TEXT),
                CAST(json_extract(value, '$.name') AS TEXT),
                CAST(json_extract(value, '$.sector') AS TEXT),
                CAST(json_extract(value, '$.pct_change') AS REAL),
                CAST(json_extract(value, '$.close') AS REAL),
                CAST(json_extract(value, '$.high_price') AS REAL),
                CAST(json_extract(value, '$.amount') AS REAL),
                CAST(json_extract(value, '$.interval_pct') AS REAL),
                CAST(json_extract(value, '$.high_date') AS TEXT),
                CAST(json_extract(value, '$.is_all_time') AS INTEGER)
           FROM json_each(?)
          WHERE true
         ON CONFLICT(trade_date, type, symbol) DO UPDATE SET
           name=excluded.name, sector=excluded.sector,
           pct_change=excluded.pct_change, close=excluded.close,
           high_price=excluded.high_price, amount=excluded.amount,
           interval_pct=excluded.interval_pct,
           high_date=excluded.high_date, is_all_time=excluded.is_all_time`,
      ).bind(JSON.stringify(chunk))),
      db.prepare(
        `UPDATE new_high_states
            SET status = 'rebuild', updated_at = ?
          WHERE symbol IN (SELECT CAST(value AS TEXT) FROM json_each(?))`,
      ).bind(updatedAt, JSON.stringify(rebuildSymbols)),
    ]);
  }

  const finalCompletedRow = await dailyNewHighCompletedStatement(db, targetDate)
    .first<{ count: number }>();
  const dailyCompleted = Number(finalCompletedRow?.count ?? initialCompleted + updatedStates.length);
  const complete = dailyNewHighCoverage(dailyCompleted, target) >= coverageThreshold;
  const counts = complete
    ? await createD1NewHighStateStore(db).countDetails(targetDate)
    : undefined;
  const processed = updatedStates.length + rebuildSymbols.length;
  const noProgress = processed === 0 && dailyCompleted < target;
  return dailyNewHighResult({
    targetDate,
    target,
    dailyCompleted,
    processed,
    details: details.length,
    rebuild: rebuildSymbols.length,
    minimumCoveragePct: coverageThreshold,
    counts,
    status: complete ? "complete" : "partial",
    error: noProgress ? "no eligible daily contribution rows remain" : null,
  });
}

export async function runD1DailyNewHighRefreshBatch(
  input: D1DailyNewHighRefreshBatchInput,
): Promise<D1DailyNewHighRefreshBatchResult> {
  try {
    return await runD1DailyNewHighRefreshBatchInternal(input);
  } catch (error) {
    let target = 0;
    let dailyCompleted = 0;
    try {
      const [targetRow, completedRow] = await Promise.all([
        dailyNewHighTargetStatement(input.db).first<{ count: number }>(),
        dailyNewHighCompletedStatement(input.db, input.targetDate).first<{ count: number }>(),
      ]);
      target = Number(targetRow?.count ?? 0);
      dailyCompleted = Number(completedRow?.count ?? 0);
    } catch {
      // The original error is the actionable failure; health queries are best effort.
    }
    return dailyNewHighResult({
      targetDate: input.targetDate,
      target,
      dailyCompleted,
      minimumCoveragePct: Math.min(100, Math.max(1, input.minimumCoveragePct ?? 95)),
      status: "failed",
      error: (error instanceof Error ? error.message : String(error))
        .replace(/\s+/g, " ")
        .slice(0, 500),
    });
  }
}

export async function newHighBootstrapTargetDate(
  db: D1Database,
  currentDate: string,
): Promise<string> {
  const row = await db.prepare(
    "SELECT MAX(trade_date) AS trade_date FROM daily_reviews WHERE trade_date <= ?",
  ).bind(currentDate).first<{ trade_date: string | null }>();
  if (row?.trade_date) return row.trade_date;
  const fallback = new Date(`${currentDate}T12:00:00Z`);
  fallback.setUTCDate(fallback.getUTCDate() - 1);
  return fallback.toISOString().slice(0, 10);
}

async function ensureNewHighProgressV2Migration(db: D1Database) {
  const migrated = await db.prepare(
    "SELECT value FROM bootstrap_state WHERE key = ?",
  ).bind(NEW_HIGH_PROGRESS_V2_MIGRATION_KEY).first<{ value: string }>();
  if (migrated?.value === "complete") return;

  const updatedAt = new Date().toISOString();
  // The former 120-day scope upgrade marked every healthy state as `rebuild`.
  // Those rows still contain a valid historical baseline. Reactivate them once;
  // a genuinely stale row will be marked for rebuild again by the daily engine.
  await db.prepare(
    `UPDATE new_high_states
        SET status = 'active', updated_at = ?
      WHERE status = 'rebuild'
        AND last_date IS NOT NULL AND last_date <> ''
        AND closes_json IS NOT NULL AND closes_json <> '[]'`,
  ).bind(updatedAt).run();
  await db.prepare(
    `INSERT INTO bootstrap_state (key, value, updated_at) VALUES (?, 'complete', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  ).bind(NEW_HIGH_PROGRESS_V2_MIGRATION_KEY, updatedAt).run();
}

export async function refreshNewHighProgressSnapshot(
  db: D1Database,
  currentDate: string,
): Promise<PersistedNewHighProgressSnapshot> {
  await ensureNewHighProgressV2Migration(db);
  const targetDate = await newHighBootstrapTargetDate(db, currentDate);
  const [target, baseline, daily, rebuild, failed] = await Promise.all([
    db.prepare(
      "SELECT COUNT(*) AS count FROM stocks WHERE UPPER(name) NOT LIKE '%ST%'",
    ).first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS count
         FROM stocks s
         JOIN new_high_states h ON h.symbol = s.symbol
        WHERE UPPER(s.name) NOT LIKE '%ST%'
          AND h.last_date IS NOT NULL AND h.last_date <> ''
          AND h.closes_json IS NOT NULL AND h.closes_json <> '[]'`,
    ).first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS count
         FROM stocks s
         JOIN new_high_states h ON h.symbol = s.symbol
        WHERE UPPER(s.name) NOT LIKE '%ST%'
          AND h.status = 'active' AND h.last_date >= ?`,
    ).bind(targetDate).first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS count
         FROM stocks s
         JOIN new_high_states h ON h.symbol = s.symbol
        WHERE UPPER(s.name) NOT LIKE '%ST%' AND h.status = 'rebuild'`,
    ).first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS count
         FROM new_high_bootstrap_failures f
         JOIN stocks s ON s.symbol = f.symbol
         LEFT JOIN new_high_states h ON h.symbol = f.symbol
        WHERE UPPER(s.name) NOT LIKE '%ST%'
          AND (h.symbol IS NULL OR h.status = 'rebuild')`,
    ).first<{ count: number }>(),
  ]);
  const completedCount = Number(baseline?.count ?? 0);
  const updatedAt = new Date().toISOString();
  const snapshot: PersistedNewHighProgressSnapshot = {
    targetDate,
    completed: completedCount,
    currentCursor: completedCount,
    target: Number(target?.count ?? 0),
    dailyCompleted: Number(daily?.count ?? 0),
    rebuildPending: Number(rebuild?.count ?? 0),
    failed: Number(failed?.count ?? 0),
    updatedAt,
  };
  await db.prepare(
    `INSERT INTO bootstrap_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  ).bind(NEW_HIGH_PROGRESS_KEY, JSON.stringify(snapshot), updatedAt).run();
  return snapshot;
}

export async function readNewHighProgressSnapshot(
  db: D1Database,
  currentDate: string,
): Promise<PersistedNewHighProgressSnapshot> {
  const targetDate = await newHighBootstrapTargetDate(db, currentDate);
  const row = await db.prepare(
    "SELECT value FROM bootstrap_state WHERE key = ?",
  ).bind(NEW_HIGH_PROGRESS_KEY).first<{ value: string }>();
  if (row?.value) {
    try {
      const snapshot = JSON.parse(row.value) as PersistedNewHighProgressSnapshot;
      if (
        snapshot.targetDate === targetDate
        && Number.isFinite(snapshot.completed)
        && Number.isFinite(snapshot.target)
        && Number.isFinite(snapshot.dailyCompleted)
        && Number.isFinite(snapshot.rebuildPending)
        && Number.isFinite(snapshot.failed)
      ) return snapshot;
    } catch {
      // Rebuild malformed or stale snapshots from normalized state.
    }
  }
  return refreshNewHighProgressSnapshot(db, currentDate);
}

export async function patchBackfilledReviewHighCounts(
  db: D1Database,
  targetDate: string,
  options: { coveragePct?: number } = {},
): Promise<number> {
  const coveragePct = Number.isFinite(options.coveragePct)
    ? Math.min(100, Math.max(0, Number(options.coveragePct)))
    : 100;
  const rows = await db.prepare(
    "SELECT trade_date, payload FROM daily_reviews WHERE trade_date <= ? ORDER BY trade_date DESC LIMIT 120",
  ).bind(targetDate).all<{ trade_date: string; payload: string }>();
  const statements: D1PreparedStatement[] = [];
  for (const row of rows.results ?? []) {
    let review: DailyReview;
    try {
      review = JSON.parse(row.payload) as DailyReview;
    } catch {
      continue;
    }
    const counts = await createD1NewHighStateStore(db).countDetails(row.trade_date);
    const verifiedAt = new Date().toISOString();
    const highPatched = applyNewHighCountsToReview(review, counts);
    const patched: DailyReview = {
      ...highPatched,
      historyMeta: {
        ...(highPatched.historyMeta ?? { backfilled: true, receivedAt: verifiedAt }),
        schemaVersion: 2,
        receivedAt: verifiedAt,
        fields: {
          ...highPatched.historyMeta?.fields,
          newHighs: {
            status: "complete",
            source: "全市场前复权日K新高状态",
            coveragePct,
            reason: null,
            verifiedAt,
          },
        },
      },
    };
    statements.push(
      db.prepare(
        "UPDATE daily_reviews SET payload = ?, updated_at = ? WHERE trade_date = ?",
      ).bind(JSON.stringify(patched), new Date().toISOString(), row.trade_date),
    );
  }
  await runStatements(db, statements);
  return statements.length;
}
