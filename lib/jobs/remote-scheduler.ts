import {
  expectedDailyJobs,
  isCheckpointRetryable,
  readDailyJobCheckpoints,
  scheduledJobKey,
  type JobCheckpoint,
} from "./checkpoints";
import { planCatchUpJobs } from "./reconcile";
import {
  beijingDateParts,
  isChinaTradingWeekday,
  jobForBeijingTime,
  type ScheduledJob,
} from "./schedule";

export interface SchedulerHeartbeat {
  receivedAt: string;
  provider: "cloudflare" | "github" | "worker" | "unknown";
  status: "running" | "partial" | "complete" | "failed";
  message: string;
}

export type SchedulerJobStatus = "running" | "partial" | "complete" | "failed";
export type SchedulerExecutionTrigger = "cron" | "reconcile";

export function normalizeSchedulerProvider(
  provider: string | null | undefined,
): SchedulerHeartbeat["provider"] {
  return provider === "cloudflare" || provider === "github" || provider === "worker"
    ? provider
    : "worker";
}

export interface SchedulerRunContext {
  trigger: SchedulerExecutionTrigger;
  scheduledAt: string;
}

export function isCriticalSchedulerJob(job: ScheduledJob): boolean {
  return job.type !== "new-high-bootstrap"
    && job.type !== "etf-metrics-refresh"
    && job.type !== "history-backfill";
}

