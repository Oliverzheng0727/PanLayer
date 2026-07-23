import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("PanLayer history comparison workspace UI contract", () => {
  it("contains the supplied review metrics in the same comparison order", async () => {
    const table = await readFile(new URL("../app/components/history/HistoryTable.tsx", import.meta.url), "utf8");
    const labels = [
      "日期", "涨停家数", "跌停家数", "炸板家数", "大跌家数（7%）", "封板率",
      "昨日打板成功率", "连板反馈", "上涨家数", "成交额", "连板数",
      "最高板（名称）", "断板数（二板+）", "断板率", "主线板块", "龙头周期",
      "今日辨识度个股", "指数情况",
    ];
    let previousIndex = -1;
    for (const label of labels) {
      const index = table.indexOf(`label: "${label}"`);
      expect(index, `${label} 应存在`).toBeGreaterThan(-1);
      expect(index, `${label} 顺序错误`).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
    expect(table).not.toContain('label: "下跌"');
    expect(table).not.toContain('label: "平盘"');
    expect(table).not.toContain('label: "120日新高"');
    expect(table).not.toContain('label: "两融余额"');
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

  it("keeps the header and date column frozen inside a two-axis scroll area", async () => {
    const [css, table] = await Promise.all([
      readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
      readFile(new URL("../app/components/history/HistoryTable.tsx", import.meta.url), "utf8"),
    ]);
    expect(css).toMatch(/\.history-table-scroll\s*\{[\s\S]*?overflow:auto/);
    expect(css).toMatch(/\.history-table-columns th\s*\{[\s\S]*?position:sticky[\s\S]*?top:0/);
    expect(css).toMatch(/\.history-table \.history-date\s*\{[\s\S]*?position:sticky[\s\S]*?left:0/);
    expect(table).not.toContain("history-table-title");
  });
});
