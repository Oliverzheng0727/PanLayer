import { describe, expect, it } from "vitest";
import { globalMarketSnapshots, marketSourceAudits } from "../db/schema";
import { summarizeDataHealth } from "../lib/data/repository";

describe("persisted data health", () => {
  it("exports source-audit and global-snapshot tables", () => {
    expect(marketSourceAudits).toBeDefined();
    expect(globalMarketSnapshots).toBeDefined();
  });

  it("reports domestic, global, macro and AI health independently", () => {
    const result = summarizeDataHealth({
      jobs: [{ job: "morning-brief", status: "complete", trade_date: "2026-07-23", message: "", started_at: "a", finished_at: "b" }],
      audits: [{ source: "东方财富", status: "complete", received_at: "2026-07-23T07:00:00Z", message: "双源一致" }],
      globalPoints: [
        { provider: "Twelve Data", status: "ok", received_at: "2026-07-23T00:00:00Z", message: "" },
        { provider: "FRED", status: "unconfigured", received_at: "2026-07-23T00:00:00Z", message: "未配置 FRED" },
      ],
    });
    expect(result.status).toBe("partial");
    expect(result.domestic.status).toBe("complete");
    expect(result.global.status).toBe("complete");
    expect(result.macro.status).toBe("partial");
    expect(result.ai.status).toBe("complete");
  });
});
