import type { NewHighState } from "./new-high-engine";
import type { HighDetail } from "./high-details";
import type { NewHighStateStore } from "./new-high-pipeline";
import type { DailyReview } from "../domain/types";

export interface PersistedNewHighProgressSnapshot {
  targetDate: string;
  completed: number;
  currentCursor: number;
  target: number;
  failed: number;
  updatedAt: string;
}

const NEW_HIGH_PROGRESS_KEY = "new-high-progress-snapshot";

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
        "(h.symbol IS NULL OR h.status = 'rebuild' OR h.initialized_through < ?) " +
        "AND (f.symbol IS NULL OR f.next_retry_at <= ?) " +
        "ORDER BY CASE WHEN f.symbol IS NULL THEN 0 ELSE 1 END, " +
        "CASE WHEN h.status = 'rebuild' THEN 0 ELSE 1 END, COALESCE(f.attempts, 0), s.symbol LIMIT ?",
      ).bind(targetDate, new Date().toISOString(), limit).all<{ symbol: string; name: string; sector: string }>();
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
      const delays = [15, 60, 360];
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

export async function refreshNewHighProgressSnapshot(
  db: D1Database,
  currentDate: string,
): Promise<PersistedNewHighProgressSnapshot> {
  const targetDate = await newHighBootstrapTargetDate(db, currentDate);
  const [target, completed, failed] = await Promise.all([
    db.prepare(
      "SELECT COUNT(*) AS count FROM stocks WHERE UPPER(name) NOT LIKE '%ST%'",
    ).first<{ count: number }>(),
    db.prepare(
      "SELECT COUNT(*) AS count FROM new_high_states WHERE status = 'active' AND initialized_through >= ?",
    ).bind(targetDate).first<{ count: number }>(),
    db.prepare(
      "SELECT COUNT(*) AS count FROM new_high_bootstrap_failures",
    ).first<{ count: number }>(),
  ]);
  const completedCount = Number(completed?.count ?? 0);
  const updatedAt = new Date().toISOString();
  const snapshot: PersistedNewHighProgressSnapshot = {
    targetDate,
    completed: completedCount,
    currentCursor: completedCount,
    target: Number(target?.count ?? 0),
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
): Promise<number> {
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
    const patched = applyNewHighCountsToReview(review, counts);
    statements.push(
      db.prepare(
        "UPDATE daily_reviews SET payload = ?, updated_at = ? WHERE trade_date = ?",
      ).bind(JSON.stringify(patched), new Date().toISOString(), row.trade_date),
    );
  }
  await runStatements(db, statements);
  return statements.length;
}
