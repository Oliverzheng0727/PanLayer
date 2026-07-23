import { authorizeApi } from "../../../../auth-guard";
import { demoEtfs } from "../../../../../lib/data/demo";
import { buildEtfCategoryCounts } from "../../../../../lib/etf/catalog";
import { loadLiveEtfCatalog } from "../../../../../lib/etf/live-catalog";

export async function GET() {
  const denied = await authorizeApi();
  if (denied) return denied;
  try {
    const etfs = await loadLiveEtfCatalog();
    return Response.json({ categories: buildEtfCategoryCounts(etfs), status: "complete", source: "东方财富" });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      return Response.json({ categories: buildEtfCategoryCounts(demoEtfs), status: "partial", source: "本机演示数据" });
    }
    return Response.json({ error: error instanceof Error ? error.message : "ETF categories failed", categories: [], status: "failed" }, { status: 502 });
  }
}
