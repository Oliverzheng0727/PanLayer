import {
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
  if (!isChinaTradingWeekday(now)) return [];
  const { date, time } = beijingDateParts(now);
  const exactJob = jobForBeijingTime(time);
  const catchUpJobs = planCatchUpJobs({
    tradeDate: date,
    now,
    checkpoints,
  });

  return [...(exactJob ? [exactJob] : []), ...catchUpJobs]
    .filter((job, index, all) => (
      all.findIndex((candidate) => scheduledJobKey(candidate) === scheduledJobKey(job)) === index
    ))
    .slice(0, 2);
}
