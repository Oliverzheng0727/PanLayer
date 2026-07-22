import { getChatGPTUser, requireChatGPTUser } from "./chatgpt-auth";

export async function requireAllowedUser(returnTo: string) {
  if (process.env.NODE_ENV === "development") {
    return (await getChatGPTUser()) ?? { displayName: "本地预览", email: "local@panlayer.dev", fullName: "本地预览" };
  }
  const user = await requireChatGPTUser(returnTo);
  let allowed = String(process.env.ALLOWED_USER_EMAIL ?? "").trim().toLowerCase();
  if (!allowed) {
    try {
      const { env } = await import("cloudflare:workers");
      allowed = String((env as unknown as Record<string, unknown>).ALLOWED_USER_EMAIL ?? "").trim().toLowerCase();
    } catch { /* Node render tests do not expose cloudflare: imports. */ }
  }
  if (allowed && user.email.toLowerCase() !== allowed) throw new Error("当前账号不在 PanLayer 访问白名单中");
  return user;
}

export async function authorizeApi(): Promise<Response | null> {
  if (process.env.NODE_ENV === "development") return null;
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "authentication required" }, { status: 401 });
  let allowed = String(process.env.ALLOWED_USER_EMAIL ?? "").trim().toLowerCase();
  if (!allowed) {
    try {
      const { env } = await import("cloudflare:workers");
      allowed = String((env as unknown as Record<string, unknown>).ALLOWED_USER_EMAIL ?? "").trim().toLowerCase();
    } catch { /* ignored */ }
  }
  return allowed && user.email.toLowerCase() !== allowed
    ? Response.json({ error: "forbidden" }, { status: 403 })
    : null;
}
