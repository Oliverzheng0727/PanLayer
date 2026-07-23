import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("dashboard brief adapter", () => {
  it("keeps an unavailable source publication time nullable", async () => {
    const legacyBriefSource = await readFile(new URL("../lib/ai/morning-brief.ts", import.meta.url), "utf8");

    expect(legacyBriefSource).toContain("publishedAt: string | null");
  });
});
