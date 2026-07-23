import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("admin morning brief regeneration API", () => {
  it("accepts a bounded history-backfill days parameter", async () => {
    const adminRouteSource = await readFile(new URL("../app/api/v1/admin/jobs/[job]/run/route.ts", import.meta.url), "utf8");
    expect(adminRouteSource).toContain('job === "history-backfill"');
    expect(adminRouteSource).toContain('searchParams.get("days")');
    expect(adminRouteSource).toMatch(/days[\s\S]*1[\s\S]*20/);
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
});
