import { describe, expect, it } from "vitest";
import { parseHistoryQuery, queryHistoryRows, type HistoryRow } from "../lib/history/query";

const rows: HistoryRow[] = [
  { date: "2026-07-22", rising: 1530, falling: 2798, flat: 101, limitUp: 47, limitDown: 8, largeRise: 23, consecutive: 12, maxStreak: 6, openPremium: 1.79, closePremium: 7.05, high120: 20, allTimeHigh: 8, topSector: "机器人 / 算力", status: "complete", source: "东方财富", updatedAt: "2026-07-22 16:10" },
  { date: "2026-07-21", rising: 3107, falling: 1280, flat: 88, limitUp: 121, limitDown: 21, largeRise: 195, consecutive: 5, maxStreak: 4, openPremium: 2.2, closePremium: 3.16, high120: 19, allTimeHigh: 2, topSector: "医药 / 芯片", status: "complete", source: "东方财富", updatedAt: "2026-07-21 16:10" },
  { date: "2026-07-20", rising: 1740, falling: 2670, flat: 92, limitUp: 53, limitDown: 12, largeRise: 18, consecutive: 7, maxStreak: 3, openPremium: -0.3, closePremium: -0.82, high120: 17, allTimeHigh: 4, topSector: "汽车 / 电池", status: "partial", source: "东方财富", updatedAt: "2026-07-20 16:10" },
];

describe("history table query", () => {
  it("parses only allowlisted sort fields", () => {
    expect(parseHistoryQuery(new URLSearchParams("sort=limitUp&order=asc&limit=2"))).toMatchObject({ sort: "limitUp", order: "asc", limit: 2 });
    expect(() => parseHistoryQuery(new URLSearchParams("sort=payload"))).toThrow("invalid history sort");
  });

  it("sorts numbers and filters sector text", () => {
    const page = queryHistoryRows(rows, { sort: "limitUp", order: "desc", sector: "医药", cursor: 0, limit: 30 });
    expect(page.items.map((row) => row.date)).toEqual(["2026-07-21"]);
  });

  it("paginates without repeating rows", () => {
    const first = queryHistoryRows(rows, { sort: "date", order: "desc", sector: "", cursor: 0, limit: 2 });
    const second = queryHistoryRows(rows, { sort: "date", order: "desc", sector: "", cursor: first.nextCursor!, limit: 2 });
    expect(first.items.map((row) => row.date)).toEqual(["2026-07-22", "2026-07-21"]);
    expect(second.items.map((row) => row.date)).toEqual(["2026-07-20"]);
    expect(second.nextCursor).toBeNull();
  });
});
