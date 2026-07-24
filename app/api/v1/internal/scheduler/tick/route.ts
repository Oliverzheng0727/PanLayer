import { readDailyJobCheckpoints, scheduledJobKey } from "../../../../../../lib/jobs/checkpoints";
import { planRemoteSchedulerJobs, isValidSchedulerAuthorization } from "../../../../../../lib/jobs/remote-scheduler";
import { runPanLayerJob } from "../../../../../../lib/jobs/runner";
import { beijingDateParts, isChinaTradingWeekday } from "../../../../../../lib/jobs/schedule";

interface SchedulerEnv {
  DB: D1Database;
  PANLAYER_CRON_SECRET?: string;
  DASHSCOPE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  FIRECRAWL_API_KEY?: string;
  FIRECRAWL_API_URL?: string;
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const runtimeEnv = env as unknown as SchedulerEnv;
  if (!isValidSchedulerAuthorization(
    request.headers.get("authorization"),
    runtimeEnv.PANLAYER_CRON_SECRET,
  )) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!runtimeEnv.DB) {
    return Response.json({ error: "DB binding is unavailable" }, { status: 503 });
  }

  const now = new Date();
  if (!isChinaTradingWeekday(now)) {
    return Response.json({ ok: true, skipped: "non-trading weekday", jobs: [] });
  }

  const { date } = beijingDateParts(now);
  const checkpoints = await readDailyJobCheckpoints(runtimeEnv.DB, date).catch(() => []);
  const jobs = planRemoteSchedulerJobs({ now, checkpoints });
  const results = [];
  for (const job of jobs) {
    try {
      const result = await runPanLayerJob(job, now, runtimeEnv);
      results.push({ job: scheduledJobKey(job), ...result });
    } catch (error) {
      results.push({
        job: scheduledJobKey(job),
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return Response.json({
    ok: results.every((result) => result.ok),
    date,
    jobs: results,
  }, {
    status: results.some((result) => !result.ok) ? 502 : 200,
  });
}
