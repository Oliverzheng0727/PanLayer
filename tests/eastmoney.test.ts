import { describe, expect, it } from "vitest";
import { createEastmoneyProvider, mapEastmoneyQuote } from "../lib/data/eastmoney";

describe("Eastmoney quote mapping", () => {
  it("maps Shanghai, Shenzhen/ChiNext, STAR and Beijing board rules", () => {
    const sh = mapEastmoneyQuote({ f12: "600000", f14: "浦发银行", f2: 11, f3: 10, f6: 1e8, f8: 2, f15: 11, f16: 10, f17: 10.1, f18: 10, f100: "银行" });
    const cy = mapEastmoneyQuote({ f12: "300001", f14: "特锐德", f2: 12, f3: 20, f6: 2e8, f8: 4, f15: 12, f16: 10, f17: 10.2, f18: 10, f100: "电气设备" });
    const star = mapEastmoneyQuote({ f12: "688001", f14: "华兴源创", f2: 12, f3: 20, f6: 2e8, f8: 3, f15: 12, f16: 10, f17: 10.4, f18: 10, f100: "电子" });
    const bj = mapEastmoneyQuote({ f12: "830001", f14: "示例", f2: 13, f3: 30, f6: 1e7, f8: 1, f15: 13, f16: 10, f17: 10.1, f18: 10, f100: "机械" });
    expect(sh).toMatchObject({ exchange: "SH", board: "MAIN", limitUpPrice: 11 });
    expect(cy).toMatchObject({ exchange: "SZ", board: "CHINEXT", limitUpPrice: 12 });
    expect(star).toMatchObject({ exchange: "SH", board: "STAR", limitUpPrice: 12 });
    expect(bj).toMatchObject({ exchange: "BJ", board: "BEIJING", limitUpPrice: 13 });
  });

  it("flags ST instruments so they do not enter the review universe", () => {
    const result = mapEastmoneyQuote({ f12: "600001", f14: "*ST示例", f2: 5, f3: 0, f6: 1, f8: 1, f15: 5, f16: 5, f17: 5, f18: 5, f100: "其他" });
    expect(result.isST).toBe(true);
  });
});

describe("Eastmoney provider", () => {
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
});
