import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("global market clock UI", () => {
  it("is rendered globally and remains visible on mobile", async () => {
    const [dashboard, clock, css] = await Promise.all([
      readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/components/data/GlobalMarketClock.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    ]);

    expect(dashboard).toMatch(/GlobalMarketClock/);
    expect(clock).toContain("北京时间");
    expect(clock).toContain("市场数据");
    expect(clock).toContain("下次刷新");
    expect(clock).toContain("更新失败 · 旧数据");
    expect(clock).toMatch(/setInterval/);
    expect(clock).not.toMatch(/useState\(\(\) => new Date\(\)\)/);
    expect(clock).toMatch(/useState<Date \| null>\(null\)/);
    expect(css).toMatch(/global-market-clock/);
    expect(css).not.toMatch(/\.global-market-clock\s*\{[^}]*display:\s*none/);
  });
});
