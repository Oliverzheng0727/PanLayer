export async function withRetry<T>(
  operation: () => Promise<T>,
  options: { retries?: number; delayMs?: number } = {},
): Promise<T> {
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 160;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < retries && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

export async function fetchWithFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<{ data: T; source: "primary" | "fallback"; status: "complete" | "partial" }> {
  try {
    return { data: await withRetry(primary), source: "primary", status: "complete" };
  } catch {
    return { data: await withRetry(fallback), source: "fallback", status: "partial" };
  }
}