export async function recordSchedulerHeartbeat(
  db: D1Database,
  heartbeat: SchedulerHeartbeat,
): Promise<void> {
  await db.prepare(
    `INSERT INTO bootstrap_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  ).bind(
    "scheduler-heartbeat",
    JSON.stringify(heartbeat),
    heartbeat.receivedAt,
  ).run();
}

export async function executeRemoteSchedulerTick({
  db,
  now,
  runJob,
  loadCheckpoints = readDailyJobCheckpoints,
  provider = "worker",
}: {
  db: D1Database;
  now: Date;
  runJob: (
    job: ScheduledJob,
    context: SchedulerRunContext,
  ) => Promise<{ ok: boolean; status?: SchedulerJobStatus; message: string }>;
  loadCheckpoints?: (db: D1Database, date: string) => Promise<JobCheckpoint[]>;
  provider?: SchedulerHeartbeat["provider"];
}): Promise<{
  date: string;
  jobs: Array<{ job: string; trigger: SchedulerExecutionTrigger; ok: boolean; status: SchedulerJobStatus; critical: boolean; message: string }>;
}> {
  const { date, time } = beijingDateParts(now);
  await recordSchedulerHeartbeat(db, {
    receivedAt: now.toISOString(),
    provider,
    status: "running",
    message: "scheduler tick started",
  });
  const checkpoints = await loadCheckpoints(db, date).catch(() => []);
  const planned = planRemoteSchedulerJobs({ now, checkpoints });
  const [hour, minute] = time.split(":").map(Number);
  const scheduledTime = `${String(hour).padStart(2, "0")}:${String(Math.floor(minute / 5) * 5).padStart(2, "0")}`;
  const exactJob = jobForBeijingTime(scheduledTime);
  const exactKey = exactJob ? scheduledJobKey(exactJob) : null;
  const results: Array<{
    job: string;
    trigger: SchedulerExecutionTrigger;
    ok: boolean;
    status: SchedulerJobStatus;
    critical: boolean;
    message: string;
  }> = [];
  for (const job of planned) {
    const jobKey = scheduledJobKey(job);
    const trigger: SchedulerExecutionTrigger = exactKey === jobKey ? "cron" : "reconcile";
    const scheduledAt = expectedDailyJobs(date).find((item) => item.key === jobKey)?.expectedAt
      ?? now.toISOString();
    try {
      const result = await runJob(job, { trigger, scheduledAt });
      results.push({
        job: jobKey,
        trigger,
        ok: result.ok,
        status: result.status ?? (result.ok ? "complete" : "failed"),
        critical: isCriticalSchedulerJob(job),
        message: result.message,
      });
    } catch (error) {
      results.push({
        job: jobKey,
        trigger,
        ok: false,
        status: "failed",
        critical: isCriticalSchedulerJob(job),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const heartbeatStatus = results.some((result) => !result.ok || result.status === "failed")
    ? "failed"
    : results.some((result) => result.status === "partial" || result.status === "running")
      ? "partial"
      : "complete";
  await recordSchedulerHeartbeat(db, {
    receivedAt: new Date().toISOString(),
    provider,
    status: heartbeatStatus,
    message: results.length > 0
      ? results.map((result) => `${result.job}:${result.status}`).join(",")
      : "idle",
  });
  return { date, jobs: results };
}

export function isValidSchedulerAuthorization(
  authorization: string | null,
  configuredSecret: string | undefined,
): boolean {
  const secret = String(configuredSecret ?? "");
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!secret || supplied.length !== secret.length) return false;

  let difference = 0;
  for (let index = 0; index < secret.length; index += 1) {
    difference |= secret.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}

export function planRemoteSchedulerJobs({
  now,
  checkpoints,
}: {
  now: Date;
  checkpoints: JobCheckpoint[];
}): ScheduledJob[] {
  const { date, time } = beijingDateParts(now);
  const marketSession = isChinaTradingWeekday(now);
  const [hour, minute] = time.split(":").map(Number);
  const scheduledTime = `${String(hour).padStart(2, "0")}:${String(Math.floor(minute / 5) * 5).padStart(2, "0")}`;
  const scheduledJob = jobForBeijingTime(scheduledTime);
  const exactJob = marketSession
    || (scheduledJob && ["tier1-rss-prefetch", "tier2-news-prefetch", "morning-brief"].includes(scheduledJob.type))
    ? scheduledJob
    : null;
  const catchUpJobs = planCatchUpJobs({
    tradeDate: date,
    now,
    checkpoints,
    limit: 20,
    marketSession,
  });
  const checkpointByKey = new Map(
    checkpoints
      .filter((checkpoint) => checkpoint.stage === "main")
      .map((checkpoint) => [checkpoint.key, checkpoint]),
  );
  const etfHistoryCheckpoint = checkpoints.find((checkpoint) =>
    checkpoint.key === "etf-metrics-refresh" && checkpoint.stage === "history-metrics"
  );
  const etfHistoryDue = marketSession
    && time >= "15:30"
    && etfHistoryCheckpoint
    && isCheckpointRetryable(etfHistoryCheckpoint, now);

  const candidates = [
    ...(exactJob ? [exactJob] : []),
    ...catchUpJobs,
    ...(etfHistoryDue ? [{ type: "etf-metrics-refresh" } as const] : []),
  ]
    .filter((job, index, all) => (
      all.findIndex((candidate) => scheduledJobKey(candidate) === scheduledJobKey(job)) === index
    ))
    .filter((job) => {
      const checkpoint = checkpointByKey.get(scheduledJobKey(job));
      if (job.type === "etf-metrics-refresh" && etfHistoryDue) return true;
      return !checkpoint || isCheckpointRetryable(checkpoint, now);
    });
  const isContinuous = (job: ScheduledJob) => (
    job.type === "new-high-bootstrap" || job.type === "etf-metrics-refresh"
  );
  const critical = candidates.filter((job) => !isContinuous(job));
  if (!exactJob) {
    const priority = (job: ScheduledJob) =>
      job.type === "close-review" ? 2 : job.type === "morning-brief" ? 1 : 0;
    critical.sort((left, right) => priority(right) - priority(left));
  }
  const continuous = candidates
    .filter(isContinuous)
    .sort((left, right) => left.type.localeCompare(right.type));
  if (continuous.length === 0) return critical.slice(0, 2);
  const tick = Math.floor(now.getTime() / (5 * 60_000));
  const selectedContinuous = continuous[tick % continuous.length];
  if (critical.length === 0) return continuous.slice(0, 2);

  return [
    critical[0],
    selectedContinuous,
  ];
}
