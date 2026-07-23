import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("ETF workspace UI contract", () => {
  it("lets a user add the remotely selected ETF from the K-line panel", async () => {
    const [chart, workspace] = await Promise.all([
      readFile(new URL("../app/components/etf/EtfChart.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/components/etf/EtfWorkspace.tsx", import.meta.url), "utf8"),
    ]);

    expect(chart).toContain("加入自选");
    expect(chart).toMatch(/onAdd/);
    expect(workspace).toMatch(/onAdd=\{/);
  });
});
