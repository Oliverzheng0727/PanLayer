import { describe, expect, it } from "vitest";
import { breadthCompleteness } from "../lib/history/overview";

describe("breadth snapshot completeness", () => {
  it("reports exact missing market nodes", () => {
    expect(breadthCompleteness([
      { time: "09:25", rising: 3000, falling: 2000, flat: 100 },
      { time: "15:00", rising: 3200, falling: 1900, flat: 100 },
    ])).toEqual({
      expected: 6,
      captured: 2,
      missing: ["10:00", "11:00", "13:00", "14:00"],
      status: "partial",
    });
  });

  it("is complete only when all six unique nodes exist", () => {
    expect(breadthCompleteness([
      "09:25", "10:00", "11:00", "13:00", "14:00", "15:00",
    ].map((time) => ({ time, rising: 1, falling: 1, flat: 0 })))).toMatchObject({
      expected: 6,
      captured: 6,
      missing: [],
      status: "complete",
    });
  });
});
