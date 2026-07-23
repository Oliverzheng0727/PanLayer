import { BREADTH_REFRESH_MS } from "./refresh-policy";

export function formatBeijingClock(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function delayMinutes(receivedAt: string | null, now: Date): number | null {
  if (!receivedAt) return null;
  const received = Date.parse(receivedAt);
  if (!Number.isFinite(received)) return null;
  return Math.max(0, Math.floor((now.getTime() - received) / 60_000));
}

export function nextRefreshSeconds(
  lastSuccessAt: string | null,
  now: Date,
  intervalMs = BREADTH_REFRESH_MS,
): number {
  if (!lastSuccessAt) return 0;
  const received = Date.parse(lastSuccessAt);
  if (!Number.isFinite(received)) return 0;
  return Math.max(0, Math.ceil((received + intervalMs - now.getTime()) / 1_000));
}
