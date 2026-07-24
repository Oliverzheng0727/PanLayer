import type { EtfSnapshot } from "../data/provider";
import { normalizeAverageAmount20 } from "./derived-metrics";

export interface PersistedEtfCatalogSnapshot {
  tradeDate: string;
  items: EtfSnapshot[];
  source: string;
  status: "complete" | "partial";
  receivedAt: string;
}

function validItem(value: unknown): value is EtfSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<EtfSnapshot>;
  return typeof item.symbol === "string"
    && /^\d{6}$/.test(item.symbol)
    && typeof item.name === "string"
    && item.name.length > 0
    && typeof item.price === "number"
    && Number.isFinite(item.price)
    && item.price > 0;
}

export async function saveEtfCatalogSnapshot(
  db: D1Database,
  snapshot: PersistedEtfCatalogSnapshot,
): Promise<void> {
  await db.prepare(
    `INSERT INTO etf_catalog_cache (trade_date, payload, source, status, received_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(trade_date) DO UPDATE SET
       payload=excluded.payload,
       source=excluded.source,
       status=excluded.status,
       received_at=excluded.received_at,
       updated_at=excluded.updated_at`,
  ).bind(
    snapshot.tradeDate,
    JSON.stringify(snapshot.items),
    snapshot.source,
    snapshot.status,
    snapshot.receivedAt,
    new Date().toISOString(),
  ).run();
}

export async function loadLatestEtfCatalogSnapshot(
  db: D1Database,
  onOrBefore: string,
): Promise<PersistedEtfCatalogSnapshot | null> {
  const row = await db.prepare(
    `SELECT trade_date, payload, source, status, received_at
     FROM etf_catalog_cache
     WHERE trade_date <= ?
     ORDER BY trade_date DESC, received_at DESC
     LIMIT 1`,
  ).bind(onOrBefore).first<{
    trade_date: string;
    payload: string;
    source: string;
    status: string;
    received_at: string;
  }>();
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload) as unknown;
    if (!Array.isArray(payload) || payload.length === 0 || !payload.every(validItem)) return null;
    const items = payload.map((item) => ({
      ...item,
      averageAmount20: normalizeAverageAmount20(item.averageAmount20),
    }));
    return {
      tradeDate: row.trade_date,
      items,
      source: row.source,
      status: row.status === "complete" ? "complete" : "partial",
      receivedAt: row.received_at,
    };
  } catch {
    return null;
  }
}
