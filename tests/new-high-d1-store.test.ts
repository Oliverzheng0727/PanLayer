import { describe, expect, it } from "vitest";
import {
  applyNewHighCountsToReview,
  decodeNewHighStateRow,
  encodeNewHighState,
  newHighBootstrapTargetDate,
} from "../lib/history/new-high-d1-store";
import { demoReview } from "../lib/data/demo";

describe("D1 new-high state serialization", () => {
  it("round-trips rolling closes and adjustment metadata without losing precision", () => {
    const state = {
      symbol: "600001.SH",
      name: "真实样本",
      sector: "电子",
      lastDate: "2026-07-23",
      lastClose: 10.66,
      closes: [10.01, 10.25, 10.66],
      allTimeHigh: 10.66,
      allTimeHighDate: "2026-07-23",
      firstClose: 2.15,
      initializedThrough: "2026-07-23",
    };

    expect(decodeNewHighStateRow(encodeNewHighState(state))).toEqual(state);
  });

  it("patches persisted reviews with verified counts without changing unrelated metrics", () => {
    const result = applyNewHighCountsToReview(demoReview, {
      high20: 31,
      high120: 20,
      allTimeHigh: 8,
    });

    expect(result.metrics).toMatchObject({
      limitUp: demoReview.metrics.limitUp,
      high20: 31,
      high120: 20,
      allTimeHigh: 8,
    });
  });

  it("initializes through the current review date after that review exists", async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async first() {
                return {
                  trade_date: sql.includes("<= ?") ? "2026-07-24" : "2026-07-23",
                };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    await expect(newHighBootstrapTargetDate(db, "2026-07-24")).resolves.toBe("2026-07-24");
  });
});
