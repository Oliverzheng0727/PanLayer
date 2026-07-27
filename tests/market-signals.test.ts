import { describe, expect, it } from "vitest";
import {
  persistStructuredMarketSignals,
  readStructuredMarketSignals,
} from "../lib/data/market-signals";
import type { StructuredMarketSignals } from "../lib/domain/types";

const signals: StructuredMarketSignals = {
  schemaVersion: 1,
  provider: "扶摇 Fuyao",
  referenceDate: "2026-07-24",
  marketTime: "2026-07-24T15:00:00+08:00",
  receivedAt: "2026-07-24T08:00:00.000Z",
  status: "complete",
  datasetTotal: 7,
  datasetSuccess: 7,
  requestIds: ["request-1"],
  hotStocks: [],
  skyrocket: [],
  dragonTiger: [],
  anomalies: [],
  sectors: [],
  evidence: {},
  errors: [],
};

describe("structured market signal persistence", () => {
  it("upserts by trade date, dataset and provider", async () => {
    let payload = "";
    const db = {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...bound: unknown[]) { values = bound; return this; },
          async run() {
            if (sql.includes("structured_market_signals")) payload = String(values[2]);
            return {};
          },
          async first() {
            return sql.includes("structured_market_signals") && payload ? { payload } : null;
          },
        };
      },
    } as unknown as D1Database;

    await persistStructuredMarketSignals(db, signals);
    await expect(readStructuredMarketSignals(db, signals.referenceDate)).resolves.toEqual(signals);
  });
});
