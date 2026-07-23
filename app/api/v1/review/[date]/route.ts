import { authorizeApi } from "../../../../auth-guard";
import { demoReview } from "../../../../../lib/data/demo";
import { readReview } from "../../../../../lib/data/repository";
import { createUnavailableReview } from "../../../../../lib/data/unavailable";

export async function GET(_request: Request, context: { params: Promise<{ date: string }> }) {
  const denied = await authorizeApi();
  if (denied) return denied;
  const { date } = await context.params;
  const review = await readReview(date);
  const isDevelopment = process.env.NODE_ENV === "development";
  return Response.json({
    review: review ?? (isDevelopment ? { ...demoReview, date } : createUnavailableReview(date)),
    demo: !review && isDevelopment,
  });
}
