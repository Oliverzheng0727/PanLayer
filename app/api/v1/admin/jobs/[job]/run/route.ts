import { authorizeAdminApi } from "../../../../../../auth-guard";
import { BRIEF_SECTION_DEFINITIONS, type BriefSectionKey } from "../../../../../../../lib/ai/morning-brief-contract";
import { runPanLayerJob } from "../../../../../../../lib/jobs/runner";
import type { ScheduledJob } from "../../../../../../../lib/jobs/schedule";

export async function POST(request: Request, context: { params: Promise<{ job: string }> }) {
  const denied = await authorizeAdminApi();
  if (denied) return denied;
  const { job } = await context.params;
  const mapped: ScheduledJob | null = job === "morning-brief" ? { type: "morning-brief" } : job === "close-review" ? { type: "close-review" } : job.startsWith("breadth-") ? { type: "breadth", time: job.slice(8) } : null;
  if (!mapped) return Response.json({ error: "unknown job" }, { status: 400 });
  const searchParams = new URL(request.url).searchParams;
  const allowedParams = new Set(["force", "section", "mode"]);
  for (const key of new Set(searchParams.keys())) {
    if (!allowedParams.has(key)) return Response.json({ error: "unknown query parameter" }, { status: 400 });
    if (searchParams.getAll(key).length !== 1) return Response.json({ error: `duplicate query parameter: ${key}` }, { status: 400 });
  }
  const forceParam = searchParams.get("force");
  if (forceParam !== null && forceParam !== "true" && forceParam !== "false") {
    return Response.json({ error: "force must be true or false" }, { status: 400 });
  }
  const section = searchParams.get("section");
  const mode = searchParams.get("mode");
  let sectionKeys: BriefSectionKey[] | undefined;
  if (section !== null) {
    if (mapped.type !== "morning-brief") {
      return Response.json({ error: "section is only supported for morning-brief" }, { status: 400 });
    }
    const definition = BRIEF_SECTION_DEFINITIONS.find((item) => item.key === section);
    if (!definition) return Response.json({ error: "unknown brief section" }, { status: 400 });
    sectionKeys = [definition.key];
  }
  if (mode !== null) {
    if (mapped.type !== "morning-brief") return Response.json({ error: "mode is only supported for morning-brief" }, { status: 400 });
    if (mode !== "failed") return Response.json({ error: "unknown brief mode" }, { status: 400 });
    if (section !== null || forceParam !== null) return Response.json({ error: "mode=failed cannot be combined with section or force" }, { status: 400 });
  }
  const { env } = await import("cloudflare:workers");
  try {
    const force = forceParam === "true";
    return Response.json(await runPanLayerJob(mapped, new Date(), env, { force, sectionKeys, mode: mode === "failed" ? "failed" : undefined }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
