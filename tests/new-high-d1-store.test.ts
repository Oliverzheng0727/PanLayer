import { describe, expect, it } from "vitest";
import {
  applyNewHighCountsToReview,
  decodeNewHighStateRow,
  encodeNewHighState,
  newHighBootstrapTargetDate,
  refreshNewHighProgressSnapshot,
  runD1DailyNewHighRefreshBatch,
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

  it("reports daily progress from the actual last bar date rather than baseline metadata", async () => {
    let persistedSnapshot: Record<string, unknown> | null = null;
    const db = {
      prepare(sql: string) {
        const normalized = sql.replace(/\s+/g, " ").trim();
        const statement = {
          args: [] as unknown[],
          bind(...args: unknown[]) {
            statement.args = args;
            return statement;
          },
          async first() {
            if (normalized.includes("SELECT value FROM bootstrap_state")) {
              return { value: "complete" };
            }
            if (normalized.includes("MAX(trade_date) AS trade_date")) {
              return { trade_date: "2026-07-31" };
            }
            if (normalized.includes("COUNT(*) AS count FROM stocks WHERE")) {
              return { count: 2 };
            }
            if (normalized.includes("h.last_date IS NOT NULL")) {
              return { count: 2 };
            }
            if (normalized.includes("h.status = 'active' AND h.last_date >= ?")) {
              return { count: 1 };
            }
            if (normalized.includes("h.status = 'active' AND h.initialized_through >= ?")) {
              throw new Error("daily progress must not use initialized_through");
            }
            if (normalized.includes("h.status = 'rebuild'")) return { count: 0 };
            if (normalized.includes("new_high_bootstrap_failures")) return { count: 0 };
            return null;
          },
          async run() {
            if (normalized.startsWith("INSERT INTO bootstrap_state")) {
              persistedSnapshot = JSON.parse(String(statement.args[1])) as Record<string, unknown>;
            }
            return { success: true };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    const snapshot = await refreshNewHighProgressSnapshot(db, "2026-07-31");
    expect(snapshot).toMatchObject({
      targetDate: "2026-07-31",
      target: 2,
      completed: 2,
      dailyCompleted: 1,
    });
    expect(persistedSnapshot).toMatchObject({ dailyCompleted: 1 });
  });

  it("advances the immutable daily contribution snapshot in bounded idempotent batches", async () => {
    const targetDate = "2026-07-31";
    const previousDate = "2026-07-30";
    const closes = Array.from({ length: 119 }, (_, index) => 8 + index / 60);
    const states = new Map([
      ["000001.SZ", {
        ...encodeNewHighState({
          symbol: "000001.SZ",
          name: "增量一号",
          sector: "电子",
          lastDate: previousDate,
          lastClose: 10,
          closes,
          allTimeHigh: 10,
          allTimeHighDate: previousDate,
          firstClose: 2,
          // A historical baseline may be declared initialized through the target
          // while its last actual bar is still the prior trade day.
          initializedThrough: targetDate,
        }),
        status: "active",
      }],
      ["000002.SZ", {
        ...encodeNewHighState({
          symbol: "000002.SZ",
          name: "增量二号",
          sector: "汽车",
          lastDate: previousDate,
          lastClose: 9,
          closes: Array.from({ length: 119 }, () => 9),
          allTimeHigh: 12,
          allTimeHighDate: "2026-01-05",
          firstClose: 3,
          initializedThrough: previousDate,
        }),
        status: "active",
      }],
      ["000003.SZ", {
        ...encodeNewHighState({
          symbol: "000003.SZ",
          name: "已经完成",
          sector: "银行",
          lastDate: targetDate,
          lastClose: 8,
          closes: Array.from({ length: 119 }, () => 8),
          allTimeHigh: 9,
          allTimeHighDate: "2026-01-05",
          firstClose: 4,
          initializedThrough: targetDate,
        }),
        status: "active",
      }],
    ]);
    const contributions = new Map([
      ["000001.SZ", { name: "增量一号", pctChange: 10, amount: 900_000_000 }],
      ["000002.SZ", { name: "增量二号", pctChange: -1, amount: 500_000_000 }],
      ["000003.SZ", { name: "已经完成", pctChange: 1, amount: 300_000_000 }],
    ]);
    const details = new Map<string, Record<string, unknown>>();
    let batchCalls = 0;

    const db = {
      prepare(sql: string) {
        const normalized = sql.replace(/\s+/g, " ").trim();
        const statement = {
          sql: normalized,
          args: [] as unknown[],
          bind(...args: unknown[]) {
            statement.args = args;
            return statement;
          },
          async first() {
            if (normalized.includes("COUNT(*) AS count FROM stocks WHERE")) return { count: states.size };
            if (normalized.includes("h.last_date >= ?")) {
              return {
                count: [...states.values()].filter((state) =>
                  state.status === "active" && state.last_date >= String(statement.args[0])
                ).length,
              };
            }
            if (normalized.includes("FROM history_daily_contribution_meta")) {
              return {
                expected_count: 3,
                valid_count: 3,
                non_st_count: 3,
                coverage_pct: 100,
                source: "fixture",
                received_at: "2026-07-31T07:00:00.000Z",
                status: "complete",
              };
            }
            if (normalized.includes("MAX(last_date) AS last_date")) {
              const dates = [...states.values()]
                .filter((state) => state.status === "active" && state.last_date < String(statement.args[0]))
                .map((state) => state.last_date);
              return { last_date: dates.toSorted().at(-1) ?? null };
            }
            return null;
          },
          async all() {
            if (normalized.includes("FROM history_daily_contributions d")) {
              const limit = Number(statement.args.at(-1));
              return {
                results: [...states.values()]
                  .filter((state) => state.status === "active" && state.last_date < targetDate)
                  .toSorted((left, right) => left.symbol.localeCompare(right.symbol))
                  .slice(0, limit)
                  .flatMap((state) => {
                    const contribution = contributions.get(state.symbol);
                    return contribution ? [{
                      ...state,
                      contribution_name: contribution.name,
                      pct_change: contribution.pctChange,
                      amount: contribution.amount,
                    }] : [];
                  }),
              };
            }
            if (normalized.includes("FROM new_high_details")) {
              const counts = new Map<string, number>();
              for (const detail of details.values()) {
                if (detail.trade_date !== statement.args[0]) continue;
                const type = String(detail.type);
                counts.set(type, (counts.get(type) ?? 0) + 1);
              }
              return { results: [...counts].map(([type, count]) => ({ type, count })) };
            }
            return { results: [] };
          },
          async run() {
            return { success: true };
          },
        };
        return statement;
      },
      async batch(statements: Array<{ sql: string; args: unknown[] }>) {
        batchCalls += 1;
        for (const statement of statements) {
          if (statement.sql.startsWith("DELETE FROM new_high_details")) {
            const symbols = new Set(JSON.parse(String(statement.args[1])) as string[]);
            for (const [key, detail] of details) {
              if (detail.trade_date === statement.args[0] && symbols.has(String(detail.symbol))) details.delete(key);
            }
          } else if (statement.sql.startsWith("INSERT INTO new_high_states")) {
            for (const state of JSON.parse(String(statement.args[0])) as Array<Record<string, unknown>>) {
              states.set(String(state.symbol), { ...state, status: "active" } as never);
            }
          } else if (statement.sql.startsWith("INSERT INTO new_high_details")) {
            for (const detail of JSON.parse(String(statement.args[0])) as Array<Record<string, unknown>>) {
              details.set(`${detail.trade_date}:${detail.type}:${detail.symbol}`, detail);
            }
          } else if (statement.sql.startsWith("UPDATE new_high_states")) {
            for (const symbol of JSON.parse(String(statement.args[1])) as string[]) {
              const state = states.get(symbol);
              if (state) state.status = "rebuild";
            }
          }
        }
        return statements.map(() => ({ success: true }));
      },
    } as unknown as D1Database;

    const first = await runD1DailyNewHighRefreshBatch({ db, targetDate, batchSize: 1 });
    expect(first).toMatchObject({
      target: 3,
      dailyCompleted: 2,
      dailyCoveragePct: 66.67,
      remaining: 1,
      processed: 1,
      details: 3,
      rebuild: 0,
      high20: null,
      status: "partial",
      error: null,
    });

    const second = await runD1DailyNewHighRefreshBatch({ db, targetDate, batchSize: 1 });
    expect(second).toMatchObject({
      target: 3,
      dailyCompleted: 3,
      dailyCoveragePct: 100,
      remaining: 0,
      processed: 1,
      high20: 1,
      high120: 1,
      allTimeHigh: 1,
      status: "complete",
      error: null,
    });

    const third = await runD1DailyNewHighRefreshBatch({ db, targetDate, batchSize: 999 });
    expect(third).toMatchObject({ dailyCompleted: 3, processed: 0, status: "complete" });
    expect(details.size).toBe(3);
    expect(batchCalls).toBe(2);
  });

  it("does not advance states without a verified immutable close snapshot", async () => {
    const db = {
      prepare(sql: string) {
        const statement = {
          bind() { return statement; },
          async first() {
            if (sql.includes("FROM history_daily_contribution_meta")) return null;
            return { count: sql.includes("JOIN new_high_states") ? 0 : 5_326 };
          },
        };
        return statement;
      },
    } as unknown as D1Database;
    await expect(runD1DailyNewHighRefreshBatch({
      db,
      targetDate: "2026-07-31",
    })).resolves.toMatchObject({
      target: 5_326,
      dailyCompleted: 0,
      processed: 0,
      status: "failed",
      error: "daily contribution snapshot is missing",
    });
  });
});
