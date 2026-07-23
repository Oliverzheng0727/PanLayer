import type { Breadth, Quote, SectorMetric } from "./types";

const PRICE_EPSILON = 0.005;

export function classifyLimitStatus(quote: Quote): "limit-up" | "limit-down" | "normal" {
  if (quote.isST || quote.isNoLimitDay) return "normal";
  if (quote.price >= quote.limitUpPrice - PRICE_EPSILON) return "limit-up";
  if (quote.price <= quote.limitDownPrice + PRICE_EPSILON) return "limit-down";
  return "normal";
}

export function calculateBreadth(quotes: Quote[]): Breadth {
  return quotes.reduce<Breadth>((result, item) => {
    if (item.isST) return result;
    if (item.price > item.previousClose + PRICE_EPSILON) result.rising += 1;
    else if (item.price < item.previousClose - PRICE_EPSILON) result.falling += 1;
    else result.flat += 1;
    return result;
  }, { rising: 0, falling: 0, flat: 0 });
}

export function formatBreadthRatio(rising: number, falling: number): string {
  if (!Number.isFinite(rising) || !Number.isFinite(falling) || falling <= 0) return "暂缺";
  return (rising / falling).toFixed(2);
}

export function bucketLimitLadder(quotes: Quote[]) {
  const ladder = {
    first: [] as Quote[],
    second: [] as Quote[],
    third: [] as Quote[],
    fourth: [] as Quote[],
    fivePlus: [] as Quote[],
  };

  quotes
    .filter((item) => classifyLimitStatus(item) === "limit-up")
    .sort((a, b) => b.limitStreak - a.limitStreak || b.amount - a.amount)
    .forEach((item) => {
      if (item.limitStreak <= 1) ladder.first.push(item);
      else if (item.limitStreak === 2) ladder.second.push(item);
      else if (item.limitStreak === 3) ladder.third.push(item);
      else if (item.limitStreak === 4) ladder.fourth.push(item);
      else ladder.fivePlus.push(item);
    });

  return ladder;
}

export function calculateLimitPremium(
  items: Array<{ previousStreak: number; openPct: number; closePct: number }>,
) {
  const basket = items.filter((item) => item.previousStreak >= 2);
  if (basket.length === 0) return { openPct: null, closePct: null, sampleSize: 0 };
  const mean = (key: "openPct" | "closePct") =>
    Number((basket.reduce((sum, item) => sum + item[key], 0) / basket.length).toFixed(2));
  return { openPct: mean("openPct"), closePct: mean("closePct"), sampleSize: basket.length };
}

export function findNewHighs(adjustedHistory: number[], currentClose: number) {
  if (adjustedHistory.length < 120) return { high120: false, allTimeHigh: false };
  const previous = adjustedHistory.slice(0, -1);
  const high120 = Math.max(...previous.slice(-119)) <= currentClose;
  const allTimeHigh = Math.max(...previous) <= currentClose;
  return { high120, allTimeHigh };
}

const LEADER_RANKING_RULES = [
  { label: "连板高度", compare: (a: Quote, b: Quote) => b.limitStreak - a.limitStreak },
  { label: "涨停状态", compare: (a: Quote, b: Quote) => Number(classifyLimitStatus(b) === "limit-up") - Number(classifyLimitStatus(a) === "limit-up") },
  { label: "首次封板时间", compare: (a: Quote, b: Quote) => (a.firstLimitTime ?? "99:99:99").localeCompare(b.firstLimitTime ?? "99:99:99") },
  { label: "成交额", compare: (a: Quote, b: Quote) => b.amount - a.amount },
] as const;

export const LEADER_RANKING_BASIS = LEADER_RANKING_RULES.map((rule) => rule.label);

export function rankLeaders(quotes: Quote[]): Quote[] {
  return [...quotes].sort((a, b) => {
    for (const rule of LEADER_RANKING_RULES) {
      const result = rule.compare(a, b);
      if (result) return result;
    }
    return 0;
  });
}

export function rankSectors(sectors: SectorMetric[]): SectorMetric[] {
  return [...sectors].sort((a, b) =>
    b.limitUpCount - a.limitUpCount ||
    b.averagePct - a.averagePct ||
    b.amountGrowthPct - a.amountGrowthPct ||
    b.maxStreak - a.maxStreak,
  );
}
