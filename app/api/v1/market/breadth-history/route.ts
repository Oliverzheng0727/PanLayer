import { authorizeApi } from "../../../../auth-guard";
import { readIntradayBreadthHistory } from "../../../../../lib/data/repository";

export async function GET(request: Request) {
  const denied = await authorizeApi();
  if (denied) return denied;

  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 30);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(120, Math.max(5, Math.trunc(requestedLimit)))
    : 30;
  const now = new Date();
  const timelines = await readIntradayBreadthHistory(limit, now);

  return Response.json(
    {
      timelines,
      count: timelines.length,
      receivedAt: now.toISOString(),
    },
    {
      headers: {
        "Cache-Control": "private, max-age=60",
      },
    },
  );
}
