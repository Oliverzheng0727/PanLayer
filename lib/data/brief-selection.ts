import type { MorningBrief } from "../ai/morning-brief-contract";

export function selectDashboardBrief(
  exact: MorningBrief | null,
  latest: MorningBrief | null,
): MorningBrief | null {
  return exact ?? latest;
}
