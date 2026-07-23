import { authorizeApi } from "../../../../auth-guard";
import { readNewHighProgress } from "../../../../../lib/data/repository";
import { latestCompletedReviewDate } from "../../../../../lib/jobs/schedule";

export async function GET() {
  const denied = await authorizeApi();
  if (denied) return denied;
  return Response.json(await readNewHighProgress(latestCompletedReviewDate(new Date())));
}
