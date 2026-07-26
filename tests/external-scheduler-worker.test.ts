import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function loadSchedulerModule() {
  const moduleUrl = new URL("../scheduler-worker/index.js", import.meta.url).href;
  return import(/* @vite-ignore */ moduleUrl).catch(() => ({} as Record<string, unknown>));
}

describe("independent Cloudflare scheduler worker", () => {
  it("posts one authenticated tick to PanLayer", async () => {
    const scheduler = await loadSchedulerModule() as {
      triggerPanLayerScheduler?: (
        env: { PANLAYER_TARGET_URL: string; PANLAYER_CRON_SECRET: string },
        fetcher: typeof fetch,
      ) => Promise<{ status: number; body: string }>;
    };
    expect(scheduler.triggerPanLayerScheduler).toBeTypeOf("function");

    let received: { input: RequestInfo | URL; init?: RequestInit } | null = null;
    const result = await scheduler.triggerPanLayerScheduler!(
      {
        PANLAYER_TARGET_URL: "https://example.com/api/v1/internal/scheduler/tick",
        PANLAYER_CRON_SECRET: "scheduler-secret",
      },
      async (input, init) => {
        received = { input, init };
        return new Response('{"ok":true}', { status: 200 });
      },
    );

    expect(received).toMatchObject({
      input: "https://example.com/api/v1/internal/scheduler/tick",
      init: {
        method: "POST",
        headers: { Authorization: "Bearer scheduler-secret" },
      },
    });
    expect(result).toEqual({ status: 200, body: '{"ok":true}' });
  });

  it("fails the scheduled event when PanLayer rejects the tick", async () => {
    const scheduler = await loadSchedulerModule() as {
      triggerPanLayerScheduler?: (
        env: { PANLAYER_TARGET_URL: string; PANLAYER_CRON_SECRET: string },
        fetcher: typeof fetch,
      ) => Promise<unknown>;
    };
    expect(scheduler.triggerPanLayerScheduler).toBeTypeOf("function");

    await expect(scheduler.triggerPanLayerScheduler!(
      {
        PANLAYER_TARGET_URL: "https://example.com/api/v1/internal/scheduler/tick",
        PANLAYER_CRON_SECRET: "scheduler-secret",
      },
      async () => new Response("unauthorized", { status: 401 }),
    )).rejects.toThrow("PanLayer scheduler tick failed: 401 unauthorized");
  });

  it("declares the hourly recovery and exact market crons without storing the secret", async () => {
    const config = await readFile(
      new URL("../scheduler-worker/wrangler.jsonc", import.meta.url),
      "utf8",
    ).catch(() => "");

    expect(config).toContain('"17 * * * *"');
    expect(config).toContain('"compatibility_date": "2026-07-24"');
    expect(config).toContain('"workers_dev": false');
    expect(config).toContain('"50,55 22 * * *"');
    expect(config).toContain('"15,30 23,0 * * *"');
    expect(config).toContain('"30 17 * * *"');
    expect(config).toContain('"0,10,25,30 1-8 * * MON-FRI"');
    expect(config.match(/"[^\"]+\* \* [A-Z*-]+"/g)).toHaveLength(5);
    expect(config).toContain('"PANLAYER_TARGET_URL"');
    expect(config).not.toContain("PANLAYER_CRON_SECRET");
  });
});
