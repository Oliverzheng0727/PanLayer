import { authorizeApi } from "../../../../auth-guard";
import { isGlobalSnapshotDate } from "../../../../../lib/data/global/query";
import { readGlobalSnapshot } from "../../../../../lib/data/repository";

export async function GET(_request: Request, { params }: { params: Promise<{ date: string }> }) {
  const denied = await authorizeApi();
  if (denied) return denied;
  const { date } = await params;
  if (!isGlobalSnapshotDate(date)) return Response.json({ error: "invalid date" }, { status: 400 });
  const snapshot = await readGlobalSnapshot(date);
  return Response.json({ date, ...snapshot, status: snapshot.raw.length ? "complete" : "unavailable" });
}
