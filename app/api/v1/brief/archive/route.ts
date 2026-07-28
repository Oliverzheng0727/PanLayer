import { authorizeApi } from "../../../../auth-guard";
import { readBriefArchive } from "../../../../../lib/data/repository";
import { pruneBriefArchive } from "../../../../../lib/ai/morning-brief-archive";
import { beijingDateParts } from "../../../../../lib/jobs/schedule";

function archiveWindow(now = new Date()) {
  const to = beijingDateParts(now).date;
  const cutoff = new Date(`${to}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 92);
  return { from: cutoff.toISOString().slice(0, 10), to };
}

export async function GET() {
  const denied = await authorizeApi();
  if (denied) return denied;
  const { from, to } = archiveWindow();
  const briefs = pruneBriefArchive(await readBriefArchive(from, to), from);
  return Response.json({
    briefs,
    count: briefs.length,
    from,
    to,
    receivedAt: new Date().toISOString(),
  }, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
