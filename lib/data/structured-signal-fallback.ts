import type {
  SectorMetric,
  StructuredMarketSignals,
  StructuredSignalEvidence,
} from "../domain/types";
import type { PopularitySnapshot } from "./ths-popularity";

const DATASET_KEYS = [
  "limitUpPool",
  "ladder",
  "hotStocks",
  "skyrocket",
  "dragonTiger",
  "anomalies",
  "sectors",
] as const;

function fallbackEvidence(input: {
  source: string;
  marketTime: string;
  receivedAt: string;
  rawCount: number;
  validCount: number;
  status: StructuredSignalEvidence["status"];
  message: string;
}): StructuredSignalEvidence {
  return {
    source: input.source,
    requestId: null,
    marketTime: input.marketTime,
    receivedAt: input.receivedAt,
    rawCount: input.rawCount,
    validCount: input.validCount,
    coveragePct: input.rawCount > 0
      ? Number((input.validCount / input.rawCount * 100).toFixed(2))
      : null,
    status: input.status,
    message: input.message,
  };
}

export function applyStructuredSignalFallbacks({
  signals,
  popularity,
  sectors,
  referenceDate,
  receivedAt,
}: {
  signals: StructuredMarketSignals | undefined;
  popularity: PopularitySnapshot;
  sectors: SectorMetric[];
  referenceDate: string;
  receivedAt: string;
}): StructuredMarketSignals | undefined {
  if (!signals) return undefined;

  const next: StructuredMarketSignals = {
    ...signals,
    hotStocks: [...signals.hotStocks],
    anomalies: [...signals.anomalies],
    sectors: [...signals.sectors],
    evidence: { ...signals.evidence },
    errors: [...signals.errors],
  };
  const marketTime = signals.marketTime || `${referenceDate}T15:00:00+08:00`;

  if (next.hotStocks.length === 0 && popularity.items.length > 0) {
    next.hotStocks = popularity.items.map((item) => ({
      symbol: item.symbol,
      name: item.name,
      rank: item.rank,
      rankChange: item.rankChange,
      heat: item.heat,
    }));
    next.evidence.hotStocks = fallbackEvidence({
      source: "同花顺热榜（降级）",
      marketTime,
      receivedAt,
      rawCount: popularity.rawCount,
      validCount: next.hotStocks.length,
      status: popularity.status === "failed" ? "partial" : popularity.status,
      message: "扶摇热股榜不可用，使用同花顺日榜降级",
    });
    next.errors = next.errors.filter((message) => !message.startsWith("热股榜："));
  }

  if (next.anomalies.length === 0 && popularity.items.length > 0) {
    next.anomalies = popularity.items.flatMap((item) => {
      const title = item.analysisTitle ?? item.concepts[0] ?? null;
      if (!title && item.concepts.length === 0) return [];
      return [{
        symbol: item.symbol,
        name: item.name,
        title,
        analysis: null,
        keywords: item.concepts,
      }];
    });
    if (next.anomalies.length > 0) {
      next.evidence.anomalies = fallbackEvidence({
        source: "同花顺热榜题材标签（降级）",
        marketTime,
        receivedAt,
        rawCount: popularity.items.length,
        validCount: next.anomalies.length,
        status: "complete",
        message: "扶摇异动原因接口不可用，使用同花顺题材与热榜标签降级；未补写主观分析",
      });
      next.errors = next.errors.filter((message) => !message.startsWith("异动原因："));
    }
  }

  if (next.sectors.length === 0 && sectors.length > 0) {
    next.sectors = [...sectors];
    next.evidence.sectors = fallbackEvidence({
      source: "东方财富板块行情（降级）",
      marketTime,
      receivedAt,
      rawCount: sectors.length,
      validCount: sectors.length,
      status: "complete",
      message: "扶摇板块接口不可用，使用东方财富板块行情降级",
    });
    next.errors = next.errors.filter((message) => !message.startsWith("板块："));
  }

  next.datasetSuccess = DATASET_KEYS.filter((key) => {
    const evidence = next.evidence[key];
    return evidence && evidence.status !== "failed" && (evidence.validCount > 0 || evidence.status === "complete");
  }).length;
  next.status = next.datasetSuccess === next.datasetTotal
    && DATASET_KEYS.every((key) => next.evidence[key]?.status === "complete")
    ? "complete"
    : next.datasetSuccess > 0 ? "partial" : "failed";
  next.receivedAt = receivedAt;
  return next;
}
