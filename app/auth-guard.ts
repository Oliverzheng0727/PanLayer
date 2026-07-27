import { getChatGPTUser, requireChatGPTUser } from "./chatgpt-auth";
import { canAccessDashboard } from "../lib/auth/access-policy";

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
