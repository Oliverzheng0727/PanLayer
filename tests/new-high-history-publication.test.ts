import { describe, expect, it } from "vitest";
import { demoReview } from "../lib/data/demo";
import type { DailyReview } from "../lib/domain/types";
import {
  publishHistoricalNewHighCountsWhenReady,
  publishHistoricalNewHighCountsWithDiagnostics,
} from "../lib/jobs/runner";

type Counts = { high20: number; high120: number; allTimeHigh: number };

interface FakeD1Options {
  reviews?: Record<string, DailyReview>;
  details?: Record<string, Counts>;
  markers?: Record<string, string>;
  applyUpdates?: boolean;
  verifiedStateThroughDate?: string | null;
  historicalCompleted?: number;
  assembledDates?: string[];
}

function reviewFor(date: string): DailyReview {
  const review = structuredClone(demoReview);
  review.date = date;
  review.status = "partial";
  review.metrics.high20 = null;
  review.metrics.high120 = null;
  review.metrics.allTimeHigh = null;
  return review;
}

function fakeD1(options: FakeD1Options = {}) {
  const reviews = new Map(
    Object.entries(options.reviews ?? {}).map(([date, review]) => [date, JSON.stringify(review)]),
  );
  const details = new Map(Object.entries(options.details ?? {}));
  const markers = new Map(Object.entries(options.markers ?? {}));
  const applyUpdates = options.applyUpdates ?? true;
  const assembledDates = new Set(options.assembledDates ?? []);

  function prepare(sql: string) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    const statement = {
      args: [] as unknown[],
      bind(...args: unknown[]) {
        statement.args = args;
        return statement;
      },
      async first<T>() {
        if (normalized.startsWith("SELECT MAX(trade_date) AS trade_date")) {
          const targetDate = String(statement.args[0]);
          const tradeDate = [...reviews.keys()]
            .filter((date) => normalized.includes("trade_date < ?")
              ? date < targetDate
              : date <= targetDate)
            .sort()
            .at(-1) ?? null;
          return { trade_date: tradeDate } as T;
        }
        if (normalized.startsWith("SELECT h.last_date FROM stocks")) {
          const fallback = [...reviews.keys()].sort().at(-1) ?? null;
          return { last_date: options.verifiedStateThroughDate === undefined
            ? fallback
            : options.verifiedStateThroughDate } as T;
        }
        if (normalized.startsWith("SELECT trade_date FROM daily_reviews WHERE trade_date = ?")) {
          const date = String(statement.args[0]);
          return (reviews.has(date) ? { trade_date: date } : null) as T;
        }
        if (normalized.startsWith("SELECT status FROM job_checkpoints")) {
          const date = String(statement.args[0]);
          return (assembledDates.has(date) ? { status: "complete" } : null) as T;
        }
        if (
          normalized.startsWith("SELECT COUNT(*) AS count FROM stocks s")
          && normalized.includes("h.last_date >= ?")
        ) {
          return { count: options.historicalCompleted ?? 95 } as T;
        }
        if (normalized.startsWith("SELECT value FROM bootstrap_state")) {
          const value = markers.get(String(statement.args[0]));
          return (value === undefined ? null : { value }) as T;
        }
        return null as T;
      },
      async all<T>() {
        if (normalized.startsWith("SELECT trade_date, payload FROM daily_reviews")) {
          const throughDate = String(statement.args[0]);
          const results = [...reviews.entries()]
            .filter(([date]) => date <= throughDate)
            .sort(([left], [right]) => right.localeCompare(left))
            .slice(0, 120)
            .map(([trade_date, payload]) => ({ trade_date, payload }));
          return { results } as { results: T[] };
        }
        if (normalized.startsWith("SELECT type, COUNT(*) AS count FROM new_high_details")) {
          const counts = details.get(String(statement.args[0])) ?? {
            high20: 0,
            high120: 0,
            allTimeHigh: 0,
          };
          return {
            results: [
              { type: "20d", count: counts.high20 },
              { type: "120d", count: counts.high120 },
              { type: "all-time", count: counts.allTimeHigh },
            ],
          } as { results: T[] };
        }
        return { results: [] as T[] };
      },
      async run() {
        if (normalized.startsWith("UPDATE daily_reviews SET payload")) {
          if (applyUpdates) {
            const [payload, , tradeDate] = statement.args;
            reviews.set(String(tradeDate), String(payload));
          }
        } else if (normalized.startsWith("INSERT INTO bootstrap_state")) {
          markers.set(String(statement.args[0]), String(statement.args[1]));
        }
        return { success: true };
      },
    };
    return statement;
  }

  const db = {
    prepare,
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  } as unknown as D1Database;

  return {
    db,
    reviews,
    markers,
    readReview(date: string) {
      return JSON.parse(reviews.get(date)!) as DailyReview;
    },
  };
}

