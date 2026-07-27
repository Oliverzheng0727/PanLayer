import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("full morning brief reader", () => {
  it("renders V2 block types with scoped sources and no raw HTML", async () => {
    const renderer = await read("app/components/brief/BriefBlockRenderer.tsx");

    expect(renderer).toContain("brief-block-table");
    expect(renderer).toContain("brief-callout-risk");
    expect(renderer).toContain("resolveBlockSources");
    expect(renderer).toContain("brief-source-missing");
    expect(renderer).toContain("section.key}-block-${index}");
    expect(renderer).toContain("接收时间（北京时间）");
    expect(renderer).toContain("block.provenance.receivedAt");
    expect(renderer).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
  });

  it("uses five rich cards, a responsive outlined reader, and an unavailable state", async () => {
    const [dashboard, drawer, css] = await Promise.all([
      read("app/components/Dashboard.tsx"),
      read("app/components/brief/BriefDetailDrawer.tsx"),
      read("app/globals.css"),
    ]);

    expect(dashboard).toContain("brief-card-summary");
    expect(dashboard).toContain("brief-tags");
    expect(dashboard).toContain("brief-card-meta");
    expect(dashboard).toContain("brief-unavailable");
    expect(drawer).toContain("brief-drawer-outline");
    expect(drawer).toContain('aria-label="本模块目录"');
    expect(drawer).toContain('role="dialog"');
    expect(css).toContain("width:min(900px,100vw)");
    expect(css).toContain("grid-template-columns:170px minmax(0,1fr)");
    expect(css).toContain(".brief-drawer { width:100vw; border-left:0; }");
  });

  it("keeps reader focus management stable while the dashboard rerenders", async () => {
    const [dashboard, drawer] = await Promise.all([
      read("app/components/Dashboard.tsx"),
      read("app/components/brief/BriefDetailDrawer.tsx"),
    ]);

    expect(dashboard).toMatch(/const closeBriefDrawer = useCallback\(\(\) => setBriefSectionIndex\(null\), \[\]\)/);
    expect(dashboard).toContain("onClose={closeBriefDrawer}");
    expect(drawer).toContain("const isOpen = section !== null");
    expect(drawer).toContain("}, [isOpen, handleClose]);");
    expect(drawer).toContain("const handleClose = useCallback");
    expect(drawer).not.toContain("if (!isOpen) setFullscreen(false)");
  });

  it("does not expose manual generation controls and labels unavailable publication times honestly", async () => {
    const [dashboard, renderer] = await Promise.all([
      read("app/components/Dashboard.tsx"), read("app/components/brief/BriefBlockRenderer.tsx"),
    ]);
    expect(dashboard).not.toContain("BriefRegenerateButton");
    expect(dashboard).not.toContain("/api/v1/admin/jobs");
    expect(dashboard).not.toContain("重新生成");
    expect(dashboard).not.toContain("仅重试失败模块");
    expect(renderer).toContain("发布时间未公开");
    expect(renderer).toContain("接收时间（北京时间）");
  });
});
