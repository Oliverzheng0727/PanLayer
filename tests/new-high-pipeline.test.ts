import { describe, expect, it } from "vitest";
import type { MarketDataProvider } from "../lib/data/provider";
import type { Quote } from "../lib/domain/types";
import type { HighDetail } from "../lib/history/high-details";
import type {
  NewHighState,
} from "../lib/history/new-high-engine";
import {
  newHighBootstrapRunStatus,
  runNewHighBootstrapBatch,
  updateDailyNewHighSnapshot,
  type NewHighStateStore,
} from "../lib/history/new-high-pipeline";

const bars = Array.from({ length: 130 }, (_, index) => ({
  date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String(index % 28 + 1).padStart(2, "0")}`,
  close: index + 1,
  amount: 100_000_000 + index,
  pctChange: index === 0 ? 0 : Number((100 / index).toFixed(2)),
}));

const makeQuote = (symbol: string, price = 131, previousClose = 130): Quote => ({
  symbol,
  name: symbol,
  exchange: "SH",
  board: "MAIN",
  isST: false,
  isNoLimitDay: false,
  previousClose,
  open: previousClose,
  price,
  high: price,
  low: previousClose,
  pctChange: Number(((price / previousClose - 1) * 100).toFixed(2)),
  amount: 900_000_000,
  turnoverRate: 2,
  limitUpPrice: previousClose * 1.1,
  limitDownPrice: previousClose * .9,
  sector: "电子",
  firstLimitTime: null,
  limitStreak: 0,
});

class MemoryNewHighStore implements NewHighStateStore {
  readonly candidates = [
    { symbol: "600001.SH", name: "样本甲", sector: "电子" },
    { symbol: "600002.SH", name: "样本乙", sector: "医药" },
  ];
  readonly states = new Map<string, NewHighState>();
  readonly details = new Map<string, HighDetail>();
  rebuilds: string[] = [];
  failures = new Map<string, number>();

  async listBootstrapCandidates(_targetDate: string, limit: number) {
    return this.candidates.filter((item) => !this.states.has(item.symbol)).slice(0, limit);
  }
  async listBackfillDates() { return [bars.at(-1)!.date]; }
  async saveInitialization(state: NewHighState, details: HighDetail[]) {
    this.states.set(state.symbol, state);
    details.forEach((item) => this.details.set(`${item.date}:${item.type}:${item.symbol}`, item));
  }
  async recordBootstrapFailure(symbol: string) {
    this.failures.set(symbol, (this.failures.get(symbol) ?? 0) + 1);
  }
  async clearBootstrapFailure(symbol: string) {
    this.failures.delete(symbol);
  }
  async progress() {
    return { completed: this.states.size, target: this.candidates.length };
  }
  async loadStates(symbols: string[]) {
    return symbols.flatMap((symbol) => {
      const state = this.states.get(symbol);
      return state ? [state] : [];
    });
  }
  async saveDaily(states: NewHighState[], details: HighDetail[], rebuildSymbols: string[]) {
    states.forEach((state) => this.states.set(state.symbol, state));
    details.forEach((item) => this.details.set(`${item.date}:${item.type}:${item.symbol}`, item));
    this.rebuilds.push(...rebuildSymbols);
  }
  async countDetails(date: string) {
    const items = [...this.details.values()].filter((item) => item.date === date);
    return {
      high20: items.filter((item) => item.type === "20d").length,
      high120: items.filter((item) => item.type === "120d").length,
      allTimeHigh: items.filter((item) => item.type === "all-time").length,
    };
  }
}

const provider = {
  getAdjustedBars: async () => bars,
} as unknown as MarketDataProvider;

describe("new-high bootstrap and daily pipeline", () => {
  it("keeps an incomplete bootstrap partial even when the current batch had no failures", () => {
    expect(newHighBootstrapRunStatus({ remaining: 3_464, failed: 0 })).toBe("partial");
    expect(newHighBootstrapRunStatus({ remaining: 0, failed: 0 })).toBe("complete");
    expect(newHighBootstrapRunStatus({ remaining: 0, failed: 2 })).toBe("partial");
  });

  it("initializes a bounded batch and reports resumable progress", async () => {
    const store = new MemoryNewHighStore();
    const result = await runNewHighBootstrapBatch({
      store,
      provider,
      targetDate: bars.at(-1)!.date,
      batchSize: 1,
      concurrency: 1,
    });

    expect(result).toEqual({
      completed: 1,
      target: 2,
      remaining: 1,
      failed: 0,
      attempted: 1,
      succeeded: 1,
      coveragePct: 50,
    });
    expect(store.states.get("600001.SH")?.closes).toHaveLength(119);
    expect([...store.details.values()].map((item) => item.type)).toEqual(["20d", "120d", "all-time"]);
  });

  it("persists a failed symbol without blocking successful candidates", async () => {
    const store = new MemoryNewHighStore();
    const mixedProvider = {
      getAdjustedBars: async (symbol: string) => {
        if (symbol === "600001.SH") throw new Error("permanent failure");
        return bars;
      },
    } as unknown as MarketDataProvider;

    const result = await runNewHighBootstrapBatch({
      store,
      provider: mixedProvider,
      targetDate: bars.at(-1)!.date,
      batchSize: 2,
      concurrency: 2,
      retryDelayMs: 0,
    });

    expect(result).toMatchObject({ attempted: 2, succeeded: 1, failed: 1, completed: 1 });
    expect(store.failures.get("600001.SH")).toBe(1);
    expect(store.states.has("600002.SH")).toBe(true);
  });

  it("retries an adjusted-history request twice before recording a failure", async () => {
    const store = new MemoryNewHighStore();
    let attempts = 0;
    const retryingProvider = {
      getAdjustedBars: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("temporary provider failure");
        return bars;
      },
    } as unknown as MarketDataProvider;

    const result = await runNewHighBootstrapBatch({
      store,
      provider: retryingProvider,
      targetDate: bars.at(-1)!.date,
      batchSize: 1,
      concurrency: 1,
      retryDelayMs: 0,
    });

    expect(attempts).toBe(3);
    expect(result).toMatchObject({ completed: 1, failed: 0, coveragePct: 50 });
  });

  it("returns unavailable counts when initialized coverage is below 95 percent", async () => {
    const store = new MemoryNewHighStore();
    await runNewHighBootstrapBatch({
      store,
      provider,
      targetDate: bars.at(-1)!.date,
      batchSize: 1,
      concurrency: 1,
    });

    const result = await updateDailyNewHighSnapshot({
      store,
      tradeDate: "2026-06-01",
      quotes: [makeQuote("600001.SH"), makeQuote("600002.SH")],
    });

    expect(result).toMatchObject({
      high20: null,
      high120: null,
      allTimeHigh: null,
      coveragePct: 50,
      status: "partial",
    });
  });

  it("persists complete counts and remains idempotent when the close job reruns", async () => {
    const store = new MemoryNewHighStore();
    await runNewHighBootstrapBatch({
      store,
      provider,
      targetDate: bars.at(-1)!.date,
      batchSize: 2,
      concurrency: 2,
    });
    const quotes = [makeQuote("600001.SH"), makeQuote("600002.SH")];

    const first = await updateDailyNewHighSnapshot({
      store,
      tradeDate: "2026-06-01",
      quotes,
    });
    const second = await updateDailyNewHighSnapshot({
      store,
      tradeDate: "2026-06-01",
      quotes,
    });

    expect(first).toMatchObject({
      high20: 2,
      high120: 2,
      allTimeHigh: 2,
      coveragePct: 100,
      status: "complete",
    });
    expect(second).toEqual(first);
  });
});
