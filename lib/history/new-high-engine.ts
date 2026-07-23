import type { Quote } from "../domain/types";
import type { AdjustedBar } from "../data/provider";
import type { HighDetail } from "./high-details";

export interface NewHighState {
  symbol: string;
  name: string;
  sector: string;
  lastDate: string;
  lastClose: number;
  closes: number[];
  allTimeHigh: number;
  allTimeHighDate: string;
  firstClose: number;
  initializedThrough: string;
}

const roundPct = (value: number) => Number(value.toFixed(2));

function detailFor({
  type,
  symbol,
  name,
  sector,
  bar,
  intervalBase,
  isAllTime,
}: {
  type: HighDetail["type"];
  symbol: string;
  name: string;
  sector: string;
  bar: AdjustedBar;
  intervalBase: number;
  isAllTime: boolean;
}): HighDetail | null {
  if (
    bar.amount === undefined ||
    !Number.isFinite(bar.amount) ||
    bar.pctChange === undefined ||
    !Number.isFinite(bar.pctChange)
  ) {
    return null;
  }
  return {
    date: bar.date,
    type,
    symbol,
    name,
    sector,
    pctChange: bar.pctChange,
    close: bar.close,
    highPrice: bar.close,
    amount: bar.amount,
    intervalPct: intervalBase > 0
      ? roundPct((bar.close / intervalBase - 1) * 100)
      : 0,
    highDate: bar.date,
    isAllTime,
  };
}

function evaluateBar({
  symbol,
  name,
  sector,
  bar,
  previousCloses,
  allTimeHigh,
  firstClose,
  eligibleAllTime,
}: {
  symbol: string;
  name: string;
  sector: string;
  bar: AdjustedBar;
  previousCloses: number[];
  allTimeHigh: number;
  firstClose: number;
  eligibleAllTime: boolean;
}): HighDetail[] {
  const is20 = previousCloses.length >= 19
    && bar.close >= Math.max(...previousCloses.slice(-19));
  const is120 = previousCloses.length >= 119
    && bar.close >= Math.max(...previousCloses.slice(-119));
  const isAllTime = eligibleAllTime && bar.close >= allTimeHigh;
  const details: HighDetail[] = [];
  if (is20) {
    const detail = detailFor({
      type: "20d",
      symbol,
      name,
      sector,
      bar,
      intervalBase: previousCloses.at(-19)!,
      isAllTime,
    });
    if (detail) details.push(detail);
  }
  if (is120) {
    const detail = detailFor({
      type: "120d",
      symbol,
      name,
      sector,
      bar,
      intervalBase: previousCloses.at(-119)!,
      isAllTime,
    });
    if (detail) details.push(detail);
  }
  if (isAllTime) {
    const detail = detailFor({
      type: "all-time",
      symbol,
      name,
      sector,
      bar,
      intervalBase: firstClose,
      isAllTime: true,
    });
    if (detail) details.push(detail);
  }
  return details;
}

export function createNewHighInitialization(input: {
  symbol: string;
  name: string;
  sector: string;
  bars: AdjustedBar[];
  targetDate: string;
  backfillDates: string[];
}): { state: NewHighState; details: HighDetail[] } {
  const bars = input.bars
    .filter((bar) => bar.date <= input.targetDate && bar.close > 0)
    .toSorted((left, right) => left.date.localeCompare(right.date));
  if (bars.length === 0) throw new Error(`no adjusted bars for ${input.symbol}`);

  const backfillDates = new Set(input.backfillDates);
  const closes: number[] = [];
  const details: HighDetail[] = [];
  let allTimeHigh = bars[0].close;
  let allTimeHighDate = bars[0].date;
  const firstClose = bars[0].close;

  for (const bar of bars) {
    if (backfillDates.has(bar.date)) {
      details.push(...evaluateBar({
        symbol: input.symbol,
        name: input.name,
        sector: input.sector,
        bar,
        previousCloses: closes,
        allTimeHigh,
        firstClose,
        eligibleAllTime: closes.length >= 119,
      }));
    }
    if (bar.close >= allTimeHigh) {
      allTimeHigh = bar.close;
      allTimeHighDate = bar.date;
    }
    closes.push(bar.close);
  }

  const last = bars.at(-1)!;
  return {
    state: {
      symbol: input.symbol,
      name: input.name,
      sector: input.sector,
      lastDate: last.date,
      lastClose: last.close,
      closes: closes.slice(-119),
      allTimeHigh,
      allTimeHighDate,
      firstClose,
      initializedThrough: input.targetDate,
    },
    details,
  };
}

export function applyDailyQuoteToNewHighState(
  state: NewHighState,
  quote: Quote,
  tradeDate: string,
): {
  status: "updated" | "already-processed" | "needs-rebuild";
  state: NewHighState;
  details: HighDetail[];
} {
  if (state.lastDate >= tradeDate) {
    return { status: "already-processed", state, details: [] };
  }
  const referenceDifference = Math.abs(state.lastClose - quote.previousClose);
  const referenceBase = Math.max(state.lastClose, quote.previousClose, 0.01);
  if (referenceDifference / referenceBase > .005) {
    return { status: "needs-rebuild", state, details: [] };
  }

  const bar: AdjustedBar = {
    date: tradeDate,
    close: quote.price,
    amount: quote.amount,
    pctChange: quote.pctChange,
  };
  const details = evaluateBar({
    symbol: state.symbol,
    name: quote.name || state.name,
    sector: quote.sector || state.sector,
    bar,
    previousCloses: state.closes,
    allTimeHigh: state.allTimeHigh,
    firstClose: state.firstClose,
    eligibleAllTime: state.closes.length >= 119,
  });
  const isAllTime = quote.price >= state.allTimeHigh;
  return {
    status: "updated",
    state: {
      ...state,
      name: quote.name || state.name,
      sector: quote.sector || state.sector,
      lastDate: tradeDate,
      lastClose: quote.price,
      closes: [...state.closes, quote.price].slice(-119),
      allTimeHigh: isAllTime ? quote.price : state.allTimeHigh,
      allTimeHighDate: isAllTime ? tradeDate : state.allTimeHighDate,
      initializedThrough: tradeDate,
    },
    details,
  };
}
