import type { DailyComparison, DailyReview } from "../domain/types";

export type CloseReviewStage =
  | "quotes"
  | "board-pools"
  | "aggregate"
  | "indices"
  | "new-highs"
  | "assemble";

function preferNumber(current: number | null | undefined, previous: number | null | undefined) {
  return current ?? previous ?? null;
}

function mergeComparison(
  previous: DailyComparison | undefined,
  current: DailyComparison | undefined,
): DailyComparison | undefined {
  if (!previous) return current;
  if (!current) return previous;
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
    mainSectors: current.mainSectors.length > 0 ? current.mainSectors : previous.mainSectors,
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

  return {
    ...current,
    status: previous.status === "complete" && current.status !== "failed" ? "complete" : current.status,
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
    comparison: mergeComparison(previous.comparison, current.comparison),
  };
}
