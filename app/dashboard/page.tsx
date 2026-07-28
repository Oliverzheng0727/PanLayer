import type { Metadata } from "next";
import { requireAllowedUser } from "../auth-guard";
import { Dashboard } from "../components/Dashboard";
import { demoBrief, demoEtfs, demoHistory, demoReview } from "../../lib/data/demo";
import { readBrief, readDataHealth, readHistory, readIntradayBreadthTimeline, readLatestBrief, readLatestReview, readNewHighProgress, readReview } from "../../lib/data/repository";
import { createUnavailableReview } from "../../lib/data/unavailable";
import { queryEtfs } from "../../lib/etf/catalog";
import { loadPersistedEtfCatalogEnvelope } from "../../lib/etf/live-catalog";
import { beijingDateParts, latestCompletedReviewDate, resolveDashboardReviewDate } from "../../lib/jobs/schedule";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "今日总览｜盘层 PanLayer" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireAllowedUser("/dashboard");
  const now = new Date();
  const { date } = beijingDateParts(now);
  const completedReviewDate = latestCompletedReviewDate(now);
  const requestedDate = (await searchParams).date;
  const selection = resolveDashboardReviewDate(now, requestedDate);
  const historyTo = selection.date > completedReviewDate ? selection.date : completedReviewDate;
  const briefDate = selection.exact && requestedDate ? selection.date : date;
  const start = new Date(`${historyTo}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 550);
  const from = start.toISOString().slice(0, 10);
  const [storedReview, storedBrief, latestBrief, storedHistory, persistedEtfCatalog, newHighProgress, dataHealth, intradayBreadth] = await Promise.all([
    selection.exact ? readReview(selection.date) : readLatestReview(selection.date),
    readBrief(briefDate),
    requestedDate ? Promise.resolve(null) : readLatestBrief(briefDate),
    readHistory(from, historyTo),
    loadPersistedEtfCatalogEnvelope(date).catch(() => ({ items: process.env.NODE_ENV === "development" ? demoEtfs : [] })),
    readNewHighProgress(selection.date),
    readDataHealth(),
    readIntradayBreadthTimeline(date, now),
  ]);
  const isDevelopment = process.env.NODE_ENV === "development";
  const review = storedReview ?? (isDevelopment
    ? { ...demoReview, date: selection.date }
    : createUnavailableReview(selection.date));
  const brief = (storedBrief ?? latestBrief)
    ?? (process.env.NODE_ENV === "development" ? { ...demoBrief, date } : null);
  const history = storedHistory.length > 0 ? storedHistory : isDevelopment ? demoHistory : [];
  const etfs = queryEtfs(persistedEtfCatalog.items, {
    category: "全部",
    query: "",
    sort: "amount",
    order: "desc",
    cursor: 0,
    limit: 100,
  }).items;
  return <Dashboard review={review} brief={brief} etfs={etfs} history={history} newHighProgress={newHighProgress} dataHealth={dataHealth.daily} intradayBreadth={intradayBreadth} userName={user.displayName} />;
}
