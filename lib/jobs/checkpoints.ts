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
export type JobExecutionTrigger = "cron" | "reconcile" | "manual";

export interface JobExecutionMetadata {
  trigger: JobExecutionTrigger;
  scheduledAt: string;
  lastStartedAt: string;
  lastCompletedAt: string | null;
  firstAutomaticCompletedAt: string | null;
  lastAutomaticCompletedAt: string | null;
  lastManualCompletedAt: string | null;
}

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

export function readJobExecutionMetadata(
  resultJson: string | null | undefined,
): JobExecutionMetadata | null {
  if (!resultJson) return null;
  try {
    const parsed = JSON.parse(resultJson) as { execution?: Partial<JobExecutionMetadata> };
    const execution = parsed.execution;
    if (
      !execution
      || (execution.trigger !== "cron" && execution.trigger !== "reconcile" && execution.trigger !== "manual")
      || typeof execution.scheduledAt !== "string"
      || typeof execution.lastStartedAt !== "string"
    ) return null;
    return {
      trigger: execution.trigger,
      scheduledAt: execution.scheduledAt,
      lastStartedAt: execution.lastStartedAt,
      lastCompletedAt: typeof execution.lastCompletedAt === "string" ? execution.lastCompletedAt : null,
      firstAutomaticCompletedAt: typeof execution.firstAutomaticCompletedAt === "string"
        ? execution.firstAutomaticCompletedAt
        : null,
      lastAutomaticCompletedAt: typeof execution.lastAutomaticCompletedAt === "string"
        ? execution.lastAutomaticCompletedAt
        : null,
      lastManualCompletedAt: typeof execution.lastManualCompletedAt === "string"
        ? execution.lastManualCompletedAt
        : null,
    };
  } catch {
    return null;
  }
}

export function buildJobExecutionMetadata(input: {
  previous?: JobExecutionMetadata | null;
  trigger: JobExecutionTrigger;
  scheduledAt: string;
  startedAt: string;
  finishedAt?: string | null;
  completed?: boolean;
}): JobExecutionMetadata {
  const attemptFinishedAt = input.finishedAt ?? null;
  const finishedAt = input.completed ? attemptFinishedAt : null;
  const automatic = input.trigger === "cron" || input.trigger === "reconcile";
  return {
    trigger: input.trigger,
    scheduledAt: input.scheduledAt,
    lastStartedAt: input.startedAt,
    lastCompletedAt: finishedAt ?? input.previous?.lastCompletedAt ?? null,
    firstAutomaticCompletedAt: automatic && finishedAt
      ? input.previous?.firstAutomaticCompletedAt ?? finishedAt
      : input.previous?.firstAutomaticCompletedAt ?? null,
    lastAutomaticCompletedAt: automatic && finishedAt
      ? finishedAt
      : input.previous?.lastAutomaticCompletedAt ?? null,
    lastManualCompletedAt: input.trigger === "manual" && attemptFinishedAt
      ? attemptFinishedAt
      : input.previous?.lastManualCompletedAt ?? null,
  };
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

const CALENDAR_DAY_TIMES: Array<[Extract<DailyJobKey, "tier1-rss-prefetch" | "tier2-news-prefetch" | "morning-brief">, string]> = [
  ["tier1-rss-prefetch", "06:50"],
  ["tier2-news-prefetch", "06:55"],
  ["morning-brief", "07:15"],
];

const MARKET_SESSION_TIMES: Array<[Exclude<DailyJobKey,
  | "tier1-rss-prefetch"
  | "tier2-news-prefetch"
  | "morning-brief"
  | "new-high-bootstrap"
  | "history-backfill"
>, string]> = [
  ["breadth-09:25", "09:25"],
  ["breadth-10:00", "10:00"],
  ["breadth-11:00", "11:00"],
  ["breadth-13:00", "13:00"],
  ["breadth-14:00", "14:00"],
  ["breadth-15:00", "15:00"],
  ["etf-metrics-refresh", "15:30"],
  ["close-review", "16:10"],
];

export function expectedDailyJobs(
  tradeDate: string,
  options: { marketSession?: boolean } = {},
): Array<{ key: DailyJobKey; expectedAt: string }> {
  const timedJobs = [
    ...CALENDAR_DAY_TIMES,
    ...(options.marketSession === false ? [] : MARKET_SESSION_TIMES),
  ];
  return [
    ...timedJobs.map(([key, time]) => ({
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
      status=CASE
        WHEN job_checkpoints.status = 'complete' AND excluded.status <> 'complete'
        THEN job_checkpoints.status ELSE excluded.status END,
      attempt=excluded.attempt, expected_at=excluded.expected_at,
      started_at=CASE
        WHEN job_checkpoints.status = 'complete' AND excluded.status <> 'complete'
        THEN job_checkpoints.started_at ELSE excluded.started_at END,
      finished_at=CASE
        WHEN job_checkpoints.status = 'complete' AND excluded.status <> 'complete'
        THEN job_checkpoints.finished_at ELSE excluded.finished_at END,
      next_retry_at=CASE
        WHEN job_checkpoints.status = 'complete' AND excluded.status <> 'complete'
        THEN job_checkpoints.next_retry_at ELSE excluded.next_retry_at END,
      message=CASE
        WHEN job_checkpoints.status = 'complete' AND excluded.status <> 'complete'
        THEN job_checkpoints.message ELSE excluded.message END,
      result_json=excluded.result_json,
      updated_at=excluded.updated_at`,
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

function breadthRetryAtForAttempt(now: Date, attempt: number): string {
  const delays = [30, 60, 120];
  const delaySeconds = delays[Math.min(Math.max(attempt - 1, 0), delays.length - 1)];
  return new Date(now.getTime() + delaySeconds * 1_000).toISOString();
}

export function nextRetryAtForCheckpoint(
  key: DailyJobKey,
  status: CheckpointStatus,
  now: Date,
  attempt: number,
): string | null {
  if (status === "complete") return null;
  if (key.startsWith("breadth-")) {
    return breadthRetryAtForAttempt(now, attempt);
  }
  // The external scheduler has dedicated five-minute recovery ticks through
  // 07:55, leaving 07:50/07:55 for the verified-evidence finalization path.
  // Keep morning-brief retries aligned with them; the runner only regenerates
  // failed or missing modules, so completed content is never charged twice.
  if (key === "morning-brief") {
    return new Date(now.getTime() + 5 * 60_000).toISOString();
  }
  if (
    status === "partial"
    && (key === "new-high-bootstrap" || key === "etf-metrics-refresh" || key === "history-backfill")
  ) {
    return new Date(now.getTime() + 5 * 60_000).toISOString();
  }
  return retryAtForAttempt(now, attempt);
}
