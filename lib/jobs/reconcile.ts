import type { ScheduledJob } from "./schedule";
import {
  expectedDailyJobs,
  isCheckpointRetryable,
  type DailyJobKey,
  type JobCheckpoint,
} from "./checkpoints";

const CATCH_UP_MINUTES: Record<DailyJobKey, number> = {
  "tier1-rss-prefetch": 14 * 60,
  "tier2-news-prefetch": 14 * 60,
  "morning-brief": 14 * 60,
  "breadth-09:25": 20,
  "breadth-10:00": 20,
  "breadth-11:00": 20,
  "breadth-13:00": 20,
  "breadth-14:00": 20,
  "breadth-15:00": 20,
  "close-review": 470,
  "new-high-bootstrap": 24 * 60,
  "etf-metrics-refresh": 510,
  "history-backfill": 45,
};

function keyToJob(key: DailyJobKey): ScheduledJob | null {
  if (key.startsWith("breadth-")) {
    return { type: "breadth", time: key.slice("breadth-".length) };
  }
  if (key === "history-backfill") return { type: "history-backfill", days: 20 };
  if (
    key === "tier1-rss-prefetch"
    || key === "tier2-news-prefetch"
    || key === "morning-brief"
    || key === "close-review"
    || key === "new-high-bootstrap"
    || key === "etf-metrics-refresh"
  ) {
    return { type: key };
  }
  return null;
}

export function planCatchUpJobs({
  tradeDate,
  now,
  checkpoints,
  limit = 2,
  marketSession = true,
}: {
  tradeDate: string;
  now: Date;
  checkpoints: JobCheckpoint[];
  limit?: number;
  marketSession?: boolean;
}): ScheduledJob[] {
  const byKey = new Map(
    checkpoints
      .filter((checkpoint) => checkpoint.stage === "main")
      .map((checkpoint) => [checkpoint.key, checkpoint]),
  );

  return expectedDailyJobs(tradeDate, { marketSession })
    .filter(({ key, expectedAt }) => {
      const expectedTime = new Date(expectedAt).getTime();
      const ageMs = now.getTime() - expectedTime;
      if (ageMs < 0 || ageMs > CATCH_UP_MINUTES[key] * 60_000) return false;
      const checkpoint = byKey.get(key);
      return !checkpoint || isCheckpointRetryable(checkpoint, now);
    })
    .sort((a, b) => new Date(b.expectedAt).getTime() - new Date(a.expectedAt).getTime())
    .flatMap(({ key }) => {
      const job = keyToJob(key);
      return job ? [job] : [];
    })
    .slice(0, Math.max(1, limit));
}
