import { describe, expect, it } from "vitest";
import { createEastmoneyProvider, mapEastmoneyQuote } from "../lib/data/eastmoney";

describe("Eastmoney quote mapping", () => {
  it("maps Shanghai, Shenzhen/ChiNext, STAR and Beijing board rules", () => {
    const sh = mapEastmoneyQuote({ f12: "600000", f14: "浦发银行", f2: 11, f3: 10, f6: 1e8, f8: 2, f15: 11, f16: 10, f17: 10.1, f18: 10, f100: "银行" });
    const cy = mapEastmoneyQuote({ f12: "300001", f14: "特锐德", f2: 12, f3: 20, f6: 2e8, f8: 4, f15: 12, f16: 10, f17: 10.2, f18: 10, f100: "电气设备" });
    const star = mapEastmoneyQuote({ f12: "688001", f14: "华兴源创", f2: 12, f3: 20, f6: 2e8, f8: 3, f15: 12, f16: 10, f17: 10.4, f18: 10, f100: "电子" });
    const bj = mapEastmoneyQuote({ f12: "830001", f14: "示例", f2: 13, f3: 30, f6: 1e7, f8: 1, f15: 13, f16: 10, f17: 10.1, f18: 10, f100: "机械" });
    const bjNew = mapEastmoneyQuote({ f12: "920001", f14: "北交新代码", f2: 13, f3: 30, f6: 1e7, f8: 1, f15: 13, f16: 10, f17: 10.1, f18: 10, f100: "机械" });
    expect(sh).toMatchObject({ exchange: "SH", board: "MAIN", limitUpPrice: 11 });
    expect(cy).toMatchObject({ exchange: "SZ", board: "CHINEXT", limitUpPrice: 12 });
    expect(star).toMatchObject({ exchange: "SH", board: "STAR", limitUpPrice: 12 });
    expect(bj).toMatchObject({ exchange: "BJ", board: "BEIJING", limitUpPrice: 13 });
    expect(bjNew).toMatchObject({ exchange: "BJ", board: "BEIJING", limitUpPrice: 13 });
  });

  it("flags ST instruments so they do not enter the review universe", () => {
    const result = mapEastmoneyQuote({ f12: "600001", f14: "*ST示例", f2: 5, f3: 0, f6: 1, f8: 1, f15: 5, f16: 5, f17: 5, f18: 5, f100: "其他" });
    expect(result.isST).toBe(true);
  });
});

