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

  it("exposes source and freshness metadata from the full-market endpoint", async () => {
    const [route, catalog] = await Promise.all([
      readFile(new URL("../app/api/v1/etfs/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/etf/live-catalog.ts", import.meta.url), "utf8"),
    ]);

    expect(route).toMatch(/loadLiveEtfCatalogEnvelope/);
    expect(catalog).toMatch(/receivedAt/);
    expect(catalog).toMatch(/marketTime/);
    expect(catalog).toMatch(/isStale/);
    expect(catalog).toMatch(/SERVER_LIVE_CACHE_MS/);
  });

  it("does not block the dashboard server render on live ETF providers", async () => {
    const page = await readFile(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");

    expect(page).toMatch(/loadPersistedEtfCatalogEnvelope/);
    expect(page).not.toMatch(/loadLiveEtfCatalogEnvelope/);
  });

  it("keeps a low-frequency background reconciliation heartbeat during the evening", async () => {
    const config = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");

    expect(config).toContain('"0,30 10-15 * * 1-5"');
    expect(config).not.toContain('"*/5 11-15 * * 1-5"');
  });
});
