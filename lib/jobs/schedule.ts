export type ScheduledJob =
  | { type: "tier1-rss-prefetch" }
  | { type: "tier2-news-prefetch" }
  | { type: "morning-brief" }
  | { type: "breadth"; time: string }
  | { type: "close-review" }
  | { type: "new-high-bootstrap" }
  | { type: "etf-metrics-refresh" }
  | { type: "history-backfill"; days: number };

const BREADTH_TIMES = new Set(["09:25", "10:00", "11:00", "13:00", "14:00", "15:00"]);

export function jobForBeijingTime(time: string): ScheduledJob | null {
  if (["01:30", "01:35", "01:40", "01:45", "01:50", "01:55"].includes(time)) {
    return { type: "history-backfill", days: 20 };
  }
  if (time === "06:50") return { type: "tier1-rss-prefetch" };
  if (time === "06:55") return { type: "tier2-news-prefetch" };
  if (time === "07:15") return { type: "morning-brief" };
  if (time === "08:30") return { type: "new-high-bootstrap" };
  const [hour, minute] = time.split(":").map(Number);
  if (
    Number.isInteger(hour)
    && Number.isInteger(minute)
    && hour >= 18
    && hour <= 23
    && minute % 30 === 0
  ) {
    return { type: "new-high-bootstrap" };
  }
  if (BREADTH_TIMES.has(time)) return { type: "breadth", time };
  if (time === "15:30") return { type: "etf-metrics-refresh" };
  if (time === "16:10") return { type: "close-review" };
  return null;
}

export function beijingDateParts(date: Date): { date: string; time: string; weekday: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: parts.weekday,
  };
}

export function isChinaTradingWeekday(date: Date): boolean {
  const { weekday } = beijingDateParts(date);
  return weekday !== "Sat" && weekday !== "Sun";
}

const CLOSE_REVIEW_TIME = "16:10";

function previousCalendarDate(date: string): string {
  const previous = new Date(`${date}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

export function canRunCloseReview(date: Date): boolean {
  const { time } = beijingDateParts(date);
  return isChinaTradingWeekday(date) && time >= CLOSE_REVIEW_TIME;
}

export function latestCompletedReviewDate(date: Date): string {
  const parts = beijingDateParts(date);
  return canRunCloseReview(date) ? parts.date : previousCalendarDate(parts.date);
}
