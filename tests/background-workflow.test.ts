import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production background workflow", () => {
  it("uses fixed Beijing market checkpoints instead of an all-day five-minute runner", async () => {
    const [workflow, route, viteConfig] = await Promise.all([
      readFile(new URL("../.github/workflows/panlayer-background.yml", import.meta.url), "utf8"),
      readFile(new URL("../app/api/v1/internal/scheduler/tick/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    ]);

    expect(workflow).not.toContain('cron: "2-57/5 * * * *"');
    expect(workflow).toContain('cron: "27 1 * * 1-5"');
    expect(workflow).toContain('cron: "2 2 * * 1-5"');
    expect(workflow).toContain('cron: "2 3 * * 1-5"');
    expect(workflow).toContain('cron: "2 5 * * 1-5"');
    expect(workflow).toContain('cron: "2 6 * * 1-5"');
    expect(workflow).toContain('cron: "2 7 * * 1-5"');
    expect(workflow).toContain('cron: "17 23 * * 0-4"');
    expect(workflow).toContain('cron: "2,32 10-15 * * 1-5"');
    expect(workflow).toContain("PANLAYER_CRON_SECRET");
    expect(workflow).toContain("/api/v1/internal/scheduler/tick");
    expect(route).toMatch(/isValidSchedulerAuthorization/);
    expect(route).toMatch(/runPanLayerJob/);

    expect(viteConfig).toContain('"0,30 10-15 * * 1-5"');
    expect(viteConfig).not.toContain('"*/5 18-21 * * 0-4"');
    expect(viteConfig).not.toContain('"*/5 0-10 * * 1-5"');
  });
});
