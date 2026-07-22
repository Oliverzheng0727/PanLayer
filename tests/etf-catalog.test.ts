import { describe, expect, it } from "vitest";
import { classifyEtf, queryEtfs } from "../lib/etf/catalog";
import type { EtfSnapshot } from "../lib/data/provider";

const etf = (symbol: string, name: string, amount: number, averageAmount20: number | null): EtfSnapshot => ({
  symbol, name, category: classifyEtf(name).category, tags: classifyEtf(name).tags, exchange: symbol.startsWith("5") ? "SH" : "SZ",
  price: 1, pctChange: 0, amount, averageAmount20, scale: 1_000_000_000, turnoverRate: 2, status: "active", updatedAt: "2026-07-23 15:00",
});

describe("ETF catalog", () => {
  it("classifies the requested industries and global assets", () => {
    expect(classifyEtf("医美ETF")).toMatchObject({ category: "美容护理", tags: expect.arrayContaining(["医美", "美容护理"]) });
    expect(classifyEtf("芯片存储ETF").category).toBe("半导体存储");
    expect(classifyEtf("新能源车ETF").category).toBe("汽车");
    expect(classifyEtf("纳斯达克100ETF").category).toBe("海外指数");
    expect(classifyEtf("黄金ETF").category).toBe("商品");
  });

  it("filters by category and searches tags", () => {
    const items = [etf("A", "医美ETF", 1, 1), etf("B", "芯片ETF", 2, 2)];
    expect(queryEtfs(items, { category: "美容护理", query: "", sort: "amount", order: "desc", cursor: 0, limit: 20 }).items.map((item) => item.symbol)).toEqual(["A"]);
    expect(queryEtfs(items, { category: "全部", query: "美容", sort: "amount", order: "desc", cursor: 0, limit: 20 }).items.map((item) => item.symbol)).toEqual(["A"]);
  });

  it("sorts active products and keeps unavailable values last", () => {
    const items = [etf("A", "医药ETF", 10, null), etf("B", "医疗ETF", 5, 20), etf("C", "创新药ETF", 8, 12)];
    const page = queryEtfs(items, { category: "医药医疗", query: "", sort: "averageAmount20", order: "desc", cursor: 0, limit: 2 });
    expect(page.items.map((item) => item.symbol)).toEqual(["B", "C"]);
    expect(page.nextCursor).toBe(2);
  });
});
