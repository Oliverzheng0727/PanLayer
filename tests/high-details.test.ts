import { describe, expect, it } from "vitest";
import { parseHighDetailQuery, queryHighDetails, type HighDetail } from "../lib/history/high-details";

const items: HighDetail[] = [
  { date: "2026-07-22", type: "120d", symbol: "688001.SH", name: "示例芯片", sector: "半导体", pctChange: 8.2, close: 38.5, highPrice: 38.5, amount: 2_800_000_000, intervalPct: 42, highDate: "2026-07-22", isAllTime: false },
  { date: "2026-07-22", type: "120d", symbol: "300001.SZ", name: "示例医药", sector: "医药", pctChange: 3.1, close: 21.3, highPrice: 21.3, amount: 1_200_000_000, intervalPct: 31, highDate: "2026-07-22", isAllTime: true },
  { date: "2026-07-22", type: "all-time", symbol: "300001.SZ", name: "示例医药", sector: "医药", pctChange: 3.1, close: 21.3, highPrice: 21.3, amount: 1_200_000_000, intervalPct: 96, highDate: "2026-07-22", isAllTime: true },
];

describe("new-high detail query", () => {
  it("filters by high type and text then sorts", () => {
    const result = queryHighDetails(items, { type: "120d", query: "半导体", sort: "amount", order: "desc" });
    expect(result.map((item) => item.symbol)).toEqual(["688001.SH"]);
  });

  it("supports ascending interval return", () => {
    const result = queryHighDetails(items, { type: "120d", query: "", sort: "intervalPct", order: "asc" });
    expect(result.map((item) => item.symbol)).toEqual(["300001.SZ", "688001.SH"]);
  });

  it("rejects an unsafe sort field", () => {
    expect(() => parseHighDetailQuery(new URLSearchParams("type=120d&sort=payload"))).toThrow("invalid high detail sort");
  });

  it("accepts 20-day high details as a first-class filter", () => {
    expect(parseHighDetailQuery(new URLSearchParams("type=20d"))).toMatchObject({
      type: "20d",
    });
  });
});
