import { getChatGPTUser, requireChatGPTUser } from "./chatgpt-auth";
import { canAccessDashboard, canRunAdminJob } from "../lib/auth/access-policy";

export async function requireAllowedUser(returnTo: string) {
  if (process.env.NODE_ENV === "development") {
    return (await getChatGPTUser()) ?? { displayName: "本地预览", email: "local@panlayer.dev", fullName: "本地预览" };
  }
  const user = await requireChatGPTUser(returnTo);
  if (!canAccessDashboard(user.email)) throw new Error("无法识别当前 ChatGPT 账号");
  return user;
}

export async function authorizeApi(): Promise<Response | null> {
  if (process.env.NODE_ENV === "development") return null;
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "authentication required" }, { status: 401 });
  return canAccessDashboard(user.email)
    ? null
    : Response.json({ error: "forbidden" }, { status: 403 });
}

export async function authorizeAdminApi(): Promise<Response | null> {
  if (process.env.NODE_ENV === "development") return null;
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "authentication required" }, { status: 401 });
  return await isAdminUser(user.email)
    ? null
    : Response.json({ error: "administrator required" }, { status: 403 });
}

export async function isAdminUser(email: string): Promise<boolean> {
  return canRunAdminJob(email, await resolveAdminEmail());
}

async function resolveAdminEmail(): Promise<string> {
  const configured = String(
    process.env.ADMIN_USER_EMAIL ?? process.env.ALLOWED_USER_EMAIL ?? "",
  ).trim();
  if (configured) return configured;
  try {
    const { env } = await import("cloudflare:workers");
    const runtimeEnv = env as unknown as Record<string, unknown>;
    return String(runtimeEnv.ADMIN_USER_EMAIL ?? runtimeEnv.ALLOWED_USER_EMAIL ?? "").trim();
  } catch {
    return "";
  }
}
