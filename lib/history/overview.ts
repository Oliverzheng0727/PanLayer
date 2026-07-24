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
  high20: number | null;
  high120: number | null;
  closePremium: number | null;
  openPremium: number | null;
  marginBalance: number | null;
  status: DailyReview["status"];
  source: string;
  updatedAt: string;
}

const EXPECTED_BREADTH_TIMES = ["09:25", "10:00", "11:00", "13:00", "14:00", "15:00"];

export function breadthCompleteness(
  breadth: DailyReview["breadth"],
): NonNullable<DailyReview["breadthMeta"]> {
  const capturedTimes = new Set(breadth.map((item) => item.time));
  const missing = EXPECTED_BREADTH_TIMES.filter((time) => !capturedTimes.has(time));
  const captured = EXPECTED_BREADTH_TIMES.length - missing.length;
  return {
    expected: EXPECTED_BREADTH_TIMES.length,
    captured,
    missing,
    status: missing.length === 0 ? "complete" : "partial",
  };
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
    high20: row.high20,
    high120: row.high120,
    closePremium: row.closePremium,
    openPremium: row.openPremium,
    marginBalance: row.marginBalance,
    status: row.status,
    source: row.source,
    updatedAt: row.updatedAt,
  };
}
