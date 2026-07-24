export async function triggerPanLayerScheduler(env, fetcher = fetch) {
  const targetUrl = String(env.PANLAYER_TARGET_URL ?? "").trim();
  const secret = String(env.PANLAYER_CRON_SECRET ?? "").trim();
  if (!targetUrl) throw new Error("PANLAYER_TARGET_URL is not configured");
  if (!secret) throw new Error("PANLAYER_CRON_SECRET is not configured");

  const response = await fetcher(targetUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`PanLayer scheduler tick failed: ${response.status} ${body}`);
  }
  return { status: response.status, body };
}

export default {
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

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(triggerPanLayerScheduler(env));
  },
};
