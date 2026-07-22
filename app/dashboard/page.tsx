import type { Metadata } from "next";
import { requireAllowedUser } from "../auth-guard";
import { Dashboard } from "../components/Dashboard";
import { demoBrief, demoEtfs, demoHistory, demoReview } from "../../lib/data/demo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "今日总览｜盘层 PanLayer" };

export default async function DashboardPage() {
  const user = await requireAllowedUser("/dashboard");
  return <Dashboard review={demoReview} brief={demoBrief} etfs={demoEtfs} history={demoHistory} userName={user.displayName} />;
}
