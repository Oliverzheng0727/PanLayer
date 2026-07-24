import { classifyEtf, type EtfCategory } from "./catalog";
import type { EtfSnapshot } from "../data/provider";

export function calculateAverageAmount20(
  bars: Array<{ time: string; amount: number }>,
): number | null {
  const valid = bars
    .filter((bar) => typeof bar.time === "string" && Number.isFinite(bar.amount) && bar.amount > 0)
    .slice(-20);
  if (valid.length < 20) return null;
  return Number((valid.reduce((sum, bar) => sum + bar.amount, 0) / valid.length / 100_000_000).toFixed(2));
}

export function normalizeEtfCategory(
  name: string,
  trackingIndex = "",
): Exclude<EtfCategory, "全部"> {
  return classifyEtf(`${name} ${trackingIndex}`).category;
}

export function mergeEtfDerivedMetrics(
  live: EtfSnapshot[],
  persisted: EtfSnapshot[],
): EtfSnapshot[] {
  const previous = new Map(persisted.map((item) => [item.symbol, item]));
  return live.map((item) => {
    const stored = previous.get(item.symbol);
    return {
      ...item,
      averageAmount20: item.averageAmount20 ?? stored?.averageAmount20 ?? null,
    };
  });
}
