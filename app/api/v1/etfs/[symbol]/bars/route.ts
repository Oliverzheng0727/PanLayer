import { authorizeApi } from "../../../../../auth-guard";
import { loadEtfBarsWithFallback, type Adjustment, type BarPeriod } from "../../../../../../lib/etf/bars";
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
      requestedPeriod: period,
      appliedPeriod: result.appliedPeriod,
      adjustment: result.appliedAdjustment,
      requestedAdjustment: adjustment,
      appliedAdjustment: result.appliedAdjustment,
      bars: result.bars,
      source: result.source,
      fallbackSource: result.fallbackSource,
      status: result.status,
      marketTime: result.bars.at(-1)?.time ?? null,
      receivedAt: new Date().toISOString(),
      isStale: false,
      message: result.message,
    }, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "market data failed";
    return Response.json({
      symbol,
      period,
      requestedPeriod: period,
      appliedPeriod: null,
      adjustment,
      requestedAdjustment: adjustment,
      appliedAdjustment: null,
      bars: [],
      source: period === "minute" ? "东方财富 / 新浪财经" : "扶摇 Fuyao / 东方财富 / 百度股市通 / 新浪财经",
      fallbackSource: null,
      status: "failed",
      error: message,
      message: "所有可用K线数据源均获取失败",
      marketTime: null,
      receivedAt: new Date().toISOString(),
      isStale: true,
    }, {
      status: 502,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  }
}
