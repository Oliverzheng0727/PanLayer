import type { MarketDataProvider } from "../data/provider";
import type { Quote } from "../domain/types";
import { withRetry } from "../data/resilience";
import type { HighDetail } from "./high-details";
import {
  applyDailyQuoteToNewHighState,
  createNewHighInitialization,
  type NewHighState,
} from "./new-high-engine";

export interface NewHighStateStore {
  listBootstrapCandidates(targetDate: string, limit: number): Promise<Array<{
    symbol: string;
    name: string;
    sector: string;
  }>>;
  listBackfillDates(targetDate: string): Promise<string[]>;
  saveInitialization(state: NewHighState, details: HighDetail[]): Promise<void>;
  progress(targetDate: string): Promise<{ completed: number; target: number }>;
  loadStates(symbols: string[]): Promise<NewHighState[]>;
  saveDaily(states: NewHighState[], details: HighDetail[], rebuildSymbols: string[]): Promise<void>;
  countDetails(date: string): Promise<{
    high20: number;
    high120: number;
    allTimeHigh: number;
  }>;
}

export function newHighBootstrapRunStatus(input: {
  remaining: number;
  failed: number;
}): "complete" | "partial" {
  return input.remaining === 0 && input.failed === 0 ? "complete" : "partial";
}

export async function runNewHighBootstrapBatch(input: {
  store: NewHighStateStore;
  provider: Pick<MarketDataProvider, "getAdjustedBars">;
  targetDate: string;
  batchSize?: number;
  concurrency?: number;
  retryDelayMs?: number;
}): Promise<{
  completed: number;
  target: number;
  remaining: number;
  failed: number;
  coveragePct: number;
}> {
  const batchSize = Math.min(250, Math.max(1, input.batchSize ?? 100));
  const concurrency = Math.min(8, Math.max(1, input.concurrency ?? 5));
  const candidates = await input.store.listBootstrapCandidates(input.targetDate, batchSize);
  const backfillDates = await input.store.listBackfillDates(input.targetDate);
  let cursor = 0;
  let failed = 0;

  const worker = async () => {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor++];
      try {
        const bars = await withRetry(
          () => input.provider.getAdjustedBars(candidate.symbol),
          { retries: 2, delayMs: input.retryDelayMs ?? 250 },
        );
        const initialized = createNewHighInitialization({
          ...candidate,
          bars,
          targetDate: input.targetDate,
          backfillDates,
        });
        await input.store.saveInitialization(initialized.state, initialized.details);
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, candidates.length) }, worker),
  );
  const progress = await input.store.progress(input.targetDate);
  return {
    ...progress,
    remaining: Math.max(0, progress.target - progress.completed),
    failed,
    coveragePct: progress.target > 0
      ? Number((progress.completed / progress.target * 100).toFixed(2))
      : 0,
  };
}

export async function updateDailyNewHighSnapshot(input: {
  store: NewHighStateStore;
  tradeDate: string;
  quotes: Quote[];
  minimumCoveragePct?: number;
}): Promise<{
  high20: number | null;
  high120: number | null;
  allTimeHigh: number | null;
  coveragePct: number;
  status: "complete" | "partial";
}> {
  const quotes = [
    ...new Map(
      input.quotes
        .filter((quote) => !quote.isST)
        .map((quote) => [quote.symbol, quote]),
    ).values(),
  ];
  if (quotes.length === 0) {
    return {
      high20: null,
      high120: null,
      allTimeHigh: null,
      coveragePct: 0,
      status: "partial",
    };
  }
  const states = await input.store.loadStates(quotes.map((quote) => quote.symbol));
  const stateBySymbol = new Map(states.map((state) => [state.symbol, state]));
  const coveragePct = Number((states.length / quotes.length * 100).toFixed(2));
  const updatedStates: NewHighState[] = [];
  const details: HighDetail[] = [];
  const rebuildSymbols: string[] = [];

  for (const quote of quotes) {
    const state = stateBySymbol.get(quote.symbol);
    if (!state) continue;
    const result = applyDailyQuoteToNewHighState(state, quote, input.tradeDate);
    if (result.status === "needs-rebuild") {
      rebuildSymbols.push(quote.symbol);
      continue;
    }
    if (result.status === "updated") {
      updatedStates.push(result.state);
      details.push(...result.details);
    }
  }
  await input.store.saveDaily(updatedStates, details, rebuildSymbols);

  const minimumCoveragePct = input.minimumCoveragePct ?? 95;
  if (coveragePct < minimumCoveragePct || rebuildSymbols.length > quotes.length * .01) {
    return {
      high20: null,
      high120: null,
      allTimeHigh: null,
      coveragePct,
      status: "partial",
    };
  }
  const counts = await input.store.countDetails(input.tradeDate);
  return { ...counts, coveragePct, status: "complete" };
}
