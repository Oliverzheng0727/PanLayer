import { authorizeApi } from "../../../auth-guard";
import { readHistory } from "../../../../lib/data/repository";
import { parseHistoryQuery, queryHistoryRows } from "../../../../lib/history/query";

export async function GET(request: Request) {
  const denied = await authorizeApi();
  if (denied) return denied;
  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get("from") ?? "2000-01-01";
  const to = url.searchParams.get("to") ?? today;
  try {
    const query = parseHistoryQuery(url.searchParams);
    const page = queryHistoryRows(await readHistory(from, to), query);
    return Response.json(page);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "invalid history query" }, { status: 400 });
  }
}
