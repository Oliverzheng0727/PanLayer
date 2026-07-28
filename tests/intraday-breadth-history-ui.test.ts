import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("intraday breadth history UI", () => {
  it("adds a full-screen history entry beside the breadth panel icon", async () => {
    const dashboard = await read("app/components/Dashboard.tsx");

    expect(dashboard).toContain('aria-label="全屏查看盘中涨跌家数历史"');
    expect(dashboard).toContain("setBreadthHistoryOpen(true)");
    expect(dashboard).toContain("<IntradayBreadthHistoryDrawer");
    expect(dashboard).toContain("<BreadthAreaChart");
  });

  it("renders the current session and a scrollable list of saved trading days", async () => {
    const drawer = await read("app/components/history/IntradayBreadthHistoryDrawer.tsx");

    expect(drawer).toContain("/api/v1/market/breadth-history?limit=60");
    expect(drawer).toContain("当前交易日大图 + 历史交易日小图列表");
    expect(drawer).toContain("按有数据的交易日倒序，可上下滚动比较");
    expect(drawer).toContain('aria-label="退出盘中涨跌历史全屏"');
    expect(drawer).toContain("previousTimelines.map");
  });

  it("protects and bounds the historical breadth endpoint", async () => {
    const route = await read("app/api/v1/market/breadth-history/route.ts");

    expect(route).toContain("authorizeApi");
    expect(route).toContain("readIntradayBreadthHistory");
    expect(route).toContain("Math.min(120");
    expect(route).toContain('"Cache-Control": "private, max-age=60"');
  });

  it("includes responsive full-screen and compact-history styling", async () => {
    const css = await read("app/globals.css");

    expect(css).toContain(".high-drawer.intraday-history-drawer { position:fixed; inset:0; width:100vw;");
    expect(css).toContain(".intraday-history-item { display:grid; grid-template-columns:170px minmax(0,1fr);");
    expect(css).toContain(".intraday-history-item { grid-template-columns:1fr; }");
  });
});
