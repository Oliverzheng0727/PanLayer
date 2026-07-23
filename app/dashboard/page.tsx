import type { Metadata } from "next";
import { isAdminUser, requireAllowedUser } from "../auth-guard";
import { Dashboard } from "../components/Dashboard";
import { demoBrief, demoEtfs, demoHistory, demoReview } from "../../lib/data/demo";
import { readBrief, readHistory, readLatestReview } from "../../lib/data/repository";
import { createUnavailableReview } from "../../lib/data/unavailable";
import { queryEtfs } from "../../lib/etf/catalog";
import { loadLiveEtfCatalogEnvelope } from "../../lib/etf/live-catalog";
import { beijingDateParts } from "../../lib/jobs/schedule";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "今日总览｜盘层 PanLayer" };

export default async function DashboardPage() {
  const user = await requireAllowedUser("/dashboard");
  const { date } = beijingDateParts(new Date());
  const start = new Date(`${date}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 550);
  const from = start.toISOString().slice(0, 10);
  const [storedReview, storedBrief, storedHistory, liveEtfCatalog] = await Promise.all([
    readLatestReview(date),
    readBrief(date),
    readHistory(from, date),
    loadLiveEtfCatalogEnvelope(date).catch(() => ({ items: process.env.NODE_ENV === "development" ? demoEtfs : [] })),
  ]);
  const isDevelopment = process.env.NODE_ENV === "development";
  const review = storedReview ?? (isDevelopment
    ? { ...demoReview, date }
    : createUnavailableReview(date));
  const brief = storedBrief ?? (process.env.NODE_ENV === "development" ? { ...demoBrief, date } : null);
  const history = storedHistory.length > 0 ? storedHistory : isDevelopment ? demoHistory : [];
  const etfs = queryEtfs(liveEtfCatalog.items, {
    category: "全部",
    query: "",
    sort: "amount",
    order: "desc",
    cursor: 0,
    limit: 100,
  }).items;
  return <Dashboard review={review} brief={brief} etfs={etfs} history={history} userName={user.displayName} canManageBrief={await isAdminUser(user.email)} />;
}
