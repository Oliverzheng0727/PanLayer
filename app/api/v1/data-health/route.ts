import { authorizeApi } from "../../../auth-guard";
import { readDataHealth } from "../../../../lib/data/repository";

export async function GET() {
  const denied = await authorizeApi();
  if (denied) return denied;
  return Response.json(await readDataHealth());
}
