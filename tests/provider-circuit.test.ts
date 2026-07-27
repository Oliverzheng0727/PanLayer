import { describe, expect, it } from "vitest";
import {
  closeProviderCircuit,
  isProviderPermissionFailure,
  openProviderCircuit,
  readProviderCircuit,
} from "../lib/data/provider-circuit";

function memoryDb() {
  const values = new Map<string, string>();
  return {
    values,
    db: {
      prepare(sql: string) {
        let parameters: unknown[] = [];
        return {
          bind(...next: unknown[]) {
            parameters = next;
            return this;
          },
          async first() {
            if (!sql.startsWith("SELECT")) return null;
            const value = values.get(String(parameters[0]));
            return value ? { value } : null;
          },
          async run() {
            if (sql.startsWith("INSERT")) values.set(String(parameters[0]), String(parameters[1]));
            if (sql.startsWith("DELETE")) values.delete(String(parameters[0]));
            return {};
          },
        };
      },
    } as unknown as D1Database,
  };
}

describe("provider circuit breaker", () => {
  it("recognizes permission failures without confusing generic timeouts", () => {
    expect(isProviderPermissionFailure(new Error("HTTP 403 Forbidden"))).toBe(true);
    expect(isProviderPermissionFailure(new Error("接口无权限"))).toBe(true);
    expect(isProviderPermissionFailure(new Error("request timeout"))).toBe(false);
  });

  it("holds a permission-denied dataset open for 24 hours and can reset it", async () => {
    const { db } = memoryDb();
    const now = new Date("2026-07-24T08:00:00.000Z");
    const opened = await openProviderCircuit(db, "fuyao:anomalies", "HTTP 403", now);

    expect(opened.retryAt).toBe("2026-07-25T08:00:00.000Z");
    expect(await readProviderCircuit(
      db,
      "fuyao:anomalies",
      new Date("2026-07-25T07:59:00.000Z"),
    )).toMatchObject({ reason: "HTTP 403" });
    expect(await readProviderCircuit(
      db,
      "fuyao:anomalies",
      new Date("2026-07-25T08:00:00.000Z"),
    )).toBeNull();

    await closeProviderCircuit(db, "fuyao:anomalies");
    expect(await readProviderCircuit(db, "fuyao:anomalies", now)).toBeNull();
  });
});
