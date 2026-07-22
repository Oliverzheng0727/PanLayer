import { authorizeApi } from "../../../../../auth-guard";
import { demoHighDetailsByDate } from "../../../../../../lib/data/demo";
import { readHighDetails } from "../../../../../../lib/data/repository";
import { parseHighDetailQuery, queryHighDetails } from "../../../../../../lib/history/high-details";

export async function GET(request: Request, { params }: { params: Promise<{ date: string }> }) {
  const denied = await authorizeApi();
  if (denied) return denied;
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "invalid date" }, { status: 400 });
  try {
    const query = parseHighDetailQuery(new URL(request.url).searchParams);
    const stored = await readHighDetails(date);
    const items = stored.length ? stored : process.env.NODE_ENV === "development" ? (demoHighDetailsByDate[date] ?? []) : [];
    return Response.json({ date, type: query.type, items: queryHighDetails(items, query), source: stored.length ? "database" : "demo" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "invalid high detail query" }, { status: 400 });
  }
}
