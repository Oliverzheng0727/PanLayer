import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("morning brief API", () => {
  it("returns only the persisted brief and an explicit unavailable status", async () => {
    const briefRouteSource = await readFile(new URL("../app/api/v1/brief/[date]/route.ts", import.meta.url), "utf8");

    expect(briefRouteSource).not.toContain("demoBrief");
    expect(briefRouteSource).toContain('status: brief?.status ?? "unavailable"');
    expect(briefRouteSource).toContain("demo: false");
  });
});
