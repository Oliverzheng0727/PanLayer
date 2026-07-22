import { calculateBreadth } from "../domain/metrics";
import type { Quote } from "../domain/types";

export type DataQualityStatus = "complete" | "partial" | "failed" | "demo";

export interface SourceAudit {
  source: string;
  marketTime: string;
  receivedAt: string;
  rawCount: number;
  validCount: number;
  invalidCount: number;
  coveragePct: number;
  directionAgreementPct: number | null;
  priceAgreementPct: number | null;
  breadthDifference: number | null;
  status: DataQualityStatus;
  message: string;
}

export interface QualitySummary {
  status: Exclude<DataQualityStatus, "demo">;
  primaryCoveragePct: number;
  secondaryCoveragePct: number;
  directionAgreementPct: number;
  priceAgreementPct: number;
  breadthDifference: number;
  priceAnomalies: number;
  message: string;
}

const percentage = (part: number, total: number): number => total > 0 ? Number(((part / total) * 100).toFixed(2)) : 0;

function validQuotes(quotes: Quote[]): Quote[] {
  const unique = new Map<string, Quote>();
  for (const quote of quotes) {
    if (quote.isST || !quote.symbol || !Number.isFinite(quote.price) || quote.price <= 0 || !Number.isFinite(quote.previousClose) || quote.previousClose <= 0) continue;
    unique.set(quote.symbol, quote);
  }
  return [...unique.values()];
}

function direction(quote: Quote): number {
  return Math.sign(Number.isFinite(quote.pctChange) ? quote.pctChange : quote.price - quote.previousClose);
}

export function compareDomesticSnapshots(
  primaryInput: Quote[],
  secondaryInput: Quote[],
  expectedCount: number,
  now: Date,
): { summary: QualitySummary; audits: SourceAudit[] } {
  const primary = validQuotes(primaryInput);
  const secondary = validQuotes(secondaryInput);
  const denominator = Math.max(1, expectedCount, primary.length, secondary.length);
  const primaryCoveragePct = percentage(primary.length, denominator);
  const secondaryCoveragePct = percentage(secondary.length, denominator);
  const secondaryBySymbol = new Map(secondary.map((quote) => [quote.symbol, quote]));
  let common = 0;
  let directionsAgree = 0;
  let pricesAgree = 0;
  for (const quote of primary) {
    const other = secondaryBySymbol.get(quote.symbol);
    if (!other) continue;
    common += 1;
    if (direction(quote) === direction(other)) directionsAgree += 1;
    const threshold = Math.max(0.01, quote.previousClose * 0.0015);
    if (Math.abs(quote.price - other.price) <= threshold) pricesAgree += 1;
  }
  const directionAgreementPct = percentage(directionsAgree, common);
  const priceAgreementPct = percentage(pricesAgree, common);
  const primaryBreadth = calculateBreadth(primary);
  const secondaryBreadth = calculateBreadth(secondary);
  const breadthDifference = Math.max(
    Math.abs(primaryBreadth.rising - secondaryBreadth.rising),
    Math.abs(primaryBreadth.falling - secondaryBreadth.falling),
    Math.abs(primaryBreadth.flat - secondaryBreadth.flat),
  );
  const breadthLimit = Math.max(30, denominator * 0.01);
  const failed = primary.length === 0 && secondary.length === 0;
  const complete = !failed
    && primaryCoveragePct >= 95
    && secondaryCoveragePct >= 90
    && common > 0
    && directionAgreementPct >= 98
    && priceAgreementPct >= 98
    && breadthDifference <= breadthLimit;
  const status: QualitySummary["status"] = failed ? "failed" : complete ? "complete" : "partial";
  const reasons = [
    primaryCoveragePct < 95 ? `主源覆盖率 ${primaryCoveragePct}%` : "",
    secondaryCoveragePct < 90 ? `交叉源覆盖率 ${secondaryCoveragePct}%` : "",
    common === 0 ? "没有共同证券" : "",
    common > 0 && directionAgreementPct < 98 ? `方向一致率 ${directionAgreementPct}%` : "",
    common > 0 && priceAgreementPct < 98 ? `价格一致率 ${priceAgreementPct}%` : "",
    breadthDifference > breadthLimit ? `涨跌家数差异 ${breadthDifference}` : "",
  ].filter(Boolean);
  const message = status === "complete" ? "双源覆盖与价格方向一致" : status === "failed" ? "所有行情源均无有效价格" : reasons.join("；");
  const receivedAt = now.toISOString();
  const audit = (source: string, raw: Quote[], valid: Quote[], coveragePct: number): SourceAudit => ({
    source,
    marketTime: receivedAt,
    receivedAt,
    rawCount: raw.length,
    validCount: valid.length,
    invalidCount: Math.max(0, raw.length - valid.length),
    coveragePct,
    directionAgreementPct: common > 0 ? directionAgreementPct : null,
    priceAgreementPct: common > 0 ? priceAgreementPct : null,
    breadthDifference: common > 0 ? breadthDifference : null,
    status: valid.length === 0 ? "failed" : status,
    message,
  });
  return {
    summary: {
      status,
      primaryCoveragePct,
      secondaryCoveragePct,
      directionAgreementPct,
      priceAgreementPct,
      breadthDifference,
      priceAnomalies: Math.max(0, common - pricesAgree),
      message,
    },
    audits: [audit("东方财富", primaryInput, primary, primaryCoveragePct), audit("腾讯", secondaryInput, secondary, secondaryCoveragePct)],
  };
}
