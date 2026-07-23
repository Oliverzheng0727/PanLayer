import { beijingDateParts } from "../jobs/schedule";

export const ETF_REFRESH_MS = 60_000;
export const BREADTH_REFRESH_MS = 180_000;
export const SERVER_LIVE_CACHE_MS = 60_000;
export const STALE_AFTER_MS = 300_000;

export function isBeijingMarketSession(date: Date): boolean {
  const { time, weekday } = beijingDateParts(date);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return (time >= "09:25" && time <= "11:30") || (time >= "13:00" && time <= "15:00");
}

export function isStale(receivedAt: string | null, now = new Date()): boolean {
  if (!receivedAt) return true;
  const received = Date.parse(receivedAt);
  return !Number.isFinite(received) || now.getTime() - received > STALE_AFTER_MS;
}
