import { authorizeApi } from "../../../auth-guard";
import { demoEtfs } from "../../../../lib/data/demo";
import { ETF_CATEGORIES, queryEtfs, type EtfCategory, type EtfQuery, type EtfSortField } from "../../../../lib/etf/catalog";
import { loadLiveEtfCatalogEnvelope } from "../../../../lib/etf/live-catalog";
import { createFuyaoMcpClient } from "../../../../lib/data/fuyao-mcp";
import { resolveFuyaoRuntimeOptions } from "../../../../lib/data/fuyao-runtime";

const sortFields: EtfSortField[] = ["price", "pctChange", "amount", "averageAmount20", "scale", "turnoverRate"];

export async function GET(request: Request) {
  const denied = await authorizeApi();
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const category = (params.get("category") ?? "全部") as EtfCategory;
  const sort = (params.get("sort") ?? "averageAmount20") as EtfSortField;
  const order = params.get("order") ?? "desc";
  if (!ETF_CATEGORIES.includes(category)) return Response.json({ error: "invalid ETF category" }, { status: 400 });
  if (!sortFields.includes(sort)) return Response.json({ error: "invalid ETF sort" }, { status: 400 });
  if (order !== "asc" && order !== "desc") return Response.json({ error: "invalid ETF order" }, { status: 400 });
  const query: EtfQuery = {
    category,
    query: (params.get("query") ?? "").trim(),
    sort,
    order,
    cursor: Math.max(0, Number(params.get("cursor") ?? 0) || 0),
    limit: Math.min(100, Math.max(1, Number(params.get("limit") ?? 30) || 30)),
  };
  try {
    const catalog = await loadLiveEtfCatalogEnvelope();
    let items = catalog.items;
    let source = catalog.source;
    if (query.query) {
      const fuyaoOptions = await resolveFuyaoRuntimeOptions();
      if (fuyaoOptions) {
        const matched = await createFuyaoMcpClient(fuyaoOptions)
          .searchEtfSnapshots(query.query, Math.min(10, query.limit))
          .catch(() => []);
        if (matched.length > 0) {
          items = [...new Map([...matched, ...items].map((item) => [item.symbol, item])).values()];
          source = `${source} / 扶摇 Fuyao ETF代码库`;
        }
      }
    }
    return Response.json({ ...queryEtfs(items, query), source, status: catalog.status, receivedAt: catalog.receivedAt, marketTime: catalog.marketTime, isStale: catalog.isStale });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      return Response.json({ ...queryEtfs(demoEtfs, query), source: "本机演示数据", status: "partial", receivedAt: new Date().toISOString(), marketTime: null, isStale: true });
    }
    return Response.json({ error: error instanceof Error ? error.message : "ETF data failed", items: [], nextCursor: null, total: 0, source: "东方财富", status: "failed", receivedAt: new Date().toISOString(), marketTime: null, isStale: true }, { status: 502 });
  }
}
