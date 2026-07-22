import { authorizeApi } from "../../../../auth-guard";
import { demoEtfs } from "../../../../../lib/data/demo";
import { ETF_CATEGORIES } from "../../../../../lib/etf/catalog";

export async function GET() {
  const denied = await authorizeApi();
  if (denied) return denied;
  const categories = ETF_CATEGORIES.map((category) => ({ category, count: category === "全部" ? demoEtfs.length : demoEtfs.filter((item) => item.category === category).length }));
  return Response.json({ categories, status: "demo" });
}
