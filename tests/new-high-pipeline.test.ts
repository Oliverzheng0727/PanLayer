import { describe, expect, it } from "vitest";
import type { MarketDataProvider } from "../lib/data/provider";
import type { Quote } from "../lib/domain/types";
import type { HighDetail } from "../lib/history/high-details";
import type {
  NewHighState,
} from "../lib/history/new-high-engine";
import {
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

  async listBootstrapCandidates(_targetDate: string, limit: number) {
    return this.candidates.filter((item) => !this.states.has(item.symbol)).slice(0, limit);
  }
  async listBackfillDates() { return [bars.at(-1)!.date]; }
  async saveInitialization(state: NewHighState, details: HighDetail[]) {
    this.states.set(state.symbol, state);
    details.forEach((item) => this.details.set(`${item.date}:${item.type}:${item.symbol}`, item));
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
  it("initializes a bounded batch and reports resumable progress", async () => {
    const store = new MemoryNewHighStore();
    const result = await runNewHighBootstrapBatch({
      store,
      provider,
      targetDate: bars.at(-1)!.date,
      batchSize: 1,
      concurrency: 1,
    });

    expect(result).toEqual({ completed: 1, target: 2, remaining: 1, failed: 0 });
    expect(store.states.get("600001.SH")?.closes).toHaveLength(119);
    expect([...store.details.values()].map((item) => item.type)).toEqual(["20d", "120d", "all-time"]);
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
