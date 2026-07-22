import { authorizeApi } from "../../../../auth-guard";
import { demoReview } from "../../../../../lib/data/demo";
import { readReview } from "../../../../../lib/data/repository";

export async function GET(_request: Request, context: { params: Promise<{ date: string }> }) {
  const denied = await authorizeApi();
  if (denied) return denied;
  const { date } = await context.params;
  const review = await readReview(date);
  return Response.json({ review: review ?? { ...demoReview, date }, demo: !review });
}
