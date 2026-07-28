import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

describe("automatic-only data task surface", () => {
  it("does not expose the browser-callable manual job API", async () => {
    await expect(access(new URL("app/api/v1/admin/jobs/[job]/run/route.ts", root))).rejects.toThrow();
  });

  it("does not ship manual data controls in dashboard client components", async () => {
    const sources = await Promise.all([
      "app/components/Dashboard.tsx",
      "app/components/history/HistoryWorkspace.tsx",
      "app/components/data/SidebarDataProgressCard.tsx",
    ].map((path) => readFile(new URL(path, root), "utf8")));
    const combined = sources.join("\n");

    expect(combined).not.toContain("/api/v1/admin/jobs");
    expect(combined).not.toMatch(/刷新数据|回补近120日|继续初始化|重新生成|仅重试失败模块/);
  });

  it("keeps the secret-protected automatic scheduler route", async () => {
    const route = await readFile(new URL("app/api/v1/internal/scheduler/tick/route.ts", root), "utf8");
    expect(route).toContain("isValidSchedulerAuthorization");
    expect(route).toContain("executeRemoteSchedulerTick");
    expect(route).toContain("PANLAYER_CRON_SECRET");
    expect(route).toContain('request.headers.get("x-panlayer-action")');
    expect(route).toContain("prepareMorningBriefRegeneration");
  });
});
