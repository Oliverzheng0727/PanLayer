import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("live refresh UI contract", () => {
  it("refreshes ETFs every minute and resumes when the tab becomes visible", async () => {
    const workspace = await readFile(new URL("../app/components/etf/EtfWorkspace.tsx", import.meta.url), "utf8");
    expect(workspace).toMatch(/ETF_REFRESH_MS/);
    expect(workspace).toMatch(/visibilitychange/);
    expect(workspace).toMatch(/refreshCatalog/);
  });

  it("refreshes live breadth every three minutes without relabeling failed data as current", async () => {
    const dashboard = await readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8");
    expect(dashboard).toMatch(/BREADTH_REFRESH_MS/);
    expect(dashboard).toMatch(/\/api\/v1\/market\/live/);
    expect(dashboard).toMatch(/visibilitychange/);
    expect(dashboard).toMatch(/router\.refresh/);
  });

  it("never renders incomplete breadth, invalid ratios, undefined amounts, or fabricated comparisons as real metrics", async () => {
    const dashboard = await readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8");
    expect(dashboard).toMatch(/effectiveStatus/);
    expect(dashboard).toMatch(/formatBeijingDateTime/);
    expect(dashboard).toMatch(/formatBreadthRatio/);
    expect(dashboard).toMatch(/isLiveBreadthUsable/);
    expect(dashboard).toMatch(/liveMarket\.universeSize >= 5_000/);
    expect(dashboard).toMatch(/marginBalance === null \? "暂缺"/);
    expect(dashboard).not.toMatch(/trend=\{\+2\.8\}|trend=\{\+10\.3\}|trend=\{\+4\.1\}|trend=\{-12\.5\}|trend=\{-1\.04\}/);
    expect(dashboard).not.toContain("梯队高度 6板");
    expect(dashboard).not.toMatch(/total\.rising\s*\/\s*total\.falling/);
  });

  it("announces source, timestamps, and stale failures politely", async () => {
    const status = await readFile(new URL("../app/components/data/LiveDataStatus.tsx", import.meta.url), "utf8");
    expect(status).toMatch(/aria-live="polite"/);
    expect(status).toContain("更新失败");
    expect(status).toContain("旧数据");
    expect(status).toMatch(/receivedAt/);
    expect(status).toMatch(/marketTime/);
    expect(status).toMatch(/source/);
  });
});
