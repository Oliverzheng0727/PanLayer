import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("history workspace fullscreen mode", () => {
  it("offers an accessible expand control and Escape close", async () => {
    const source = await read("app/components/history/HistoryWorkspace.tsx");

    expect(source).toContain('aria-label={isFullscreen ? "退出历史数据全屏" : "放大历史数据表"}');
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain('isFullscreen ? "is-fullscreen" : ""');
    expect(source).toContain("<Maximize2");
    expect(source).toContain("<Minimize2");
  });

  it("fills the desktop viewport and becomes edge-to-edge on mobile", async () => {
    const css = await read("app/globals.css");

    expect(css).toContain(".history-workspace.is-fullscreen { position:fixed; inset:10px;");
    expect(css).toContain(".history-workspace.is-fullscreen .history-table-scroll { height:100%; max-height:none; }");
    expect(css).toContain(".history-workspace.is-fullscreen { inset:0; border-radius:0; }");
  });
});
