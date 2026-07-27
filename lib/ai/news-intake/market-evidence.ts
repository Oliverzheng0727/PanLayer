import type { FuyaoMorningBriefEvidence } from "../../data/fuyao-mcp";

export const FUYAO_MARKET_EVIDENCE_SCHEMA_STATEMENT = `CREATE TABLE IF NOT EXISTS brief_market_evidence (
  trade_date TEXT NOT NULL,
  provider TEXT NOT NULL,
  reference_date TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (trade_date, provider)
)`;

export async function persistFuyaoMarketEvidence(
  db: D1Database,
  tradeDate: string,
  evidence: FuyaoMorningBriefEvidence,
): Promise<void> {
  await db.prepare(
    `INSERT INTO brief_market_evidence (
      trade_date, provider, reference_date, payload, status, received_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(trade_date, provider) DO UPDATE SET
      reference_date=excluded.reference_date,
      payload=excluded.payload,
      status=excluded.status,
      received_at=excluded.received_at`,
  ).bind(
    tradeDate,
    evidence.provider,
    evidence.referenceDate,
    JSON.stringify(evidence),
    evidence.status,
    evidence.receivedAt,
  ).run();
}

function isEvidence(value: unknown): value is FuyaoMorningBriefEvidence {
  if (!value || typeof value !== "object") return false;
  const evidence = value as Partial<FuyaoMorningBriefEvidence>;
  return evidence.schemaVersion === 1
    && evidence.provider === "扶摇 Fuyao"
    && (evidence.status === "complete" || evidence.status === "partial" || evidence.status === "failed")
    && typeof evidence.referenceDate === "string"
    && typeof evidence.marketTime === "string"
    && typeof evidence.receivedAt === "string"
    && Number.isInteger(evidence.datasetTotal)
    && Number.isInteger(evidence.datasetSuccess)
    && Array.isArray(evidence.indices)
    && Array.isArray(evidence.hotStocks)
    && Array.isArray(evidence.dragonTiger)
    && Array.isArray(evidence.errors);
}

export async function readFuyaoMarketEvidence(
  db: D1Database,
  tradeDate: string,
): Promise<FuyaoMorningBriefEvidence | null> {
  const row = await db.prepare(
    `SELECT payload FROM brief_market_evidence
     WHERE trade_date = ? AND provider = '扶摇 Fuyao'
     LIMIT 1`,
  ).bind(tradeDate).first<{ payload: string }>().catch(() => null);
  if (!row?.payload) return null;
  try {
    const parsed = JSON.parse(row.payload) as unknown;
    return isEvidence(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
