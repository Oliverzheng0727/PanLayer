import type { MorningBrief } from "../ai/morning-brief";
import type { DailyReview } from "../domain/types";
import { reviewToHistoryRow, type HistoryRow } from "../history/query";

async function getD1(): Promise<D1Database | null> {
  try {
    const { env } = await import("cloudflare:workers");
    return env.DB ?? null;
  } catch { return null; }
}

export async function readReview(date: string): Promise<DailyReview | null> {
  const db = await getD1();
  if (!db) return null;
  const row = await db.prepare("SELECT payload FROM daily_reviews WHERE trade_date = ?").bind(date).first<{ payload: string }>();
  return row?.payload ? JSON.parse(row.payload) : null;
}

export async function readBrief(date: string): Promise<MorningBrief | null> {
  const db = await getD1();
  if (!db) return null;
  const row = await db.prepare("SELECT payload FROM morning_briefs WHERE trade_date = ?").bind(date).first<{ payload: string }>();
  return row?.payload ? JSON.parse(row.payload) : null;
}

export async function readHistory(from: string, to: string): Promise<HistoryRow[]> {
  const db = await getD1();
  if (!db) return [];
  const result = await db.prepare("SELECT payload FROM daily_reviews WHERE trade_date BETWEEN ? AND ? ORDER BY trade_date DESC LIMIT 2000").bind(from, to).all<{ payload: string }>();
  return (result.results ?? []).flatMap((row) => {
    try { return [reviewToHistoryRow(JSON.parse(row.payload) as DailyReview)]; }
    catch { return []; }
  });
}

export async function readDataHealth() {
  const db = await getD1();
  if (!db) return { status: "demo", lastRun: null, jobs: [] };
  const result = await db.prepare("SELECT job, trade_date, status, message, started_at, finished_at FROM job_runs ORDER BY id DESC LIMIT 20").all<{ status: string }>();
  const jobs = result.results ?? [];
  return { status: jobs.some((job) => job.status === "failed") ? "partial" : "complete", lastRun: jobs[0] ?? null, jobs };
}
