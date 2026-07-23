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

export function formatBeijingDateTime(value: string | null): string {
  if (!value) return "时间暂缺";
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}:00+08:00`
    : value;
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) return "时间暂缺";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
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
