import {
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
  status: "running" | "complete" | "failed";
  message: string;
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
}: {
  db: D1Database;
  now: Date;
  runJob: (job: ScheduledJob) => Promise<{ ok: boolean; message: string }>;
  loadCheckpoints?: (db: D1Database, date: string) => Promise<JobCheckpoint[]>;
}): Promise<{
  date: string;
  jobs: Array<{ job: string; ok: boolean; message: string }>;
}> {
  const { date } = beijingDateParts(now);
  await recordSchedulerHeartbeat(db, {
    receivedAt: now.toISOString(),
    status: "running",
    message: "scheduler tick started",
  }).catch(() => undefined);
  const checkpoints = await loadCheckpoints(db, date).catch(() => []);
  const planned = planRemoteSchedulerJobs({ now, checkpoints });
  const results: Array<{ job: string; ok: boolean; message: string }> = [];
  for (const job of planned) {
    try {
      const result = await runJob(job);
      results.push({ job: scheduledJobKey(job), ...result });
    } catch (error) {
      results.push({
        job: scheduledJobKey(job),
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await recordSchedulerHeartbeat(db, {
    receivedAt: new Date().toISOString(),
    status: results.some((result) => !result.ok) ? "failed" : "complete",
    message: results.length > 0
      ? results.map((result) => `${result.job}:${result.ok ? "ok" : "failed"}`).join(",")
      : "idle",
  }).catch(() => undefined);
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

  const candidates = [...(exactJob ? [exactJob] : []), ...catchUpJobs]
    .filter((job, index, all) => (
      all.findIndex((candidate) => scheduledJobKey(candidate) === scheduledJobKey(job)) === index
    ))
    .filter((job) => {
      const checkpoint = checkpointByKey.get(scheduledJobKey(job));
      return !checkpoint || isCheckpointRetryable(checkpoint, now);
    });
  const isContinuous = (job: ScheduledJob) => (
    job.type === "new-high-bootstrap" || job.type === "etf-metrics-refresh"
  );
  const critical = candidates.filter((job) => !isContinuous(job));
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
