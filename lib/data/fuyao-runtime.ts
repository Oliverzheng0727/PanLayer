import type { FuyaoMcpOptions } from "./fuyao-mcp";

export async function resolveFuyaoRuntimeOptions(): Promise<FuyaoMcpOptions | null> {
  let apiKey = String(process.env.FUYAO_API_KEY ?? "").trim();
  let baseUrl = String(process.env.FUYAO_MCP_BASE_URL ?? "").trim();
  if (!apiKey) {
    try {
      const { env } = await import("cloudflare:workers");
      const runtime = env as unknown as Record<string, unknown>;
      apiKey = String(runtime.FUYAO_API_KEY ?? "").trim();
      baseUrl = baseUrl || String(runtime.FUYAO_MCP_BASE_URL ?? "").trim();
    } catch {
      apiKey = "";
    }
  }
  return apiKey ? { apiKey, baseUrl: baseUrl || undefined } : null;
}
