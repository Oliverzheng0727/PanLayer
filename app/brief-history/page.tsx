import type { Metadata } from "next";
import { requireAllowedUser } from "../auth-guard";
import { BriefHistoryPage } from "../components/brief/BriefHistoryPage";
import { readBriefArchive } from "../../lib/data/repository";
import { pruneBriefArchive } from "../../lib/ai/morning-brief-archive";
import { beijingDateParts } from "../../lib/jobs/schedule";
import { demoBrief } from "../../lib/data/demo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "盘前早参历史｜盘层 PanLayer" };

export default async function MorningBriefHistoryRoute() {
  await requireAllowedUser("/brief-history");
  const now = new Date();
  const to = beijingDateParts(now).date;
  const cutoff = new Date(`${to}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 92);
  const from = cutoff.toISOString().slice(0, 10);
  const storedBriefs = pruneBriefArchive(await readBriefArchive(from, to), from);
  const briefs = storedBriefs.length > 0 || process.env.NODE_ENV !== "development"
    ? storedBriefs
    : [0, 1, 3].map((offset) => {
      const date = new Date(`${to}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() - offset);
      const archiveDate = date.toISOString().slice(0, 10);
      return {
        ...structuredClone(demoBrief),
        date: archiveDate,
        generatedAt: `${archiveDate}T07:15:00+08:00`,
        sections: demoBrief.sections.map((section) => ({
          ...section,
          generatedAt: `${archiveDate}T07:15:00+08:00`,
        })),
      };
    });
  return <BriefHistoryPage initialBriefs={briefs} cutoffDate={from} />;
}
