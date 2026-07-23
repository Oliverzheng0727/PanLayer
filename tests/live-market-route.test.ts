import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("live market API contract", () => {
  it("returns explicit freshness fields and never falls back to numeric old breadth", async () => {
    const route = await readFile(new URL("../app/api/v1/market/live/route.ts", import.meta.url), "utf8");

    expect(route).toMatch(/authorizeApi/);
    expect(route).toMatch(/loadLiveMarketSnapshot/);
    expect(route).toMatch(/breadth:\s*null/);
    expect(route).toMatch(/status:\s*"failed"/);
    expect(route).toMatch(/receivedAt/);
    expect(route).toMatch(/marketTime/);
    expect(route).toMatch(/isStale:\s*true/);
  });
});
