import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("history calendar collapse", () => {
  it("provides accessible expand and collapse controls", async () => {
    const calendar = await read("app/components/history/HistoryCalendar.tsx");

    expect(calendar).toContain('aria-label="收起历史日历"');
    expect(calendar).toContain('aria-label="展开历史日历"');
    expect(calendar).toContain("PanelLeftClose");
    expect(calendar).toContain("PanelLeftOpen");
  });

  it("persists the collapsed state and gives the table the released width", async () => {
    const [workspace, css] = await Promise.all([
      read("app/components/history/HistoryWorkspace.tsx"),
      read("app/globals.css"),
    ]);

    expect(workspace).toContain("calendarCollapsed?: boolean");
    expect(workspace).toContain('calendarCollapsed ? "calendar-collapsed" : ""');
    expect(css).toContain(".history-layout.calendar-collapsed { grid-template-columns:52px minmax(0,1fr); }");
    expect(css).toContain(".history-calendar.is-collapsed");
  });
});
