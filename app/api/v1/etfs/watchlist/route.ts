import { authorizeApi } from "../../../../auth-guard";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { demoEtfs } from "../../../../../lib/data/demo";
import { ETF_CATEGORIES } from "../../../../../lib/etf/catalog";
import { loadLiveEtfCatalog } from "../../../../../lib/etf/live-catalog";
import {
  deleteWatchlistItem,
  listWatchlistItems,
  saveWatchlistItem,
  updateWatchlistCategory,
} from "../../../../../lib/etf/watchlist-repository";
import {
  mergeWatchlistEtfs,
  normalizeEtfSymbol,
  normalizeUserEmail,
} from "../../../../../lib/etf/watchlist";

async function requestContext(): Promise<{ db: D1Database; userEmail: string } | Response> {
  const denied = await authorizeApi();
  if (denied) return denied;
  const user = await getChatGPTUser();
  const userEmail = normalizeUserEmail(
    user?.email ?? (process.env.NODE_ENV === "development" ? "local@panlayer.dev" : ""),
  );
  if (!userEmail) return Response.json({ error: "authentication required" }, { status: 401 });
  try {
    const { env } = await import("cloudflare:workers");
    if (!env.DB) throw new Error("D1 unavailable");
    return { db: env.DB, userEmail };
  } catch {
    return Response.json({ error: "ETF 自选存储暂不可用" }, { status: 503 });
  }
}

async function liveCatalog() {
  try {
    return await loadLiveEtfCatalog();
  } catch {
    if (process.env.NODE_ENV === "development") return demoEtfs;
    throw new Error("ETF 行情源暂不可用");
  }
}

export async function GET() {
  const context = await requestContext();
  if (context instanceof Response) return context;
  const saved = await listWatchlistItems(context.db, context.userEmail);
  let live = [];
  let status: "complete" | "partial" = "complete";
  try {
    live = await liveCatalog();
  } catch {
    status = "partial";
  }
  return Response.json({ items: mergeWatchlistEtfs(live, saved), status, source: "东方财富 · 用户自选" });
}

export async function POST(request: Request) {
  const context = await requestContext();
  if (context instanceof Response) return context;
  const body = await request.json().catch(() => ({})) as { symbol?: string };
  const symbol = normalizeEtfSymbol(body.symbol ?? "");
  if (!symbol) return Response.json({ error: "请输入有效的六位 ETF 代码" }, { status: 400 });
  const catalog = await liveCatalog().catch(() => []);
  const item = catalog.find((candidate) => candidate.symbol === symbol);
  if (!item) return Response.json({ error: "未查询到该 ETF，请确认代码后重试" }, { status: 404 });
  const now = new Date().toISOString();
  await saveWatchlistItem(context.db, {
    userEmail: context.userEmail,
    symbol: item.symbol,
    name: item.name,
    exchange: item.exchange,
    category: item.category,
    createdAt: now,
    updatedAt: now,
  });
  return Response.json({ item, source: "东方财富" }, { status: 201 });
}

export async function PATCH(request: Request) {
  const context = await requestContext();
  if (context instanceof Response) return context;
  const body = await request.json().catch(() => ({})) as { symbol?: string; category?: string };
  const symbol = normalizeEtfSymbol(body.symbol ?? "");
  const category = String(body.category ?? "");
  if (!symbol || category === "全部" || !ETF_CATEGORIES.includes(category as (typeof ETF_CATEGORIES)[number])) {
    return Response.json({ error: "无效的 ETF 或分类" }, { status: 400 });
  }
  await updateWatchlistCategory(context.db, context.userEmail, symbol, category, new Date().toISOString());
  return Response.json({ symbol, category });
}

export async function DELETE(request: Request) {
  const context = await requestContext();
  if (context instanceof Response) return context;
  const symbol = normalizeEtfSymbol(new URL(request.url).searchParams.get("symbol") ?? "");
  if (!symbol) return Response.json({ error: "无效的 ETF 代码" }, { status: 400 });
  await deleteWatchlistItem(context.db, context.userEmail, symbol);
  return Response.json({ symbol, deleted: true });
}
