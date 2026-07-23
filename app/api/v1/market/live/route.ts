import { authorizeApi } from "../../../../auth-guard";
import { loadLiveMarketSnapshot } from "../../../../../lib/live/live-market";

export async function GET() {
  const denied = await authorizeApi();
  if (denied) return denied;
  try {
    return Response.json(await loadLiveMarketSnapshot());
  } catch (error) {
    return Response.json({
      breadth: null,
      source: "东方财富 / 腾讯",
      status: "failed",
      message: error instanceof Error ? error.message : "实时市场数据失败",
      universeSize: 0,
      coveragePct: 0,
      marketTime: null,
      receivedAt: new Date().toISOString(),
      isStale: true,
    }, { status: 502 });
  }
}
