import { describe, expect, it } from "vitest";
import { fetchAlphaVantageQuote } from "../lib/data/global/alpha-vantage";
import { fetchEiaSeries } from "../lib/data/global/eia";
import { fetchFredSeries } from "../lib/data/global/fred";
import { isGlobalSnapshotDate } from "../lib/data/global/query";
import { GLOBAL_MARKET_INSTRUMENTS, loadGlobalOvernightSnapshot } from "../lib/data/global/overnight";
import { reconcileGlobalPoints } from "../lib/data/global/reconcile";
import { fetchTwelveDataQuotes } from "../lib/data/global/twelve-data";
import type { GlobalInstrument, GlobalPoint } from "../lib/data/global/types";

const instrument = (key: string, symbol: string): GlobalInstrument => ({ key, symbol, label: key.toUpperCase(), period: "daily" });

describe("global data providers", () => {
  it("accepts only real ISO calendar dates for the protected snapshot route", () => {
    expect(isGlobalSnapshotDate("2026-07-23")).toBe(true);
    expect(isGlobalSnapshotDate("2026-02-30")).toBe(false);
    expect(isGlobalSnapshotDate("not-a-date")).toBe(false);
  });

  it("keeps the primary overseas batch within the free eight-credit minute budget", async () => {
    let called = false;
    const fetcher = (async () => { called = true; return Response.json({}); }) as typeof fetch;
    const result = await loadGlobalOvernightSnapshot({}, fetcher);
    expect(GLOBAL_MARKET_INSTRUMENTS).toHaveLength(8);
    expect(called).toBe(false);
    expect(result.reconciled.every((item) => item.status === "unconfigured")).toBe(true);
  });

  it("maps a Twelve Data batch response", async () => {
    const fetcher = (async () => Response.json({
      SPY: { symbol: "SPY", close: "630.20", previous_close: "625.10", percent_change: "0.8159", datetime: "2026-07-22" },
      QQQ: { symbol: "QQQ", close: "570.40", previous_close: "568.20", percent_change: "0.3872", datetime: "2026-07-22" },
    })) as typeof fetch;
    const result = await fetchTwelveDataQuotes([instrument("sp500", "SPY"), instrument("nasdaq", "QQQ")], "key", fetcher);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ key: "sp500", provider: "Twelve Data", value: 630.2, previousClose: 625.1, status: "ok" });
  });

  it("maps an Alpha Vantage global quote", async () => {
    const fetcher = (async () => Response.json({ "Global Quote": {
      "01. symbol": "SPY", "05. price": "630.25", "08. previous close": "625.10",
      "10. change percent": "0.8239%", "07. latest trading day": "2026-07-22",
    } })) as typeof fetch;
    const result = await fetchAlphaVantageQuote(instrument("sp500", "SPY"), "key", fetcher);
    expect(result).toMatchObject({ key: "sp500", provider: "Alpha Vantage", value: 630.25, marketTime: "2026-07-22", status: "ok" });
  });

  it("uses the latest finite FRED observation", async () => {
    const fetcher = (async () => Response.json({ observations: [
      { date: "2026-07-22", value: "." },
      { date: "2026-07-21", value: "4.35" },
    ] })) as typeof fetch;
    const result = await fetchFredSeries({ key: "us10y", label: "美国10年期国债收益率", seriesId: "DGS10", period: "daily" }, "key", fetcher);
    expect(result).toMatchObject({ provider: "FRED", value: 4.35, marketTime: "2026-07-21", status: "ok" });
  });

  it("maps the latest EIA series row", async () => {
    const fetcher = (async () => Response.json({ response: { data: [
      { period: "2026-07-21", value: "76.42" },
    ] } })) as typeof fetch;
    const result = await fetchEiaSeries({ key: "wti", label: "WTI原油", route: "petroleum/pri/spt/data", valueField: "value", period: "daily" }, "key", fetcher);
    expect(result).toMatchObject({ provider: "EIA", value: 76.42, marketTime: "2026-07-21", status: "ok" });
  });

  it("returns an unconfigured point without making a request when a key is absent", async () => {
    let called = false;
    const fetcher = (async () => { called = true; return Response.json({}); }) as typeof fetch;
    const result = await fetchTwelveDataQuotes([instrument("sp500", "SPY")], "", fetcher);
    expect(called).toBe(false);
    expect(result[0]).toMatchObject({ key: "sp500", value: null, status: "unconfigured" });
    expect(result[0].message).not.toContain("key");
  });
});

const point = (overrides: Partial<GlobalPoint>): GlobalPoint => ({
  key: "sp500", label: "标普500", provider: "Twelve Data", value: 100, previousClose: 99,
  pctChange: 1.01, marketTime: "2026-07-22", receivedAt: "2026-07-23T00:00:00Z", period: "daily",
  status: "ok", message: "", ...overrides,
});

describe("global point reconciliation", () => {
  it("marks same-date prices within 0.2 percent cross-checked", () => {
    const result = reconcileGlobalPoints([point({}), point({ provider: "Alpha Vantage", value: 100.1 })]);
    expect(result[0]).toMatchObject({ key: "sp500", value: 100, status: "cross-checked", providers: ["Twelve Data", "Alpha Vantage"] });
  });

  it("marks conflicting prices or dates partial", () => {
    const priceConflict = reconcileGlobalPoints([point({}), point({ provider: "Alpha Vantage", value: 101 })]);
    const dateConflict = reconcileGlobalPoints([point({}), point({ provider: "Alpha Vantage", marketTime: "2026-07-21" })]);
    expect(priceConflict[0].status).toBe("partial");
    expect(dateConflict[0].status).toBe("partial");
  });

  it("gives an official macro provider precedence", () => {
    const result = reconcileGlobalPoints([
      point({ key: "us10y", label: "美国10年期国债收益率", value: 4.3 }),
      point({ key: "us10y", label: "美国10年期国债收益率", provider: "FRED", value: 4.35 }),
    ]);
    expect(result[0]).toMatchObject({ key: "us10y", value: 4.35, status: "official", providers: ["FRED", "Twelve Data"] });
  });
});
