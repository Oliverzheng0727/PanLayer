import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("admin morning brief regeneration API", () => {
  it("validates a requested brief section before passing it to the runner", async () => {
    const adminRouteSource = await readFile(new URL("../app/api/v1/admin/jobs/[job]/run/route.ts", import.meta.url), "utf8");

    expect(adminRouteSource).toContain("BRIEF_SECTION_DEFINITIONS");
    expect(adminRouteSource).toContain("sectionKeys");
    expect(adminRouteSource).toMatch(/unknown brief section[\s\S]*status:\s*400/);
  });
});
