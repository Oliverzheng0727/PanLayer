import { describe, expect, it } from "vitest";
import {
  persistFuyaoMarketEvidence,
  readFuyaoMarketEvidence,
} from "../lib/ai/news-intake/market-evidence";
import type { FuyaoMorningBriefEvidence } from "../lib/data/fuyao-mcp";

const evidence: FuyaoMorningBriefEvidence = {
  schemaVersion: 1,
  provider: "扶摇 Fuyao",
  status: "complete",
  referenceDate: "2026-07-24",
  marketTime: "2026-07-24T15:00:00+08:00",
  receivedAt: "2026-07-27T22:50:00.000Z",
  datasetTotal: 5,
  datasetSuccess: 5,
  requestIds: ["request-1"],
  indices: [],
  limitUpPool: { total: 0, leaders: [] },
  ladder: { highest: 0, counts: { two: 0, three: 0, four: 0, five: 0, six: 0, sevenPlus: 0 }, leaders: [] },
  hotStocks: [],
  dragonTiger: [],
  errors: [],
};

describe("Fuyao morning evidence persistence", () => {
  it("upserts one provider record and reads the validated payload", async () => {
    let payload = "";
    const db = {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...bound: unknown[]) { values = bound; return this; },
          async run() {
            if (sql.includes("INSERT INTO brief_market_evidence")) payload = String(values[3]);
            return {};
          },
          async first() {
            return sql.includes("SELECT payload FROM brief_market_evidence") && payload ? { payload } : null;
          },
        };
      },
    } as unknown as D1Database;

    await persistFuyaoMarketEvidence(db, "2026-07-27", evidence);
    await expect(readFuyaoMarketEvidence(db, "2026-07-27")).resolves.toEqual(evidence);
  });
});
