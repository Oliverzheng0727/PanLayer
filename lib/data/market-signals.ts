import type { StructuredMarketSignals } from "../domain/types";

export const STRUCTURED_MARKET_SIGNALS_SCHEMA_STATEMENT =
  "CREATE TABLE IF NOT EXISTS structured_market_signals (" +
  "trade_date TEXT NOT NULL, dataset TEXT NOT NULL, provider TEXT NOT NULL, " +
  "payload TEXT NOT NULL, status TEXT NOT NULL, market_time TEXT, received_at TEXT NOT NULL, " +
  "PRIMARY KEY (trade_date, dataset, provider))";

export async function persistStructuredMarketSignals(
  db: D1Database,
  signals: StructuredMarketSignals,
): Promise<void> {
  await db.prepare(
    `INSERT INTO structured_market_signals
      (trade_date, dataset, provider, payload, status, market_time, received_at)
     VALUES (?, 'close-signals', ?, ?, ?, ?, ?)
     ON CONFLICT(trade_date, dataset, provider) DO UPDATE SET
       payload=excluded.payload,
       status=excluded.status,
       market_time=excluded.market_time,
       received_at=excluded.received_at`,
  ).bind(
    signals.referenceDate,
    signals.provider,
    JSON.stringify(signals),
    signals.status,
    signals.marketTime,
    signals.receivedAt,
  ).run();
}

function isStructuredMarketSignals(value: unknown): value is StructuredMarketSignals {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StructuredMarketSignals>;
  return item.schemaVersion === 1
    && item.provider === "扶摇 Fuyao"
    && typeof item.referenceDate === "string"
    && Array.isArray(item.hotStocks)
    && Array.isArray(item.skyrocket)
    && Array.isArray(item.dragonTiger)
    && Array.isArray(item.anomalies)
    && Array.isArray(item.sectors)
    && Boolean(item.evidence && typeof item.evidence === "object");
}

export async function readStructuredMarketSignals(
  db: D1Database,
  date: string,
): Promise<StructuredMarketSignals | null> {
  const row = await db.prepare(
    `SELECT payload
       FROM structured_market_signals
      WHERE trade_date = ? AND dataset = 'close-signals' AND provider = '扶摇 Fuyao'
      LIMIT 1`,
  ).bind(date).first<{ payload: string }>();
  if (!row?.payload) return null;
  try {
    const parsed = JSON.parse(row.payload) as unknown;
    return isStructuredMarketSignals(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
