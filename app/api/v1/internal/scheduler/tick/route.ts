import {
  executeRemoteSchedulerTick,
  isValidSchedulerAuthorization,
} from "../../../../../../lib/jobs/remote-scheduler";
import { runPanLayerJob } from "../../../../../../lib/jobs/runner";

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
  const result = await executeRemoteSchedulerTick({
    db: runtimeEnv.DB,
    now,
    runJob: (job) => runPanLayerJob(job, now, runtimeEnv),
  });

  return Response.json({
    ok: result.jobs.every((job) => job.ok),
    date: result.date,
    jobs: result.jobs,
  }, {
    status: result.jobs.some((job) => !job.ok) ? 502 : 200,
  });
}
