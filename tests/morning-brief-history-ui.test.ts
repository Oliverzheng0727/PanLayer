import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("morning brief history UI", () => {
  it("links the dashboard brief heading to a dedicated three-month archive", async () => {
    const dashboard = await read("app/components/Dashboard.tsx");
    expect(dashboard).toContain('href="/brief-history"');
    expect(dashboard).toContain("早参日历");
  });

  it("renders calendar navigation, descending history rows and profile charts", async () => {
    const page = await read("app/components/brief/BriefHistoryPage.tsx");
    expect(page).toContain("BriefArchiveCalendar");
    expect(page).toContain("BriefProfileChart");
    expect(page).toContain("每日早参切片");
    expect(page).toContain("非交易日自动跳过");
  });

  it("persists the rolling archive in browser IndexedDB", async () => {
    const cache = await read("lib/client/brief-local-cache.ts");
    expect(cache).toContain('indexedDB.open(DATABASE_NAME');
    expect(cache).toContain("key < cutoffDate");
    expect(cache).toContain("syncBriefArchiveToLocal");
  });
});
