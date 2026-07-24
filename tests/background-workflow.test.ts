import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production background workflow", () => {
  it("calls the protected scheduler endpoint every five minutes", async () => {
    const [workflow, route] = await Promise.all([
      readFile(new URL("../.github/workflows/panlayer-background.yml", import.meta.url), "utf8"),
      readFile(new URL("../app/api/v1/internal/scheduler/tick/route.ts", import.meta.url), "utf8"),
    ]);

    expect(workflow).toContain("*/5 * * * 1-5");
    expect(workflow).toContain("PANLAYER_CRON_SECRET");
    expect(workflow).toContain("/api/v1/internal/scheduler/tick");
    expect(route).toMatch(/isValidSchedulerAuthorization/);
    expect(route).toMatch(/runPanLayerJob/);
  });
});
