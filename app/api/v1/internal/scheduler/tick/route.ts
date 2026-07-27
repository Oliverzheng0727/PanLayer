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
  FUYAO_API_KEY?: string;
  FUYAO_MCP_BASE_URL?: string;
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

  const scheduledAt = Number(request.headers.get("x-panlayer-scheduled-time"));
  const now = Number.isFinite(scheduledAt) && scheduledAt > 0
    ? new Date(scheduledAt)
    : new Date();
  const providerHeader = request.headers.get("x-panlayer-scheduler");
  const provider = providerHeader === "cloudflare" || providerHeader === "github" || providerHeader === "worker"
    ? providerHeader
    : "unknown";
  const result = await executeRemoteSchedulerTick({
    db: runtimeEnv.DB,
    now,
    runJob: (job, context) => runPanLayerJob(job, now, runtimeEnv, { trigger: context.trigger }),
    provider,
  });

  const failed = result.jobs.some((job) => !job.ok || job.status === "failed");
  const partial = result.jobs.some((job) => job.status === "partial" || job.status === "running");
  return Response.json({
    ok: !failed,
    status: failed ? "failed" : partial ? "partial" : "complete",
    date: result.date,
    jobs: result.jobs,
  }, {
    status: failed ? 502 : partial ? 207 : 200,
  });
}
