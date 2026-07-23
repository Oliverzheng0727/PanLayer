import { describe, expect, it } from "vitest";
import type { Quote } from "../lib/domain/types";
import {
  applyDailyQuoteToNewHighState,
  createNewHighInitialization,
} from "../lib/history/new-high-engine";

const quote = (price: number, previousClose: number): Quote => ({
  symbol: "600001.SH",
  name: "真实样本",
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
  amount: 880_000_000,
  turnoverRate: 2,
  limitUpPrice: previousClose * 1.1,
  limitDownPrice: previousClose * .9,
  sector: "电子",
  firstLimitTime: null,
  limitStreak: 0,
});

const bars = Array.from({ length: 130 }, (_, index) => ({
  date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String(index % 28 + 1).padStart(2, "0")}`,
  close: index + 1,
  amount: 100_000_000 + index,
  pctChange: index === 0 ? 0 : Number((100 / index).toFixed(2)),
}));

describe("new-high calculation engine", () => {
  it("initializes rolling state and backfills real 20d, 120d and all-time details", () => {
    const targetDate = bars.at(-1)!.date;
    const result = createNewHighInitialization({
      symbol: "600001.SH",
      name: "真实样本",
      sector: "电子",
      bars,
      targetDate,
      backfillDates: [targetDate],
    });

    expect(result.state).toMatchObject({
      symbol: "600001.SH",
      lastDate: targetDate,
      lastClose: 130,
      allTimeHigh: 130,
      allTimeHighDate: targetDate,
      firstClose: 1,
      initializedThrough: targetDate,
    });
    expect(result.state.closes).toHaveLength(119);
    expect(result.details.map((item) => item.type)).toEqual(["20d", "120d", "all-time"]);
    expect(result.details.every((item) => item.amount > 0 && item.highDate === targetDate)).toBe(true);
  });

  it("compares the current close with prior windows and updates state once", () => {
    const initialized = createNewHighInitialization({
      symbol: "600001.SH",
      name: "真实样本",
      sector: "电子",
      bars: bars.slice(0, 129),
      targetDate: bars[128].date,
      backfillDates: [],
    });

    const result = applyDailyQuoteToNewHighState(
      initialized.state,
      quote(130, 129),
      bars[129].date,
    );

    expect(result.status).toBe("updated");
    expect(result.details.map((item) => item.type)).toEqual(["20d", "120d", "all-time"]);
    expect(result.state.lastDate).toBe(bars[129].date);
    expect(result.state.initializedThrough).toBe(bars[129].date);
    expect(result.state.closes).toHaveLength(119);

    const repeated = applyDailyQuoteToNewHighState(
      result.state,
      quote(130, 129),
      bars[129].date,
    );
    expect(repeated.status).toBe("already-processed");
    expect(repeated.details).toEqual([]);
  });

  it("marks an ex-right reference-price mismatch for a fresh adjusted-history rebuild", () => {
    const initialized = createNewHighInitialization({
      symbol: "600001.SH",
      name: "真实样本",
      sector: "电子",
      bars: bars.slice(0, 129),
      targetDate: bars[128].date,
      backfillDates: [],
    });

    const result = applyDailyQuoteToNewHighState(
      initialized.state,
      quote(120, 120),
      bars[129].date,
    );

    expect(result.status).toBe("needs-rebuild");
    expect(result.details).toEqual([]);
    expect(result.state.lastDate).toBe(bars[128].date);
  });

  it("does not label an under-120-day listing as a 120d or all-time high", () => {
    const shortBars = bars.slice(0, 30);
    const result = createNewHighInitialization({
      symbol: "600001.SH",
      name: "真实样本",
      sector: "电子",
      bars: shortBars,
      targetDate: shortBars.at(-1)!.date,
      backfillDates: [shortBars.at(-1)!.date],
    });

    expect(result.details.map((item) => item.type)).toEqual(["20d"]);
  });
});