describe("historical new-high publication", () => {
  it("publishes yesterday and older history when the baseline is ready even if today is not", async () => {
    const harness = fakeD1({
      reviews: {
        "2026-07-29": reviewFor("2026-07-29"),
        "2026-07-30": reviewFor("2026-07-30"),
      },
      details: {
        "2026-07-29": { high20: 16, high120: 9, allTimeHigh: 3 },
        "2026-07-30": { high20: 21, high120: 12, allTimeHigh: 5 },
      },
    });

    await expect(publishHistoricalNewHighCountsWhenReady(
      harness.db,
      "2026-07-31",
      95,
      100,
      0,
    )).resolves.toBe(2);

    expect(harness.readReview("2026-07-29").metrics).toMatchObject({
      high20: 16,
      high120: 9,
      allTimeHigh: 3,
    });
    expect(harness.readReview("2026-07-30").metrics).toMatchObject({
      high20: 21,
      high120: 12,
      allTimeHigh: 5,
    });
    expect(harness.markers.get("new-high-history-published:2026-07-30")).toBe("v3:95/100");
  });

  it("does not trust a matching marker while persisted review metrics are still null", async () => {
    const harness = fakeD1({
      reviews: { "2026-07-30": reviewFor("2026-07-30") },
      details: { "2026-07-30": { high20: 14, high120: 7, allTimeHigh: 2 } },
      markers: { "new-high-history-published:2026-07-30": "v3:95/100" },
    });

    await expect(publishHistoricalNewHighCountsWhenReady(
      harness.db,
      "2026-07-31",
      95,
      100,
      0,
    )).resolves.toBe(1);
    expect(harness.readReview("2026-07-30").metrics).toMatchObject({
      high20: 14,
      high120: 7,
      allTimeHigh: 2,
    });
  });

  it("does not save the completion marker when post-write verification fails", async () => {
    const harness = fakeD1({
      reviews: { "2026-07-30": reviewFor("2026-07-30") },
      details: { "2026-07-30": { high20: 14, high120: 7, allTimeHigh: 2 } },
      applyUpdates: false,
    });

    await expect(publishHistoricalNewHighCountsWhenReady(
      harness.db,
      "2026-07-31",
      95,
      100,
      0,
    )).resolves.toBe(1);
    expect(harness.markers.has("new-high-history-published:2026-07-30")).toBe(false);
    expect(harness.readReview("2026-07-30").metrics.high20).toBeNull();
  });

  it("does not save a marker when there are no historical reviews to patch", async () => {
    const harness = fakeD1();

    await expect(publishHistoricalNewHighCountsWhenReady(
      harness.db,
      "2026-07-31",
      95,
      100,
      0,
    )).resolves.toBe(0);
    expect(harness.markers.size).toBe(0);
  });

  it("publishes only through the date covered by at least 95 percent of historical states", async () => {
    const harness = fakeD1({
      reviews: {
        "2026-07-29": reviewFor("2026-07-29"),
        "2026-07-30": reviewFor("2026-07-30"),
      },
      details: {
        "2026-07-29": { high20: 18, high120: 10, allTimeHigh: 4 },
        "2026-07-30": { high20: 22, high120: 13, allTimeHigh: 6 },
      },
      verifiedStateThroughDate: "2026-07-29",
    });

    const result = await publishHistoricalNewHighCountsWithDiagnostics(
      harness.db,
      "2026-07-31",
      95,
      100,
      0,
    );

    expect(result).toMatchObject({
      patched: 1,
      reason: "published",
      requestedThroughDate: "2026-07-30",
      verifiedStateThroughDate: "2026-07-29",
      throughDate: "2026-07-29",
      historicalStateCoveragePct: 95,
      missingBefore: 1,
      missingAfter: 0,
    });
    expect(harness.readReview("2026-07-29").metrics.high20).toBe(18);
    expect(harness.readReview("2026-07-30").metrics.high20).toBeNull();
  });

  it("publishes the assembled latest close without waiting for the next trading day", async () => {
    const harness = fakeD1({
      reviews: {
        "2026-07-31": reviewFor("2026-07-31"),
      },
      details: {
        "2026-07-31": { high20: 24, high120: 15, allTimeHigh: 7 },
      },
      assembledDates: ["2026-07-31"],
    });

    const result = await publishHistoricalNewHighCountsWithDiagnostics(
      harness.db,
      "2026-07-31",
      99,
      100,
      0,
    );

    expect(result).toMatchObject({
      patched: 1,
      reason: "published",
      requestedThroughDate: "2026-07-31",
      throughDate: "2026-07-31",
    });
    expect(harness.readReview("2026-07-31").metrics).toMatchObject({
      high20: 24,
      high120: 15,
      allTimeHigh: 7,
    });
  });

  it("reports the exact readiness gate instead of an unexplained zero", async () => {
    const baselinePending = fakeD1({
      reviews: { "2026-07-30": reviewFor("2026-07-30") },
    });
    await expect(publishHistoricalNewHighCountsWithDiagnostics(
      baselinePending.db,
      "2026-07-31",
      94,
      100,
      0,
    )).resolves.toMatchObject({
      patched: 0,
      reason: "baseline-not-ready",
      baselineCoveragePct: 94,
    });

    const historicalPending = fakeD1({
      reviews: { "2026-07-30": reviewFor("2026-07-30") },
      verifiedStateThroughDate: null,
    });
    await expect(publishHistoricalNewHighCountsWithDiagnostics(
      historicalPending.db,
      "2026-07-31",
      95,
      100,
      0,
    )).resolves.toMatchObject({
      patched: 0,
      reason: "historical-state-not-ready",
      requestedThroughDate: "2026-07-30",
    });
  });
});
