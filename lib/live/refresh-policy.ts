import { beijingDateParts } from "../jobs/schedule";

export const ETF_REFRESH_MS = 60_000;
export const BREADTH_REFRESH_MS = 180_000;
export const SERVER_LIVE_CACHE_MS = 60_000;
export const STALE_AFTER_MS = 300_000;

export type BeijingMarketPhase = "preopen" | "morning" | "lunch" | "afternoon" | "closed" | "non-trading";

export function beijingMarketPhase(
  date: Date,
  marketSession = true,
): BeijingMarketPhase {
  const { time, weekday } = beijingDateParts(date);
  if (!marketSession || weekday === "Sat" || weekday === "Sun") return "non-trading";
  if (time < "09:25") return "preopen";
  if (time <= "11:30") return "morning";
  if (time < "13:00") return "lunch";
  if (time <= "15:00") return "afternoon";
  return "closed";
}

export function isBeijingMarketSession(date: Date): boolean {
  const phase = beijingMarketPhase(date);
  return phase === "morning" || phase === "afternoon";
}

export function isStale(receivedAt: string | null, now = new Date()): boolean {
  if (!receivedAt) return true;
  const received = Date.parse(receivedAt);
  return !Number.isFinite(received) || now.getTime() - received > STALE_AFTER_MS;
}
