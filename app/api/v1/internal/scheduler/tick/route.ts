import {
  executeRemoteSchedulerTick,
  isValidSchedulerAuthorization,
  normalizeSchedulerProvider,
} from "../../../../../../lib/jobs/remote-scheduler";
import {
  prepareMorningBriefRegeneration,
  runPanLayerJob,
} from "../../../../../../lib/jobs/runner";
import { beijingDateParts } from "../../../../../../lib/jobs/schedule";

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
  const provider = normalizeSchedulerProvider(request.headers.get("x-panlayer-scheduler"));
  const action = request.headers.get("x-panlayer-action");
  if (action === "regenerate-morning-brief") {
    const prepared = await prepareMorningBriefRegeneration(runtimeEnv.DB, now);
    const firstModule = await runPanLayerJob(
      { type: "morning-brief" },
      now,
      runtimeEnv,
      { trigger: "manual" },
    );
    return Response.json({
      ok: firstModule.ok,
      status: firstModule.status,
      date: prepared.date,
      sectionsMarked: prepared.sectionsMarked,
      message: "七模块重生成已启动；本次先串行生成一个模块，其余模块由后续调度继续生成",
      firstModule,
    }, {
      status: firstModule.status === "failed" ? 502 : firstModule.status === "partial" ? 207 : 200,
    });
  }
  if (action === "continue-morning-brief") {
    const nextModule = await runPanLayerJob(
      { type: "morning-brief" },
      now,
      runtimeEnv,
      { trigger: "manual" },
    );
    return Response.json({
      ok: nextModule.ok,
      status: nextModule.status,
      date: beijingDateParts(now).date,
      message: "七模块串行生成已继续推进一个模块",
      nextModule,
    }, {
      status: nextModule.status === "failed" ? 502 : nextModule.status === "partial" ? 207 : 200,
    });
  }
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
