import { authorizeApi } from "../../../auth-guard";
import { readHistory } from "../../../../lib/data/repository";

export async function GET(request: Request) {
  const denied = await authorizeApi();
  if (denied) return denied;
  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get("from") ?? today.slice(0, 8) + "01";
  const to = url.searchParams.get("to") ?? today;
  return Response.json({ history: await readHistory(from, to) });
}
