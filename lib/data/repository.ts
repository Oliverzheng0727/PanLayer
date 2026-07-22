import type { MorningBrief } from "../ai/morning-brief";
import type { DailyReview } from "../domain/types";
import { reviewToHistoryRow, type HistoryRow } from "../history/query";
import type { HighDetail } from "../history/high-details";

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

export async function readHighDetails(date: string): Promise<HighDetail[]> {
  const db = await getD1();
  if (!db) return [];
  try {
    const result = await db.prepare("SELECT trade_date, type, symbol, name, sector, pct_change, close, high_price, amount, interval_pct, high_date, is_all_time FROM new_high_details WHERE trade_date = ?").bind(date).all<{
      trade_date: string; type: string; symbol: string; name: string; sector: string; pct_change: number; close: number;
      high_price: number; amount: number; interval_pct: number; high_date: string; is_all_time: number;
    }>();
    return (result.results ?? []).flatMap((row) => row.type === "120d" || row.type === "all-time" ? [{
      date: row.trade_date,
      type: row.type,
      symbol: row.symbol,
      name: row.name,
      sector: row.sector,
      pctChange: row.pct_change,
      close: row.close,
      highPrice: row.high_price,
      amount: row.amount,
      intervalPct: row.interval_pct,
      highDate: row.high_date,
      isAllTime: Boolean(row.is_all_time),
    }] : []);
  } catch { return []; }
}

export async function readDataHealth() {
  const db = await getD1();
  if (!db) return { status: "demo", lastRun: null, jobs: [] };
  const result = await db.prepare("SELECT job, trade_date, status, message, started_at, finished_at FROM job_runs ORDER BY id DESC LIMIT 20").all<{ status: string }>();
  const jobs = result.results ?? [];
  return { status: jobs.some((job) => job.status === "failed") ? "partial" : "complete", lastRun: jobs[0] ?? null, jobs };
}
