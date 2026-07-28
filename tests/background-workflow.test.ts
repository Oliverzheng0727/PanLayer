import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production background workflow", () => {
  it("uses one hourly recovery tick plus exact Beijing market checkpoints", async () => {
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
    expect(workflow).toContain("scheduled_time");
    expect(workflow).toContain("X-PanLayer-Scheduled-Time");
    expect(workflow).toContain("/api/v1/internal/scheduler/tick");
    expect(route).toMatch(/isValidSchedulerAuthorization/);
    expect(route).toMatch(/runPanLayerJob/);
    expect(route).toContain('action === "continue-morning-brief"');
    expect(route).toContain('normalizeSchedulerProvider(request.headers.get("x-panlayer-scheduler"))');
    expect(route.match(/\{ trigger: "manual" \}/g)).toHaveLength(2);
    expect(route).not.toContain('{ trigger: "reconcile" }');

    expect(viteConfig).toContain('"17 * * * *"');
    expect(viteConfig).toContain('"50,55 22 * * *"');
    expect(viteConfig).toContain('"15,20,25,30,35,40,45,50,55 23 * * *"');
    expect(viteConfig).toContain('"15,20,25,30 0 * * *"');
    expect(viteConfig).toContain('"0,10,20,25-30 1-8 * * 1-5"');
    expect(viteConfig).not.toContain('"0,30 10-15 * * 1-5"');
    expect(viteConfig).not.toContain('"*/5 18-21 * * 0-4"');
    expect(viteConfig).not.toContain('"*/5 0-10 * * 1-5"');
  });
});
