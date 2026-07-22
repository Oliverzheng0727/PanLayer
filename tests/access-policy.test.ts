import { describe, expect, it } from "vitest";
import { canAccessDashboard, canRunAdminJob } from "../lib/auth/access-policy";

describe("public account access policy", () => {
  it("allows any signed-in ChatGPT account to open the dashboard", () => {
    expect(canAccessDashboard("viewer@example.com")).toBe(true);
    expect(canAccessDashboard("another@example.cn")).toBe(true);
    expect(canAccessDashboard("  ")).toBe(false);
  });

  it("keeps administrative jobs restricted to the configured owner", () => {
    expect(canRunAdminJob("owner@example.com", "OWNER@example.com")).toBe(true);
    expect(canRunAdminJob("viewer@example.com", "owner@example.com")).toBe(false);
    expect(canRunAdminJob("owner@example.com", "")).toBe(false);
  });
});
