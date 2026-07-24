import { describe, expect, it } from "vitest";
import {
  isValidSchedulerAuthorization,
  planRemoteSchedulerJobs,
} from "../lib/jobs/remote-scheduler";

describe("remote scheduler", () => {
  it("accepts only the configured bearer secret", () => {
    expect(isValidSchedulerAuthorization("Bearer scheduler-secret", "scheduler-secret")).toBe(true);
    expect(isValidSchedulerAuthorization("Bearer wrong-secret", "scheduler-secret")).toBe(false);
    expect(isValidSchedulerAuthorization(null, "scheduler-secret")).toBe(false);
    expect(isValidSchedulerAuthorization("Bearer scheduler-secret", "")).toBe(false);
  });

  it("plans the evening new-high batch and outstanding catch-up work", () => {
    const jobs = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T13:10:00.000Z"),
      checkpoints: [],
    });

    expect(jobs.some((job) => job.type === "new-high-bootstrap")).toBe(true);
    expect(jobs.length).toBeLessThanOrEqual(2);
  });

  it("still plans the intended batch when GitHub starts a few minutes late", () => {
    const jobs = planRemoteSchedulerJobs({
      now: new Date("2026-07-24T13:12:00.000Z"),
      checkpoints: [],
    });

    expect(jobs.some((job) => job.type === "new-high-bootstrap")).toBe(true);
  });
});
