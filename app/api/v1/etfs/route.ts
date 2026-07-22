import { authorizeApi } from "../../../auth-guard";
import { demoEtfs } from "../../../../lib/data/demo";
import { createEastmoneyProvider } from "../../../../lib/data/eastmoney";
import { ETF_CATEGORIES, queryEtfs, type EtfCategory, type EtfQuery, type EtfSortField } from "../../../../lib/etf/catalog";

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
    const source = process.env.NODE_ENV === "development" ? demoEtfs : await createEastmoneyProvider().getEtfs(new Date().toISOString().slice(0, 10));
    return Response.json({ ...queryEtfs(source, query), source: process.env.NODE_ENV === "development" ? "demo" : "东方财富" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "ETF data failed", items: [], nextCursor: null, total: 0 }, { status: 502 });
  }
}
