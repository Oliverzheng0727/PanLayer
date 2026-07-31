import { describe, expect, it } from "vitest";
import { mergeContributionBars } from "../lib/history/contributions";

describe("history contribution increments", () => {
  it("merges the newest contribution without discarding the existing cache", () => {
    const dates = Array.from({ length: 120 }, (_, index) => {
      const date = new Date("2026-01-01T00:00:00Z");
      date.setUTCDate(date.getUTCDate() + index);
      return date.toISOString().slice(0, 10);
    });
    const existing = dates.slice(0, 119).map((date, index) => ({
      date,
      pctChange: index,
      amount: index * 100,
    }));

    const merged = mergeContributionBars(existing, [{
      date: dates[119],
      pctChange: 1.25,
      amount: 8_000,
    }], dates);

    expect(merged).toHaveLength(120);
    expect(merged[0]).toEqual(existing[0]);
    expect(merged.at(-1)).toEqual({
      date: dates[119],
      pctChange: 1.25,
      amount: 8_000,
    });
  });

  it("deduplicates by date, prefers the incoming value and drops dates outside the window", () => {
    const merged = mergeContributionBars(
      [
        { date: "2026-07-28", pctChange: 1, amount: 100 },
        { date: "2026-07-29", pctChange: 2, amount: 200 },
      ],
      [
        { date: "2026-07-29", pctChange: 3, amount: 300 },
        { date: "2026-07-30", pctChange: 4, amount: 400 },
      ],
      ["2026-07-29", "2026-07-30"],
    );

    expect(merged).toEqual([
      { date: "2026-07-29", pctChange: 3, amount: 300 },
      { date: "2026-07-30", pctChange: 4, amount: 400 },
    ]);
  });
});
