import { authorizeApi } from "../../../../auth-guard";
import { demoBrief } from "../../../../../lib/data/demo";
import { readBrief } from "../../../../../lib/data/repository";

export async function GET(_request: Request, context: { params: Promise<{ date: string }> }) {
  const denied = await authorizeApi();
  if (denied) return denied;
  const { date } = await context.params;
  const brief = await readBrief(date);
  return Response.json({ brief: brief ?? { ...demoBrief, date }, demo: !brief });
}
