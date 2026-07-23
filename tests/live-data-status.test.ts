import { describe, expect, it } from "vitest";
import { clockTime } from "../app/components/data/LiveDataStatus";

describe("LiveDataStatus clockTime", () => {
  it("treats a timezone-less persisted timestamp as Beijing market time", () => {
    expect(clockTime("2026-07-23 16:10:00")).toBe("16:10:00");
    expect(clockTime("2026-07-23T16:10:00")).toBe("16:10:00");
  });
});
