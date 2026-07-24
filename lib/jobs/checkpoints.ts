export const BREADTH_CHECKPOINT_TIMES = ["09:25", "10:00", "11:00", "13:00", "14:00", "15:00"] as const;

export type BreadthCheckpointTime = typeof BREADTH_CHECKPOINT_TIMES[number];
export type DailyJobKey =
  | "tier1-rss-prefetch"
  | "tier2-news-prefetch"
  | "morning-brief"
  | `breadth-${BreadthCheckpointTime}`
  | "close-review"
  | "new-high-bootstrap"
  | "etf-metrics-refresh"
  | "history-backfill";

export type CheckpointStatus = "pending" | "running" | "partial" | "complete" | "failed";

export interface JobCheckpoint {
  tradeDate: string;
  key: DailyJobKey;
  stage: string;
  status: CheckpointStatus;
  attempt: number;
  expectedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  nextRetryAt: string | null;
  message: string;
  resultJson: string;
}

interface CheckpointRow {
  trade_date: string;
  job_key: string;
  stage: string;
  status: string;
  attempt: number;
  expected_at: string;
  started_at: string | null;
  finished_at: string | null;
  next_retry_at: string | null;
  message: string;
  result_json: string;
}

const DAILY_TIMES: Array<[Exclude<DailyJobKey, "new-high-bootstrap" | "history-backfill">, string]> = [
  ["tier1-rss-prefetch", "06:50"],
  ["tier2-news-prefetch", "06:55"],
  ["morning-brief", "07:15"],
  ["breadth-09:25", "09:25"],
  ["breadth-10:00", "10:00"],
  ["breadth-11:00", "11:00"],
  ["breadth-13:00", "13:00"],
  ["breadth-14:00", "14:00"],
  ["breadth-15:00", "15:00"],
  ["etf-metrics-refresh", "15:30"],
  ["close-review", "16:10"],
];

export function expectedDailyJobs(tradeDate: string): Array<{ key: DailyJobKey; expectedAt: string }> {
  return [
    ...DAILY_TIMES.map(([key, time]) => ({
      key,
      expectedAt: `${tradeDate}T${time}:00+08:00`,
    })),
    { key: "new-high-bootstrap", expectedAt: `${tradeDate}T02:00:00+08:00` },
    { key: "history-backfill", expectedAt: `${tradeDate}T01:30:00+08:00` },
  ];
}

export function isCheckpointRetryable(checkpoint: JobCheckpoint, now = new Date()): boolean {
  if (checkpoint.status === "complete") return false;
  if (checkpoint.status === "running" && checkpoint.startedAt) {
    return now.getTime() - new Date(checkpoint.startedAt).getTime() >= 3 * 60_000;
  }
  return !checkpoint.nextRetryAt || new Date(checkpoint.nextRetryAt).getTime() <= now.getTime();
}

function rowToCheckpoint(row: CheckpointRow): JobCheckpoint {
  return {
    tradeDate: row.trade_date,
    key: row.job_key as DailyJobKey,
    stage: row.stage,
    status: row.status as CheckpointStatus,
    attempt: Number(row.attempt),
    expectedAt: row.expected_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    nextRetryAt: row.next_retry_at,
    message: row.message,
    resultJson: row.result_json,
  };
}

export async function readDailyJobCheckpoints(db: D1Database, tradeDate: string): Promise<JobCheckpoint[]> {
  const result = await db.prepare(
    `SELECT trade_date, job_key, stage, status, attempt, expected_at, started_at,
      finished_at, next_retry_at, message, result_json
      FROM job_checkpoints WHERE trade_date = ? ORDER BY expected_at, job_key, stage`,
  ).bind(tradeDate).all<CheckpointRow>();
  return (result.results ?? []).map(rowToCheckpoint);
}

export async function recordJobCheckpoint(db: D1Database, checkpoint: JobCheckpoint): Promise<void> {
  const updatedAt = new Date().toISOString();
  await db.prepare(
    `INSERT INTO job_checkpoints (
      trade_date, job_key, stage, status, attempt, expected_at, started_at,
      finished_at, next_retry_at, message, result_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trade_date, job_key, stage) DO UPDATE SET
      status=excluded.status, attempt=excluded.attempt, expected_at=excluded.expected_at,
      started_at=excluded.started_at, finished_at=excluded.finished_at,
      next_retry_at=excluded.next_retry_at, message=excluded.message,
      result_json=excluded.result_json, updated_at=excluded.updated_at`,
  ).bind(
    checkpoint.tradeDate,
    checkpoint.key,
    checkpoint.stage,
    checkpoint.status,
    checkpoint.attempt,
    checkpoint.expectedAt,
    checkpoint.startedAt,
    checkpoint.finishedAt,
    checkpoint.nextRetryAt,
    checkpoint.message,
    checkpoint.resultJson,
    updatedAt,
  ).run();
}

export function scheduledJobKey(job: {
  type: string;
  time?: string;
}): DailyJobKey {
  if (job.type === "breadth") return `breadth-${job.time}` as DailyJobKey;
  return job.type as DailyJobKey;
}

export function expectedAtForJob(tradeDate: string, key: DailyJobKey): string {
  return expectedDailyJobs(tradeDate).find((item) => item.key === key)?.expectedAt
    ?? `${tradeDate}T00:00:00+08:00`;
}

export function retryAtForAttempt(now: Date, attempt: number): string {
  const delays = [5, 15, 30];
  const delayMinutes = delays[Math.min(Math.max(attempt - 1, 0), delays.length - 1)];
  return new Date(now.getTime() + delayMinutes * 60_000).toISOString();
}

export function nextRetryAtForCheckpoint(
  key: DailyJobKey,
  status: CheckpointStatus,
  now: Date,
  attempt: number,
): string | null {
  if (status === "complete") return null;
  if (
    status === "partial"
    && (key === "new-high-bootstrap" || key === "etf-metrics-refresh" || key === "history-backfill")
  ) {
    return new Date(now.getTime() + 5 * 60_000).toISOString();
  }
  return retryAtForAttempt(now, attempt);
}
