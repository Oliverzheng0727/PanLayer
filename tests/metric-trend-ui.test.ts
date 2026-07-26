import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("overview metric trend UI", () => {
  it("makes all six overview cards open the expected trend", async () => {
    const dashboard = await read("app/components/Dashboard.tsx");

    for (const metric of ["breadth", "limits", "consecutive", "highs", "premium", "margin"]) {
      expect(dashboard).toContain(`setTrendMetric("${metric}")`);
    }
    expect(dashboard).toContain("查看${label}历史趋势");
    expect(dashboard).toContain("<MetricTrendDrawer");
  });

  it("supports ranges, honest missing states, keyboard close, point selection, and high details", async () => {
    const drawer = await read("app/components/history/MetricTrendDrawer.tsx");

    expect(drawer).toContain('{ value: 20, label: "20日" }');
    expect(drawer).toContain('{ value: 60, label: "60日" }');
    expect(drawer).toContain('{ value: 120, label: "120日" }');
    expect(drawer).toContain('{ value: "all", label: "全部" }');
    expect(drawer).toContain("暂无可验证历史数据");
    expect(drawer).toContain('event.key === "Escape"');
    expect(drawer).toContain("onSelectDate(date)");
    expect(drawer).toContain("查看 {currentDate} 新高股票");
    expect(drawer).toContain("connectNulls={false}");
    expect(drawer).toContain('aria-label={`切换到 ${payload.date}`}');
  });

  it("keeps trend-point date selection synchronized with the history workspace", async () => {
    const [dashboard, workspace] = await Promise.all([
      read("app/components/Dashboard.tsx"),
      read("app/components/history/HistoryWorkspace.tsx"),
    ]);

    expect(dashboard).toContain("ref={historyWorkspaceRef}");
    expect(dashboard).toContain("historyWorkspaceRef.current?.selectDate(date)");
    expect(dashboard).toContain("onSelectDate={selectTrendDate}");
    expect(workspace).toContain("useImperativeHandle(ref");
    expect(workspace).toContain('data-history-date="${date}"');
  });

  it("uses the existing wide drawer language and mobile full-screen layout", async () => {
    const css = await read("app/globals.css");

    expect(css).toContain(".high-drawer.metric-trend-drawer { width:min(720px,100vw); }");
    expect(css).toContain(".metric-trend-chart { height:430px;");
    expect(css).toContain(".high-drawer { width:100vw; border-left:0; }");
  });
});
