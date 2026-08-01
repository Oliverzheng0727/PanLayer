import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production background workflow", () => {
  it("uses an hourly fallback plus exact and fair five-minute scheduler windows", async () => {
    const [workflow, route, viteConfig] = await Promise.all([
      readFile(new URL("../.github/workflows/panlayer-background.yml", import.meta.url), "utf8"),
      readFile(new URL("../app/api/v1/internal/scheduler/tick/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    ]);

    expect(workflow).not.toContain('cron: "2-57/5 * * * *"');
    expect(workflow).toContain('cron: "17 * * * *"');
    expect(workflow).toContain('cron: "17,32,47,57 23 * * *"');
    expect(workflow).toContain('cron: "27 1 * * 1-5"');
    expect(workflow).toContain('cron: "2 2 * * 1-5"');
    expect(workflow).toContain('cron: "2 3 * * 1-5"');
    expect(workflow).toContain('cron: "2 5 * * 1-5"');
    expect(workflow).toContain('cron: "2 6 * * 1-5"');
    expect(workflow).toContain('cron: "2 7 * * 1-5"');
    expect(workflow).not.toContain('cron: "17 23 * * 0-4"');
    expect(workflow).not.toContain('cron: "2,32 10-15 * * 1-5"');
    expect(workflow).toContain("PANLAYER_CRON_SECRET");
    expect(workflow).toContain("regenerate-morning-brief");
    expect(workflow).toContain("X-PanLayer-Action: regenerate-morning-brief");
    expect(workflow).toContain("continue-morning-brief");
    expect(workflow).toContain("X-PanLayer-Action: continue-morning-brief");
    expect(workflow).toContain("continue-daily-new-high-refresh");
    expect(workflow).toContain("X-PanLayer-Action: continue-daily-new-high-refresh");
    expect(workflow).toContain("scheduled_time");
    expect(workflow).toContain("X-PanLayer-Scheduled-Time");
    expect(workflow).toContain("/api/v1/internal/scheduler/tick");
    expect(workflow).toContain("PanLayer jobs partial; automatic retry remains scheduled");
    expect(workflow).toContain("Critical PanLayer jobs failed");
    expect(workflow).not.toContain('job?.ok === false || job?.status === "partial" || job?.status === "failed"');
    expect(route).toMatch(/isValidSchedulerAuthorization/);
    expect(route).toMatch(/runPanLayerJob/);
    expect(route).toContain('action === "continue-morning-brief"');
    expect(route).toContain('action === "continue-daily-new-high-refresh"');
    expect(route).toContain('normalizeSchedulerProvider(request.headers.get("x-panlayer-scheduler"))');
    expect(route.match(/trigger: "manual"/g)).toHaveLength(3);
    expect(route).not.toContain('{ trigger: "reconcile" }');

    expect(viteConfig).toContain('"17 * * * *"');
    expect(viteConfig).toContain('"*/5 17-23 * * *"');
    expect(viteConfig).toContain('"*/5 0-8 * * 1-5"');
    expect(viteConfig).toContain('"0,15,30,45 10-15 * * *"');
  });
});
