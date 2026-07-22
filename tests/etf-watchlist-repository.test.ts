import { describe, expect, it } from "vitest";
import {
  deleteWatchlistItem,
  listWatchlistItems,
  saveWatchlistItem,
  updateWatchlistCategory,
} from "../lib/etf/watchlist-repository";
import type { WatchlistRecord } from "../lib/etf/watchlist";

function fakeDb(rows: unknown[] = []) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  return {
    calls,
    db: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return {
              all: async () => ({ results: rows }),
              run: async () => ({ success: true }),
            };
          },
        };
      },
    } as unknown as D1Database,
  };
}

const saved: WatchlistRecord = {
  userEmail: "viewer@example.com",
  symbol: "512480",
  name: "半导体ETF",
  exchange: "SH",
  category: "半导体存储",
  createdAt: "2026-07-23T08:00:00.000Z",
  updatedAt: "2026-07-23T08:00:00.000Z",
};

describe("ETF watchlist repository", () => {
  it("scopes list queries to the signed-in account", async () => {
    const { db, calls } = fakeDb([{
      user_email: saved.userEmail,
      symbol: saved.symbol,
      name: saved.name,
      exchange: saved.exchange,
      category: saved.category,
      created_at: saved.createdAt,
      updated_at: saved.updatedAt,
    }]);

    await expect(listWatchlistItems(db, "viewer@example.com")).resolves.toEqual([saved]);
    expect(calls[0].values).toEqual(["viewer@example.com"]);
  });

  it("includes the account in add, category update, and delete mutations", async () => {
    const { db, calls } = fakeDb();
    await saveWatchlistItem(db, saved);
    await updateWatchlistCategory(db, saved.userEmail, saved.symbol, "科技AI", saved.updatedAt);
    await deleteWatchlistItem(db, saved.userEmail, saved.symbol);

    expect(calls[0].values[0]).toBe("viewer@example.com");
    expect(calls[1].values).toContain("viewer@example.com");
    expect(calls[2].values).toEqual(["viewer@example.com", "512480"]);
  });
});
