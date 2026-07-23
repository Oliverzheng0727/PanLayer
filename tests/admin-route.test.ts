import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("admin morning brief regeneration API", () => {
  it("accepts a bounded history-backfill days parameter", async () => {
    const adminRouteSource = await readFile(new URL("../app/api/v1/admin/jobs/[job]/run/route.ts", import.meta.url), "utf8");
    expect(adminRouteSource).toContain('job === "history-backfill"');
    expect(adminRouteSource).toContain('searchParams.get("days")');
    expect(adminRouteSource).toMatch(/days[\s\S]*1[\s\S]*20/);
  });

  it("exposes the resumable new-high initialization job", async () => {
    const adminRouteSource = await readFile(new URL("../app/api/v1/admin/jobs/[job]/run/route.ts", import.meta.url), "utf8");
    expect(adminRouteSource).toContain('job === "new-high-bootstrap"');
  });

  it("seeds an empty stock universe and runs larger overnight bootstrap batches", async () => {
    const runner = await readFile(new URL("../lib/jobs/runner.ts", import.meta.url), "utf8");
    expect(runner).toContain("provider.getUniverse()");
    expect(runner).toContain("batchSize: 150");
    expect(runner).toContain("coverage ${progress.coveragePct}%");
    expect(runner).toContain('acquireJobLease(db, "new-high-bootstrap"');
  });

  it("validates a requested brief section before passing it to the runner", async () => {
    const adminRouteSource = await readFile(new URL("../app/api/v1/admin/jobs/[job]/run/route.ts", import.meta.url), "utf8");

    expect(adminRouteSource).toContain("BRIEF_SECTION_DEFINITIONS");
    expect(adminRouteSource).toContain("sectionKeys");
    expect(adminRouteSource).toMatch(/unknown brief section[\s\S]*status:\s*400/);
  });

  it("rejects an empty section and sections attached to other jobs", async () => {
    const adminRouteSource = await readFile(new URL("../app/api/v1/admin/jobs/[job]/run/route.ts", import.meta.url), "utf8");

    expect(adminRouteSource).toContain("if (section !== null)");
    expect(adminRouteSource).toMatch(/mapped\.type !== "morning-brief"[\s\S]*status:\s*400/);
  });

  it("supports failed-only retries but rejects conflicting and unknown modes", async () => {
    const adminRouteSource = await readFile(new URL("../app/api/v1/admin/jobs/[job]/run/route.ts", import.meta.url), "utf8");

    expect(adminRouteSource).toContain('mode === "failed"');
    expect(adminRouteSource).toMatch(/mode.*section[\s\S]*status:\s*400/);
    expect(adminRouteSource).toMatch(/unknown brief mode[\s\S]*status:\s*400/);
  });

  it("whitelists each query parameter once and parses force as an explicit boolean", async () => {
    const adminRouteSource = await readFile(new URL("../app/api/v1/admin/jobs/[job]/run/route.ts", import.meta.url), "utf8");

    expect(adminRouteSource).toContain("allowedParams");
    expect(adminRouteSource).toContain("searchParams.getAll");
    expect(adminRouteSource).toMatch(/unknown query parameter[\s\S]*status:\s*400/);
    expect(adminRouteSource).toMatch(/force must be true or false[\s\S]*status:\s*400/);
  });

  it("does not let a manual refresh write a close review before the market close window", async () => {
    const adminRouteSource = await readFile(new URL("../app/api/v1/admin/jobs/[job]/run/route.ts", import.meta.url), "utf8");
    expect(adminRouteSource).toContain("canRunCloseReview");
    expect(adminRouteSource).toContain("收盘复盘将在北京时间 16:10 后生成");
  });
});
