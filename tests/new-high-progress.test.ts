import { describe, expect, it } from "vitest";
import {
  buildNewHighProgress,
  formatNewHighProgress,
  parseNewHighBootstrapFailureCount,
  resolveNewHighProgressTargetDate,
} from "../lib/history/new-high-progress";

describe("new-high initialization progress", () => {
  it("shows real completed, target, failed and coverage values", () => {
    const progress = buildNewHighProgress({
      targetDate: "2026-07-23",
      completed: 1_860,
      target: 5_324,
      failed: 2,
      updatedAt: "2026-07-24T00:00:00.000Z",
    });

    expect(progress).toMatchObject({
      completed: 1_860,
      currentCursor: 1_860,
      target: 5_324,
      failed: 2,
      remaining: 3_464,
      coveragePct: 34.94,
      ready: false,
      complete: false,
    });
    expect(formatNewHighProgress(progress)).toBe(
      "历史基线 34.94% · 1860/5324 · 今日刷新 34.94% · 1860/5324 · 失败 2",
    );
  });

  it("keeps the historical baseline while a new trade date refresh starts", () => {
    const progress = buildNewHighProgress({
      targetDate: "2026-07-29",
      completed: 2_287,
      dailyCompleted: 43,
      target: 5_321,
      failed: 67,
      updatedAt: "2026-07-29T08:00:00.000Z",
    });

    expect(progress).toMatchObject({
      completed: 2_287,
      coveragePct: 42.98,
      dailyCompleted: 43,
      dailyCoveragePct: 0.81,
      ready: false,
      complete: false,
    });
    expect(formatNewHighProgress(progress)).toContain("历史基线 42.98% · 2287/5321");
    expect(formatNewHighProgress(progress)).toContain("今日刷新 0.81% · 43/5321");
  });

  it("marks metrics ready at 95 percent while continuing toward full completion", () => {
    const progress = buildNewHighProgress({
      targetDate: "2026-07-23",
      completed: 95,
      target: 100,
      failed: 0,
      updatedAt: "2026-07-24T00:00:00.000Z",
    });

    expect(progress.ready).toBe(true);
    expect(progress.complete).toBe(false);
  });

  it("restores the latest persisted failure count from the job log", () => {
    expect(parseNewHighBootstrapFailureCount(
      "new-high-bootstrap 1860/5324; remaining 3464; failed 7; coverage 34.94%",
    )).toBe(7);
    expect(parseNewHighBootstrapFailureCount("provider unavailable")).toBe(0);
  });

  it("does not call a truncated stock universe ready", () => {
    const progress = buildNewHighProgress({
      targetDate: "2026-07-23",
      completed: 520,
      target: 520,
      failed: 0,
      updatedAt: "2026-07-24T00:00:00.000Z",
      minimumTarget: 5_000,
    });

    expect(progress.ready).toBe(false);
    expect(progress.complete).toBe(false);
    expect(progress.universeComplete).toBe(false);
    expect(formatNewHighProgress(progress)).toBe("股票库补全中 520/5000+");
  });

  it("uses the latest persisted trading review across weekends", () => {
    expect(resolveNewHighProgressTargetDate("2026-07-26", "2026-07-24")).toBe("2026-07-24");
    expect(resolveNewHighProgressTargetDate("2026-07-26", null)).toBe("2026-07-26");
  });
});
