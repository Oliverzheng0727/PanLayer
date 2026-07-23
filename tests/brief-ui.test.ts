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

  it("shows manual full regeneration only to administrators without exposing credentials", async () => {
    const [dashboard, button] = await Promise.all([
      read("app/components/Dashboard.tsx"),
      read("app/components/brief/BriefRegenerateButton.tsx"),
    ]);

    expect(dashboard).toMatch(/canManageBrief\s*&&\s*<BriefRegenerateButton/);
    expect(button).toContain('/api/v1/admin/jobs/morning-brief/run?force=true');
    expect(button).toContain('method: "POST"');
    expect(button).toContain("window.location.reload()");
    expect(button).not.toMatch(/API_KEY|apiKey|secret/i);
  });
});
