import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Excel-style history workspace UI contract", () => {
  it("renders every approved comparison column and keeps numeric columns sortable", async () => {
    const table = await readFile(new URL("../app/components/history/HistoryTable.tsx", import.meta.url), "utf8");
    for (const label of [
      "主线板块", "涨停", "跌停", "炸板", "大跌", "封板率", "昨日打板成功率",
      "连板反馈", "上涨", "下跌", "平盘", "全市场成交额", "连板家数",
      "最高板（名称）", "断板数量", "断板率", "龙头周期", "辨识度个股",
      "指数情况", "120日新高", "历史新高", "两融余额",
    ]) {
      expect(table).toContain(label);
    }
    expect(table).toMatch(/field:\s*"sealRate"/);
    expect(table).toMatch(/field:\s*"marketAmount"/);
    expect(table).toMatch(/field:\s*"brokenBoardRate"/);
  });

  it("opens a right-side evidence drawer for board, leader and index details", async () => {
    const [workspace, drawer] = await Promise.all([
      readFile(new URL("../app/components/history/HistoryWorkspace.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/components/history/MarketEvidenceDrawer.tsx", import.meta.url), "utf8"),
    ]);

    expect(workspace).toMatch(/MarketEvidenceDrawer/);
    expect(workspace).toMatch(/onOpenEvidence/);
    expect(drawer).toContain("数据来源");
    expect(drawer).toContain("计算口径");
    expect(drawer).toContain("有效样本");
    expect(drawer).toContain("仅供市场复盘，不构成投资建议");
  });

  it("keeps the header and the first two columns frozen inside a two-axis scroll area", async () => {
    const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.history-table-scroll\s*\{[\s\S]*?overflow:auto/);
    expect(css).toMatch(/\.history-table th\s*\{[\s\S]*?position:sticky[\s\S]*?top:0/);
    expect(css).toMatch(/\.history-table \.history-date\s*\{[\s\S]*?position:sticky[\s\S]*?left:0/);
    expect(css).toMatch(/\.history-table \.history-sector-cell\s*\{[\s\S]*?position:sticky[\s\S]*?left:102px/);
  });
});