describe("Eastmoney provider", () => {
  it("rotates Eastmoney hosts when the preferred edge returns 520", async () => {
    const hosts: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      hosts.push(url.host);
      if (url.host.startsWith("82.")) return new Response("edge failed", { status: 520 });
      return new Response(JSON.stringify({ data: { total: 1, diff: [{
        f12: "600000", f14: "浦发银行", f2: 11, f3: 1, f6: 1, f8: 1,
        f15: 11, f16: 10, f17: 10.5, f18: 10.9, f100: "银行",
      }] } }));
    };

    await expect(createEastmoneyProvider(fetcher).getQuotes("11:00")).resolves.toHaveLength(1);
    expect(hosts).toEqual(["82.push2.eastmoney.com", "push2.eastmoney.com"]);
  });

  it("uses the HTTP quote edge as a final fallback when HTTPS edges are unavailable", async () => {
    const origins: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      origins.push(url.origin);
      if (url.protocol === "https:") return new Response("edge failed", { status: 520 });
      return new Response(JSON.stringify({ data: { total: 1, diff: [{
        f12: "600000", f14: "浦发银行", f2: 11, f3: 1, f6: 1, f8: 1,
        f15: 11, f16: 10, f17: 10.5, f18: 10.9, f100: "银行",
      }] } }));
    };

    await expect(createEastmoneyProvider(fetcher).getQuotes("11:00")).resolves.toHaveLength(1);
    expect(origins.at(-1)).toBe("http://40.push2.eastmoney.com");
  });

  it("falls back to Sina's full A-share pages when every Eastmoney quote edge is unavailable", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.host.includes("eastmoney.com")) return new Response("edge failed", { status: 520 });
      if (url.pathname.includes("getHQNodeStockCount")) return new Response('"2"');
      if (url.pathname.includes("getHQNodeData")) {
        return new Response(JSON.stringify([
          {
            symbol: "sh600000", code: "600000", name: "浦发银行", trade: "11.00",
            changepercent: 1, settlement: "10.89", open: "10.90", high: "11.10",
            low: "10.80", amount: 100000000, turnoverratio: 2,
          },
          {
            symbol: "bj920001", code: "920001", name: "北交示例", trade: "13.00",
            changepercent: 2, settlement: "12.75", open: "12.80", high: "13.10",
            low: "12.70", amount: 10000000, turnoverratio: 1,
          },
        ]));
      }
      return new Response("not found", { status: 404 });
    };

    const provider = createEastmoneyProvider(fetcher);
    await expect(provider.getQuotes("11:00")).resolves.toMatchObject([
      { symbol: "600000.SH", name: "浦发银行" },
      { symbol: "920001.BJ", name: "北交示例" },
    ]);
  });

  it("limits quote-page concurrency and retries a transient provider 520", async () => {
    let active = 0;
    let maxActive = 0;
    const attempts = new Map<string, number>();
    const fetcher: typeof fetch = async (input) => {
      const page = new URL(String(input)).searchParams.get("pn") ?? "1";
      attempts.set(page, (attempts.get(page) ?? 0) + 1);
      if (page === "1") {
        return new Response(JSON.stringify({ data: { total: 8, diff: [
          { f12: "600001", f14: "股票1", f2: 10, f3: 1, f6: 1, f8: 1, f15: 10, f16: 9, f17: 9.9, f18: 9.9, f100: "测试" },
          { f12: "600002", f14: "股票2", f2: 10, f3: 1, f6: 1, f8: 1, f15: 10, f16: 9, f17: 9.9, f18: 9.9, f100: "测试" },
        ] } }));
      }
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (page === "2" && attempts.get(page) === 1) return new Response("temporary", { status: 520 });
      const start = Number(page) * 2 - 1;
      return new Response(JSON.stringify({ data: { total: 8, diff: [start, start + 1].map((index) => ({
        f12: String(600000 + index), f14: `股票${index}`, f2: 10, f3: 1, f6: 1, f8: 1,
        f15: 10, f16: 9, f17: 9.9, f18: 9.9, f100: "测试",
      })) } }));
    };

    const quotes = await createEastmoneyProvider(fetcher).getQuotes("11:00");

    expect(quotes).toHaveLength(8);
    expect(attempts.get("2")).toBe(2);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("keeps a sufficiently complete universe when one trailing page remains unavailable", async () => {
    const firstRows = Array.from({ length: 95 }, (_, index) => ({
      f12: String(600000 + index), f14: `股票${index}`, f2: 10, f3: 1, f6: 1, f8: 1,
      f15: 10, f16: 9, f17: 9.9, f18: 9.9, f100: "测试",
    }));
    const fetcher: typeof fetch = async (input) => {
      const page = new URL(String(input)).searchParams.get("pn") ?? "1";
      return page === "1"
        ? new Response(JSON.stringify({ data: { total: 100, diff: firstRows } }))
        : new Response("temporary", { status: 520 });
    };

    await expect(createEastmoneyProvider(fetcher).getQuotes("11:00")).resolves.toHaveLength(95);
  });

  it("paginates the A-share quote market instead of treating the first 100 movers as the full universe", async () => {
    const requestedPages: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const page = url.searchParams.get("pn") ?? "1";
      requestedPages.push(page);
      const diff = page === "1"
        ? [
            { f12: "600000", f14: "浦发银行", f2: 11, f3: 1, f6: 1e8, f8: 2, f15: 11, f16: 10, f17: 10.1, f18: 10, f100: "银行" },
            { f12: "000001", f14: "平安银行", f2: 12, f3: -1, f6: 2e8, f8: 1, f15: 12.2, f16: 11.8, f17: 12, f18: 12.12, f100: "银行" },
          ]
        : [{ f12: "830001", f14: "北交示例", f2: 13, f3: 0, f6: 3e7, f8: 3, f15: 13, f16: 13, f17: 13, f18: 13, f100: "机械" }];
      return new Response(JSON.stringify({ data: { total: 3, diff } }));
    };

    const quotes = await createEastmoneyProvider(fetcher).getQuotes("11:00");

    expect(requestedPages).toEqual(["1", "2"]);
    expect(quotes.map((item) => item.symbol)).toEqual(["600000.SH", "000001.SZ", "830001.BJ"]);
  });

  it("returns the non-ST review universe from the quote endpoint", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      data: { diff: [
        { f12: "600000", f14: "浦发银行", f2: 11, f3: 10, f6: 1e8, f8: 2, f15: 11, f16: 10, f17: 10.1, f18: 10, f100: "银行" },
        { f12: "600001", f14: "*ST示例", f2: 5, f3: 0, f6: 1, f8: 1, f15: 5, f16: 5, f17: 5, f18: 5, f100: "其他" },
      ] },
    }));
    const provider = createEastmoneyProvider(fetcher);
    const quotes = await provider.getQuotes("15:00");
    expect(quotes.map((item) => item.symbol)).toEqual(["600000.SH"]);
  });

  it("merges limit streak and first-seal time into limit-pool quotes", async () => {
    let call = 0;
    const fetcher: typeof fetch = async () => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify({ data: { pool: [{ c: "600000", n: "浦发银行", p: 110000, zdp: 10, amount: 1e8, hs: 2, hybk: "银行", fbt: 93500, lbc: 2 }] } }));
      return new Response(JSON.stringify({ data: { diff: [] } }));
    };
    const provider = createEastmoneyProvider(fetcher);
    const pool = await provider.getLimitPool("2026-07-22");
    expect(pool[0]).toMatchObject({ symbol: "600000.SH", limitStreak: 2, firstLimitTime: "09:35:00", sector: "银行" });
  });

  it("paginates the ETF market so products beyond the first provider page stay searchable", async () => {
    const requestedPages: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const page = url.searchParams.get("pn") ?? "1";
      requestedPages.push(page);
      const diff = page === "1"
        ? [
            { f12: "510300", f14: "沪深300ETF", f2: 4.1, f3: 0.5, f6: 30, f8: 1, f20: 100 },
            { f12: "512480", f14: "半导体ETF", f2: 1.2, f3: 1.5, f6: 20, f8: 2, f20: 80 },
          ]
        : [{ f12: "159995", f14: "芯片ETF", f2: 1.3, f3: 2, f6: 10, f8: 3, f20: 60 }];
      return new Response(JSON.stringify({ data: { total: 3, diff } }));
    };

    const etfs = await createEastmoneyProvider(fetcher).getEtfs("2026-07-23");

    expect(requestedPages).toEqual(["1", "2"]);
    expect(etfs.map((item) => item.symbol)).toEqual(["510300", "512480", "159995"]);
  });
});
