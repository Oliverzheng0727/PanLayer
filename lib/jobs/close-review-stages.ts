import type { DailyComparison, DailyReview } from "../domain/types";
import { isVerifiedSectorMetric } from "../domain/market-structure";

export type CloseReviewStage =
  | "quotes"
  | "board-pools"
  | "signals"
  | "recognition"
  | "aggregate"
  | "indices"
  | "new-highs"
  | "assemble";

export const CLOSE_REVIEW_CORE_STAGES = [
  "quotes",
  "board-pools",
  "signals",
  "recognition",
  "aggregate",
  "indices",
] as const satisfies readonly CloseReviewStage[];

const CLOSE_REVIEW_CORE_STAGE_SET = new Set<string>(CLOSE_REVIEW_CORE_STAGES);

export function isCloseReviewCoreStage(stage: string): boolean {
  return CLOSE_REVIEW_CORE_STAGE_SET.has(stage);
}

function preferNumber(current: number | null | undefined, previous: number | null | undefined) {
  return current ?? previous ?? null;
}

function mergeComparison(
  previous: DailyComparison | undefined,
  current: DailyComparison | undefined,
): DailyComparison | undefined {
  if (!previous) {
    return current
      ? { ...current, mainSectors: current.mainSectors.filter(isVerifiedSectorMetric) }
      : undefined;
  }
  if (!current) {
    return { ...previous, mainSectors: previous.mainSectors.filter(isVerifiedSectorMetric) };
  }
  const currentMainSectors = current.mainSectors.filter(isVerifiedSectorMetric);
  const previousMainSectors = previous.mainSectors.filter(isVerifiedSectorMetric);
  return {
    ...current,
    brokenCount: preferNumber(current.brokenCount, previous.brokenCount),
    largeDownCount: preferNumber(current.largeDownCount, previous.largeDownCount),
    sealRate: preferNumber(current.sealRate, previous.sealRate),
    yesterdaySuccessRate: preferNumber(current.yesterdaySuccessRate, previous.yesterdaySuccessRate),
    yesterdaySuccessSampleSize: current.yesterdaySuccessSampleSize || previous.yesterdaySuccessSampleSize,
    continuation: current.continuation ?? previous.continuation,
    marketAmount: preferNumber(current.marketAmount, previous.marketAmount),
    marketCoveragePct: preferNumber(current.marketCoveragePct, previous.marketCoveragePct),
    maxBoard: current.maxBoard ?? previous.maxBoard,
    brokenBoard: current.brokenBoard.sampleSize > 0 || current.brokenBoard.count !== null
      ? current.brokenBoard
      : previous.brokenBoard,
    mainSectors: currentMainSectors.length > 0 ? currentMainSectors : previousMainSectors,
    cycleLeader: current.cycleLeader ?? previous.cycleLeader,
    recognition: current.recognition.length > 0 ? current.recognition : previous.recognition,
    indices: current.indices.length > 0 ? current.indices : previous.indices,
    evidence: { ...previous.evidence, ...current.evidence },
  };
}

export function mergeCloseReviewWithExisting(
  previous: DailyReview | null,
  current: DailyReview,
): DailyReview {
  if (!previous || previous.date !== current.date) return current;
  const structureFailed = current.structure?.status === "failed";
  const breadthByTime = new Map(previous.breadth.map((item) => [item.time, item]));
  current.breadth.forEach((item) => breadthByTime.set(item.time, item));
  const breadth = [...breadthByTime.values()].toSorted((left, right) => left.time.localeCompare(right.time));
  const previousStructureUsable = previous.structure?.status === "complete";
  const preserveStructure = structureFailed && previousStructureUsable;
  const recognitionRanking = current.recognitionRanking?.status === "complete"
    ? current.recognitionRanking
    : previous.recognitionRanking?.status === "complete"
      ? previous.recognitionRanking
      : current.recognitionRanking ?? previous.recognitionRanking;
  const mergedComparison = mergeComparison(previous.comparison, current.comparison);
  if (mergedComparison && recognitionRanking) {
    const sourceComparison = recognitionRanking === current.recognitionRanking
      ? current.comparison
      : previous.comparison;
    mergedComparison.recognition = sourceComparison?.recognition ?? [];
    if (sourceComparison?.evidence.recognition) {
      mergedComparison.evidence.recognition = sourceComparison.evidence.recognition;
    }
  }

  return {
    ...current,
    status: current.structuredSignals
      ? current.status
      : previous.status === "complete" && current.status !== "failed" ? "complete" : current.status,
    source: [...new Set([...previous.source.split(" / "), ...current.source.split(" / ")].filter(Boolean))].join(" / "),
    breadth,
    breadthMeta: current.breadthMeta,
    metrics: {
      ...current.metrics,
      limitUp: preserveStructure ? previous.metrics.limitUp : preferNumber(current.metrics.limitUp, previous.metrics.limitUp),
      limitDown: preserveStructure ? previous.metrics.limitDown : preferNumber(current.metrics.limitDown, previous.metrics.limitDown),
      consecutive: preserveStructure ? previous.metrics.consecutive : preferNumber(current.metrics.consecutive, previous.metrics.consecutive),
      largeRise: preferNumber(current.metrics.largeRise, previous.metrics.largeRise),
      high20: preferNumber(current.metrics.high20, previous.metrics.high20),
      high120: preferNumber(current.metrics.high120, previous.metrics.high120),
      allTimeHigh: preferNumber(current.metrics.allTimeHigh, previous.metrics.allTimeHigh),
      marginBalance: preferNumber(current.metrics.marginBalance, previous.metrics.marginBalance),
    },
    premium: {
      openPct: preferNumber(current.premium.openPct, previous.premium.openPct),
      closePct: preferNumber(current.premium.closePct, previous.premium.closePct),
      sampleSize: current.premium.sampleSize || previous.premium.sampleSize,
    },
    ladder: preserveStructure ? previous.ladder : current.ladder,
    sectors: preserveStructure ? previous.sectors : current.sectors,
    leaders: preserveStructure ? previous.leaders : current.leaders,
    structure: preserveStructure ? previous.structure : current.structure,
    comparison: mergedComparison,
    recognitionRanking,
  };
}
