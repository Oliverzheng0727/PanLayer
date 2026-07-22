import type { WatchlistRecord } from "./watchlist";

type WatchlistRow = {
  user_email: string;
  symbol: string;
  name: string;
  exchange: "SH" | "SZ" | "OTHER";
  category: string;
  created_at: string;
  updated_at: string;
};

export async function listWatchlistItems(
  db: D1Database,
  userEmail: string,
): Promise<WatchlistRecord[]> {
  const result = await db.prepare(
    "SELECT user_email, symbol, name, exchange, category, created_at, updated_at FROM user_etf_watchlist WHERE user_email = ? ORDER BY created_at DESC",
  ).bind(userEmail).all<WatchlistRow>();
  return (result.results ?? []).map((row) => ({
    userEmail: row.user_email,
    symbol: row.symbol,
    name: row.name,
    exchange: row.exchange,
    category: row.category,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function saveWatchlistItem(
  db: D1Database,
  item: WatchlistRecord,
): Promise<void> {
  await db.prepare(
    "INSERT INTO user_etf_watchlist (user_email, symbol, name, exchange, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_email, symbol) DO UPDATE SET name=excluded.name, exchange=excluded.exchange, category=excluded.category, updated_at=excluded.updated_at",
  ).bind(
    item.userEmail,
    item.symbol,
    item.name,
    item.exchange,
    item.category,
    item.createdAt,
    item.updatedAt,
  ).run();
}

export async function updateWatchlistCategory(
  db: D1Database,
  userEmail: string,
  symbol: string,
  category: string,
  updatedAt: string,
): Promise<void> {
  await db.prepare(
    "UPDATE user_etf_watchlist SET category = ?, updated_at = ? WHERE user_email = ? AND symbol = ?",
  ).bind(category, updatedAt, userEmail, symbol).run();
}

export async function deleteWatchlistItem(
  db: D1Database,
  userEmail: string,
  symbol: string,
): Promise<void> {
  await db.prepare(
    "DELETE FROM user_etf_watchlist WHERE user_email = ? AND symbol = ?",
  ).bind(userEmail, symbol).run();
}
