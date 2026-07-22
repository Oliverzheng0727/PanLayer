import { authorizeApi } from "../../../../../auth-guard";
import { aggregateBars, createDemoBars, fetchEastmoneyDailyBars, fetchEastmoneyMinuteBars, type Adjustment, type BarPeriod } from "../../../../../../lib/etf/bars";

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
    const daily = period === "minute" ? [] : await fetchEastmoneyDailyBars(symbol, adjustment);
    const bars = period === "minute" ? await fetchEastmoneyMinuteBars(symbol) : period === "day" ? daily : aggregateBars(daily, period);
    if (bars.length === 0) throw new Error("empty market bars");
    return Response.json({ symbol, period, adjustment, bars, source: "东方财富", status: "complete" });
  } catch (error) {
    if (process.env.NODE_ENV !== "development") return Response.json({ symbol, period, adjustment, bars: [], source: "东方财富", status: "failed", error: error instanceof Error ? error.message : "market data failed" }, { status: 502 });
    return Response.json({ symbol, period, adjustment, bars: createDemoBars(symbol, period), source: "本机演示行情", status: "demo" });
  }
}
