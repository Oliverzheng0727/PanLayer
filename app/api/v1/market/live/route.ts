import { authorizeApi } from "../../../../auth-guard";
import { loadLiveMarketSnapshot } from "../../../../../lib/live/live-market";
import { loadExpectedSymbols } from "../../../../../lib/jobs/runner";

export async function GET() {
  const denied = await authorizeApi();
  if (denied) return denied;
  try {
    let expectedSymbols: string[] = [];
    try {
      const { env } = await import("cloudflare:workers");
      if (env.DB) expectedSymbols = await loadExpectedSymbols(env.DB as D1Database);
    } catch {
      expectedSymbols = [];
    }
    return Response.json(await loadLiveMarketSnapshot(new Date(), expectedSymbols));
  } catch (error) {
    return Response.json({
      breadth: null,
      source: "东方财富 / 新浪 / 腾讯",
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
