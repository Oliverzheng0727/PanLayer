import { describe, expect, it } from "vitest";
import {
  buildIntradayBreadthTimeline,
  type IntradayBreadthPoint,
} from "../lib/data/repository";

const point = (
  time: string,
  status: IntradayBreadthPoint["status"] = "partial",
): IntradayBreadthPoint => ({
  time,
  rising: 3_200,
  falling: 1_900,
  flat: 80,
  source: "东方财富",
  status,
  updatedAt: `2026-07-27T${time}:30+08:00`,
});

describe("intraday breadth timeline", () => {
  it("keeps future nodes pending instead of labeling them missing", () => {
    const timeline = buildIntradayBreadthTimeline({
      date: "2026-07-27",
      now: new Date("2026-07-27T09:20:00+08:00"),
      snapshots: [],
    });

    expect(timeline.meta).toMatchObject({
      captured: 0,
      pending: ["09:25", "10:00", "11:00", "13:00", "14:00", "15:00"],
      recovering: [],
      missing: [],
      status: "pending",
    });
  });

  it("keeps the opening node recoverable from the official open price", () => {
    const timeline = buildIntradayBreadthTimeline({
      date: "2026-07-27",
      now: new Date("2026-07-27T10:05:00+08:00"),
      snapshots: [],
    });

    expect(timeline.meta.missing).toEqual([]);
    expect(timeline.meta.recovering).toEqual(["09:25", "10:00"]);
    expect(timeline.meta.pending).toEqual(["11:00", "13:00", "14:00", "15:00"]);
  });

  it("marks an unfilled opening node missing after the same-day recovery window", () => {
    const timeline = buildIntradayBreadthTimeline({
      date: "2026-07-27",
      now: new Date("2026-07-27T15:31:00+08:00"),
      snapshots: [],
    });

    expect(timeline.meta.missing).toContain("09:25");
  });

  it("counts partial-quality rows as captured and orders them by checkpoint", () => {
    const timeline = buildIntradayBreadthTimeline({
      date: "2026-07-27",
      now: new Date("2026-07-27T10:05:00+08:00"),
      snapshots: [point("10:00"), point("09:25", "complete"), point("10:00")],
    });

    expect(timeline.snapshots.map((snapshot) => snapshot.time)).toEqual(["09:25", "10:00"]);
    expect(timeline.meta.captured).toBe(2);
    expect(timeline.meta.missing).toEqual([]);
    expect(timeline.meta.pending).toEqual(["11:00", "13:00", "14:00", "15:00"]);
  });
});
