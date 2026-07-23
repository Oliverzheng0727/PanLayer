import type { Quote } from "../domain/types";
import { withRetry } from "./resilience";
import { compareDomesticSnapshots, type DataQualityStatus, type SourceAudit } from "./quality";

interface PrimarySource {
  name: string;
  getQuotes(at: string): Promise<Quote[]>;
}

interface SecondarySource {
  name: string;
  getQuotes(symbols: string[]): Promise<Quote[]>;
}

export interface MarketPipelineResult {
  quotes: Quote[];
  source: string;
  status: Exclude<DataQualityStatus, "demo">;
  message: string;
  audits: SourceAudit[];
}

export async function runDomesticPipeline({
  at,
  expectedSymbols,
  primary,
  secondary,
  now,
  retryDelayMs = 1_000,
  minimumExpectedCount = 0,
  secondarySampleSize = Number.POSITIVE_INFINITY,
}: {
  at: string;
  expectedSymbols: string[];
  primary: PrimarySource;
  secondary: SecondarySource;
  now: Date;
  retryDelayMs?: number;
  minimumExpectedCount?: number;
  secondarySampleSize?: number;
}): Promise<MarketPipelineResult> {
  let primaryQuotes: Quote[] = [];
  let secondaryQuotes: Quote[] = [];
  let primaryError = "";
  let secondaryError = "";
  try {
    primaryQuotes = await withRetry(() => primary.getQuotes(at), { retries: 2, delayMs: retryDelayMs });
  } catch (error) {
    primaryError = error instanceof Error ? error.message : "primary failed";
  }
  const symbols = expectedSymbols.length > 0 ? expectedSymbols : primaryQuotes.map((quote) => quote.symbol);
  if (symbols.length > 0) {
    try {
      const sampleSize = primaryQuotes.length > 0
        ? Math.min(symbols.length, Math.max(1, Math.floor(secondarySampleSize)))
        : symbols.length;
      const secondarySymbols = sampleSize >= symbols.length
        ? symbols
        : Array.from({ length: sampleSize }, (_, index) => symbols[Math.floor(index * symbols.length / sampleSize)]);
      secondaryQuotes = await withRetry(() => secondary.getQuotes(secondarySymbols), { retries: 2, delayMs: retryDelayMs });
    } catch (error) {
      secondaryError = error instanceof Error ? error.message : "secondary failed";
    }
  } else {
    secondaryError = "没有可用证券池";
  }
  const expectedCount = Math.max(minimumExpectedCount, symbols.length, primaryQuotes.length, secondaryQuotes.length);
  const quality = compareDomesticSnapshots(primaryQuotes, secondaryQuotes, expectedCount, now);
  const audits = quality.audits.map((audit, index) => ({
    ...audit,
    source: index === 0 ? primary.name : secondary.name,
    marketTime: `${now.toISOString().slice(0, 10)}T${at}:00+08:00`,
  }));
  if (primaryQuotes.length > 0) {
    return {
      quotes: primaryQuotes,
      source: quality.summary.status === "complete" ? `${primary.name} / ${secondary.name}` : primary.name,
      status: quality.summary.status === "failed" ? "partial" : quality.summary.status,
      message: quality.summary.message || secondaryError,
      audits,
    };
  }
  if (secondaryQuotes.length > 0) {
    return {
      quotes: secondaryQuotes,
      source: secondary.name,
      status: "partial",
      message: `主源不可用，使用交叉源${primaryError ? `：${primaryError}` : ""}`,
      audits,
    };
  }
  return {
    quotes: [],
    source: `${primary.name} / ${secondary.name}`,
    status: "failed",
    message: [primaryError, secondaryError].filter(Boolean).join("；") || quality.summary.message,
    audits,
  };
}
