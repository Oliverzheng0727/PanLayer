import type { DailyReview } from "../domain/types";
import type { HistoryRow } from "./query";

export interface ReviewOverview {
  date: string;
  rising: number | null;
  falling: number | null;
  limitUp: number | null;
  limitDown: number | null;
  consecutive: number | null;
  maxStreak: number;
  allTimeHigh: number | null;
  high120: number | null;
  closePremium: number | null;
  openPremium: number | null;
  marginBalance: number | null;
  status: DailyReview["status"];
  source: string;
  updatedAt: string;
}

export function historyRowToOverview(row: HistoryRow): ReviewOverview {
  return {
    date: row.date,
    rising: row.rising,
    falling: row.falling,
    limitUp: row.limitUp,
    limitDown: row.limitDown,
    consecutive: row.consecutive,
    maxStreak: row.maxStreak,
    allTimeHigh: row.allTimeHigh,
    high120: row.high120,
    closePremium: row.closePremium,
    openPremium: row.openPremium,
    marginBalance: row.marginBalance,
    status: row.status,
    source: row.source,
    updatedAt: row.updatedAt,
  };
}
