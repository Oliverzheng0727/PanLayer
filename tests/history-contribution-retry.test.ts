import { describe, expect, it } from "vitest";
import { historyContributionRetryDelayMinutes } from "../lib/history/contributions";

describe("history contribution retry backoff", () => {
  it("backs failed symbols off without retrying them continuously", () => {
    expect(historyContributionRetryDelayMinutes(1)).toBe(15);
    expect(historyContributionRetryDelayMinutes(2)).toBe(60);
    expect(historyContributionRetryDelayMinutes(3)).toBe(360);
    expect(historyContributionRetryDelayMinutes(4)).toBe(1_440);
    expect(historyContributionRetryDelayMinutes(20)).toBe(1_440);
  });
});
