import { authorizeApi } from "../../../../auth-guard";
import { readBrief } from "../../../../../lib/data/repository";

export async function GET(_request: Request, context: { params: Promise<{ date: string }> }) {
  const denied = await authorizeApi();
  if (denied) return denied;
  const { date } = await context.params;
  const brief = await readBrief(date);
  return Response.json({
    brief,
    status: brief?.status ?? "unavailable",
    demo: false,
  });
}
