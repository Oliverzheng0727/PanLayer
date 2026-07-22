import { describe, expect, it } from "vitest";
import { fetchWithFallback, withRetry } from "../lib/data/resilience";

describe("data-source resilience", () => {
  it("retries a failed operation twice before succeeding", async () => {
    let attempts = 0;
    const value = await withRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("temporary");
      return "ok";
    }, { retries: 2, delayMs: 0 });
    expect(value).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("marks fallback data as partial without presenting it as primary", async () => {
    const result = await fetchWithFallback(
      async () => { throw new Error("primary down"); },
      async () => [1, 2, 3],
    );
    expect(result).toMatchObject({ data: [1, 2, 3], source: "fallback", status: "partial" });
  });
});
