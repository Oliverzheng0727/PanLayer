import { authorizeApi } from "../../../../auth-guard";
import { loadLiveMarketSnapshot } from "../../../../../lib/live/live-market";
import { loadExpectedSymbols } from "../../../../../lib/jobs/runner";
import { readIntradayBreadthTimeline } from "../../../../../lib/data/repository";
import { beijingDateParts } from "../../../../../lib/jobs/schedule";
import { resolveFuyaoRuntimeOptions } from "../../../../../lib/data/fuyao-runtime";

export async function GET() {
  const denied = await authorizeApi();
  if (denied) return denied;
  const now = new Date();
  const { date } = beijingDateParts(now);
  const intraday = await readIntradayBreadthTimeline(date, now);
  try {
    let expectedSymbols: string[] = [];
    try {
      const { env } = await import("cloudflare:workers");
      if (env.DB) expectedSymbols = await loadExpectedSymbols(env.DB as D1Database);
    } catch {
      expectedSymbols = [];
    }
    const fuyao = await resolveFuyaoRuntimeOptions();
    return Response.json({
      ...await loadLiveMarketSnapshot(now, expectedSymbols, fuyao ?? undefined),
      intraday,
    });
  } catch (error) {
    return Response.json({
      breadth: null,
      source: "东方财富 / 新浪 / 扶摇 Fuyao / 腾讯",
      status: "failed",
      message: error instanceof Error ? error.message : "实时市场数据失败",
      universeSize: 0,
      coveragePct: 0,
      marketTime: null,
      receivedAt: new Date().toISOString(),
      isStale: true,
      intraday,
    }, { status: 502 });
  }
}
