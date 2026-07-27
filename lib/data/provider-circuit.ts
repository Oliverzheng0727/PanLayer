export interface ProviderCircuitState {
  dataset: string;
  reason: string;
  openedAt: string;
  retryAt: string;
}

const CIRCUIT_PREFIX = "provider-circuit:";
const CIRCUIT_DURATION_MS = 24 * 60 * 60_000;

export function isProviderPermissionFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(?:^|\s)403(?:\s|$)|forbidden|permission|无权限/i.test(message);
}

export async function readProviderCircuit(
  db: D1Database,
  dataset: string,
  now = new Date(),
): Promise<ProviderCircuitState | null> {
  const row = await db.prepare(
    "SELECT value FROM bootstrap_state WHERE key = ?",
  ).bind(`${CIRCUIT_PREFIX}${dataset}`).first<{ value: string }>().catch(() => null);
  if (!row?.value) return null;
  try {
    const state = JSON.parse(row.value) as ProviderCircuitState;
    if (!state.retryAt || new Date(state.retryAt).getTime() <= now.getTime()) return null;
    return state;
  } catch {
    return null;
  }
}

export async function openProviderCircuit(
  db: D1Database,
  dataset: string,
  reason: string,
  now = new Date(),
): Promise<ProviderCircuitState> {
  const state: ProviderCircuitState = {
    dataset,
    reason,
    openedAt: now.toISOString(),
    retryAt: new Date(now.getTime() + CIRCUIT_DURATION_MS).toISOString(),
  };
  await db.prepare(
    `INSERT INTO bootstrap_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  ).bind(`${CIRCUIT_PREFIX}${dataset}`, JSON.stringify(state), state.openedAt).run();
  return state;
}

export async function closeProviderCircuit(
  db: D1Database,
  dataset: string,
): Promise<void> {
  await db.prepare("DELETE FROM bootstrap_state WHERE key = ?")
    .bind(`${CIRCUIT_PREFIX}${dataset}`)
    .run()
    .catch(() => undefined);
}
