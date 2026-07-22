import { authorizeApi } from "../../../../../../auth-guard";
import { runPanLayerJob } from "../../../../../../../lib/jobs/runner";
import type { ScheduledJob } from "../../../../../../../lib/jobs/schedule";

export async function POST(_request: Request, context: { params: Promise<{ job: string }> }) {
  const denied = await authorizeApi();
  if (denied) return denied;
  const { job } = await context.params;
  const mapped: ScheduledJob | null = job === "morning-brief" ? { type: "morning-brief" } : job === "close-review" ? { type: "close-review" } : job.startsWith("breadth-") ? { type: "breadth", time: job.slice(8) } : null;
  if (!mapped) return Response.json({ error: "unknown job" }, { status: 400 });
  const { env } = await import("cloudflare:workers");
  try {
    return Response.json(await runPanLayerJob(mapped, new Date(), env));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
