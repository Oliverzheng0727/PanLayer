import type { GlobalPoint, ReconciledGlobalPoint } from "./types";

const OFFICIAL_PROVIDERS = new Set(["FRED", "EIA"]);

export function reconcileGlobalPoints(points: GlobalPoint[]): ReconciledGlobalPoint[] {
  const groups = new Map<string, GlobalPoint[]>();
  for (const point of points) groups.set(point.key, [...(groups.get(point.key) ?? []), point]);
  return [...groups.values()].map((group) => {
    const available = group.filter((point) => point.status === "ok" && point.value !== null);
    const official = available.find((point) => OFFICIAL_PROVIDERS.has(point.provider));
    if (official) {
      const providers = [official.provider, ...available.filter((point) => point !== official).map((point) => point.provider)];
      return { ...official, providers, status: "official", message: "采用官方宏观数据" };
    }
    if (available.length === 0) {
      const fallback = group[0];
      return {
        ...fallback,
        providers: group.map((point) => point.provider),
        status: group.every((point) => point.status === "unconfigured") ? "unconfigured" : "failed",
      };
    }
    const preferred = available.find((point) => point.provider === "Twelve Data") ?? available[0];
    if (available.length === 1) return { ...preferred, providers: [preferred.provider], status: "partial", message: "仅单一行情源" };
    const comparison = available.find((point) => point !== preferred);
    const sameDate = Boolean(preferred.marketTime && comparison?.marketTime && preferred.marketTime === comparison.marketTime);
    const differencePct = comparison?.value === null || preferred.value === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(preferred.value - comparison.value) / Math.max(1, Math.abs(preferred.value));
    const status = sameDate && differencePct <= 0.002 ? "cross-checked" : "partial";
    return {
      ...preferred,
      providers: available.map((point) => point.provider),
      status,
      message: status === "cross-checked" ? "双源交易日期与价格一致" : sameDate ? "双源价格差异超过 0.2%" : "双源交易日期不一致",
    };
  });
}
