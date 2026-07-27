export async function triggerPanLayerScheduler(env, fetcher = fetch, scheduledTime = Date.now()) {
  const targetUrl = String(env.PANLAYER_TARGET_URL ?? "").trim();
  const secret = String(env.PANLAYER_CRON_SECRET ?? "").trim();
  if (!targetUrl) throw new Error("PANLAYER_TARGET_URL is not configured");
  if (!secret) throw new Error("PANLAYER_CRON_SECRET is not configured");

  const response = await fetcher(targetUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "X-PanLayer-Scheduler": "cloudflare",
      "X-PanLayer-Scheduled-Time": String(scheduledTime),
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`PanLayer scheduler tick failed: ${response.status} ${body}`);
  }
  return { status: response.status, body };
}

const worker = {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({
        service: "panlayer-background-scheduler",
        status: "ready",
      });
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(triggerPanLayerScheduler(env, fetch, controller.scheduledTime));
  },
};

export default worker;
