import { authorizeApi } from "../../../../../auth-guard";
import { createDemoBars, loadEtfBarsWithFallback, type Adjustment, type BarPeriod } from "../../../../../../lib/etf/bars";
import { resolveFuyaoRuntimeOptions } from "../../../../../../lib/data/fuyao-runtime";

const periods: BarPeriod[] = ["minute", "day", "week", "month"];

export async function GET(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const denied = await authorizeApi();
  if (denied) return denied;
  const { symbol } = await params;
  if (!/^\d{6}(?:\.(?:SH|SZ))?$/.test(symbol)) return Response.json({ error: "invalid market symbol" }, { status: 400 });
  const url = new URL(request.url);
  const period = (url.searchParams.get("period") ?? "day") as BarPeriod;
  const adjustment = (url.searchParams.get("adjust") ?? url.searchParams.get("adjustment") ?? "forward") as Adjustment;
  if (!periods.includes(period)) return Response.json({ error: "invalid period" }, { status: 400 });
  if (adjustment !== "none" && adjustment !== "forward") return Response.json({ error: "invalid adjustment" }, { status: 400 });

  try {
    const fuyao = await resolveFuyaoRuntimeOptions();
    const result = await loadEtfBarsWithFallback(symbol, period, adjustment, fetch, fuyao ?? undefined);
    return Response.json({
      symbol,
      period,
      adjustment: result.appliedAdjustment,
      requestedAdjustment: adjustment,
      bars: result.bars,
      source: result.source,
      status: result.status,
      marketTime: result.bars.at(-1)?.time ?? null,
      receivedAt: new Date().toISOString(),
      isStale: false,
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "development") return Response.json({ symbol, period, adjustment, requestedAdjustment: adjustment, bars: [], source: "东方财富 / 新浪财经", status: "failed", error: error instanceof Error ? error.message : "market data failed", marketTime: null, receivedAt: new Date().toISOString(), isStale: true }, { status: 502 });
    return Response.json({ symbol, period, adjustment, requestedAdjustment: adjustment, bars: createDemoBars(symbol, period), source: "本机演示行情", status: "demo", marketTime: null, receivedAt: new Date().toISOString(), isStale: true });
  }
}
