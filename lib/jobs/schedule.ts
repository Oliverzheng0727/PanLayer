export type ScheduledJob =
  | { type: "morning-brief" }
  | { type: "breadth"; time: string }
  | { type: "close-review" };

const BREADTH_TIMES = new Set(["09:25", "10:00", "11:00", "13:00", "14:00", "15:00"]);

export function jobForBeijingTime(time: string): ScheduledJob | null {
  if (time === "07:15") return { type: "morning-brief" };
  if (BREADTH_TIMES.has(time)) return { type: "breadth", time };
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
