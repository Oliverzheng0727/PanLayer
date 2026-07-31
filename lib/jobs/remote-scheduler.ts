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
  return job.type !== "daily-new-high-refresh"
    && job.type !== "new-high-bootstrap"
    && job.type !== "history-contribution-bootstrap"
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
  // Recovery ticks such as 19:17 must not be rounded down and mistaken for
  // the deliberately assigned 19:15 history-contribution slot.
  const exactJob = jobForBeijingTime(time);
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
  const scheduledJob = jobForBeijingTime(time);
  const exactJob = marketSession
    || (scheduledJob && [
      "tier1-rss-prefetch",
      "tier2-news-prefetch",
      "morning-brief",
      "new-high-bootstrap",
      "history-contribution-bootstrap",
      "history-backfill",
    ].includes(scheduledJob.type))
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
    job.type === "daily-new-high-refresh"
    || job.type === "new-high-bootstrap"
    || job.type === "history-contribution-bootstrap"
    || job.type === "etf-metrics-refresh"
    || job.type === "history-backfill"
  );
  const critical = candidates.filter((job) => !isContinuous(job));
  if (!exactJob) {
    const currentMinute = hour * 60 + minute;
    const priority = (job: ScheduledJob) => {
      if (job.type === "close-review") return 3;
      if (job.type === "breadth") {
        const [jobHour, jobMinute] = job.time.split(":").map(Number);
        const ageMinutes = currentMinute - (jobHour * 60 + jobMinute);
        // Dedicated +1/+2 minute recovery calls should preserve their market
        // snapshot, but an old 09:25 retry must not starve the morning brief.
        return ageMinutes >= 0 && ageMinutes <= 5 ? 2 : 0;
      }
      return job.type === "morning-brief" ? 1 : 0;
    };
    critical.sort((left, right) => priority(right) - priority(left));
  }
  const continuous = candidates
    .filter(isContinuous)
    .sort((left, right) => left.type.localeCompare(right.type));
  const exactContinuous = exactJob && isContinuous(exactJob)
    ? continuous.find((job) => scheduledJobKey(job) === scheduledJobKey(exactJob))
    : null;
  // Preserve deliberately assigned background slots so baseline and history
  // work cannot be starved by a long daily refresh.
  if (exactContinuous) {
    return critical.length > 0 ? [critical[0], exactContinuous] : [exactContinuous];
  }
  // A partial daily refresh can move stale states into the rebuild queue. If
  // it then owns every recovery tick, the bootstrap job that repairs those
  // states never runs and daily coverage remains stuck at zero. Alternate the
  // two finite batches while both are due; exact evening background slots are
  // still preserved above.
  const dailyNewHighRefresh = continuous.find((job) => job.type === "daily-new-high-refresh");
  if (dailyNewHighRefresh) {
    const newHighBootstrap = continuous.find((job) => job.type === "new-high-bootstrap");
    const selected = newHighBootstrap && Math.floor(minute / 5) % 2 === 0
      ? newHighBootstrap
      : dailyNewHighRefresh;
    return critical.length > 0 ? [critical[0], selected] : [selected];
  }
  if (continuous.length === 0) return critical.slice(0, 2);
  const tick = Math.floor(now.getTime() / (5 * 60_000));
  const selectedContinuous = continuous[tick % continuous.length];
  if (critical.length === 0) return [selectedContinuous];

  return [
    critical[0],
    selectedContinuous,
  ];
}
