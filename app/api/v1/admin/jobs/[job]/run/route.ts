import { authorizeAdminApi } from "../../../../../../auth-guard";
import { runPanLayerJob } from "../../../../../../../lib/jobs/runner";
import type { ScheduledJob } from "../../../../../../../lib/jobs/schedule";

export async function POST(request: Request, context: { params: Promise<{ job: string }> }) {
  const denied = await authorizeAdminApi();
  if (denied) return denied;
  const { job } = await context.params;
  const mapped: ScheduledJob | null = job === "morning-brief" ? { type: "morning-brief" } : job === "close-review" ? { type: "close-review" } : job.startsWith("breadth-") ? { type: "breadth", time: job.slice(8) } : null;
  if (!mapped) return Response.json({ error: "unknown job" }, { status: 400 });
  const { env } = await import("cloudflare:workers");
  try {
    const force = new URL(request.url).searchParams.get("force") === "true";
    return Response.json(await runPanLayerJob(mapped, new Date(), env, { force }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
