import { describe, expect, it } from "vitest";
import { buildEtfCategoryCounts, classifyEtf, queryEtfs } from "../lib/etf/catalog";
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
    expect(classifyEtf("通信ETF").category).toBe("通信光模块");
    expect(classifyEtf("食品饮料ETF").category).toBe("食品饮料");
    expect(classifyEtf("家电ETF").category).toBe("家电家居");
    expect(classifyEtf("游戏ETF").category).toBe("传媒游戏");
    expect(classifyEtf("房地产ETF").category).toBe("地产基建");
    expect(classifyEtf("有色金属ETF").category).toBe("有色金属");
    expect(classifyEtf("化工ETF").category).toBe("化工材料");
  });

  it("filters by category and searches tags", () => {
    const items = [etf("A", "医美ETF", 1, 1), etf("B", "芯片ETF", 2, 2)];
    expect(queryEtfs(items, { category: "美容护理", query: "", sort: "amount", order: "desc", cursor: 0, limit: 20 }).items.map((item) => item.symbol)).toEqual(["A"]);
    expect(queryEtfs(items, { category: "全部", query: "美容", sort: "amount", order: "desc", cursor: 0, limit: 20 }).items.map((item) => item.symbol)).toEqual(["A"]);
  });

  it("normalizes surrounding whitespace for full-catalog name and code searches", () => {
    const items = [
      etf("512480", "半导体ETF", 3, 3),
      etf("159995", "芯片ETF", 2, 2),
      etf("510300", "沪深300ETF", 1, 1),
    ];

    expect(queryEtfs(items, { category: "全部", query: "  芯片  ", sort: "amount", order: "desc", cursor: 0, limit: 20 }).items.map((item) => item.symbol)).toEqual(["512480", "159995"]);
    expect(queryEtfs(items, { category: "全部", query: "  5124 ", sort: "amount", order: "desc", cursor: 0, limit: 20 }).items.map((item) => item.symbol)).toEqual(["512480"]);
  });

  it("sorts active products and keeps unavailable values last", () => {
    const items = [etf("A", "医药ETF", 10, null), etf("B", "医疗ETF", 5, 20), etf("C", "创新药ETF", 8, 12)];
    const page = queryEtfs(items, { category: "医药医疗", query: "", sort: "averageAmount20", order: "desc", cursor: 0, limit: 2 });
    expect(page.items.map((item) => item.symbol)).toEqual(["B", "C"]);
    expect(page.nextCursor).toBe(2);
  });

  it("builds category counts from the supplied live catalog", () => {
    const items = [
      etf("512480", "半导体ETF", 3, 3),
      etf("159995", "芯片ETF", 2, 2),
      etf("510300", "沪深300ETF", 1, 1),
    ];

    const counts = buildEtfCategoryCounts(items);
    expect(counts.find((item) => item.category === "全部")?.count).toBe(3);
    expect(counts.find((item) => item.category === "半导体存储")?.count).toBe(2);
    expect(counts.find((item) => item.category === "宽基指数")?.count).toBe(1);
  });
});
