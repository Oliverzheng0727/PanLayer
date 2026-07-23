import { isBeijingMarketSession } from "./refresh-policy";

export function shouldPoll({ visible, kind, now }: { visible: boolean; kind: "etf" | "breadth"; now: Date }): boolean {
  if (!visible) return false;
  return kind === "etf" || isBeijingMarketSession(now);
}
