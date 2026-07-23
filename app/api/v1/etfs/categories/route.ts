import { authorizeApi } from "../../../../auth-guard";
import { demoEtfs } from "../../../../../lib/data/demo";
import { buildEtfCategoryCounts } from "../../../../../lib/etf/catalog";
import { loadLiveEtfCatalogEnvelope } from "../../../../../lib/etf/live-catalog";

export async function GET() {
  const denied = await authorizeApi();
  if (denied) return denied;
  try {
    const catalog = await loadLiveEtfCatalogEnvelope();
    return Response.json({ categories: buildEtfCategoryCounts(catalog.items), status: catalog.status, source: catalog.source, receivedAt: catalog.receivedAt, marketTime: catalog.marketTime, isStale: catalog.isStale });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      return Response.json({ categories: buildEtfCategoryCounts(demoEtfs), status: "partial", source: "本机演示数据", receivedAt: new Date().toISOString(), marketTime: null, isStale: true });
    }
    return Response.json({ error: error instanceof Error ? error.message : "ETF categories failed", categories: [], status: "failed", source: "东方财富", receivedAt: new Date().toISOString(), marketTime: null, isStale: true }, { status: 502 });
  }
}
