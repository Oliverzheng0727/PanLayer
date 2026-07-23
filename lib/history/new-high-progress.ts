export interface NewHighProgress {
  targetDate: string;
  completed: number;
  target: number;
  failed: number;
  remaining: number;
  coveragePct: number;
  minimumTarget: number;
  universeComplete: boolean;
  ready: boolean;
  complete: boolean;
  updatedAt: string | null;
}

export function buildNewHighProgress(input: {
  targetDate: string;
  completed: number;
  target: number;
  failed: number;
  updatedAt: string | null;
  minimumTarget?: number;
}): NewHighProgress {
  const target = Math.max(0, Math.trunc(input.target));
  const completed = Math.min(target, Math.max(0, Math.trunc(input.completed)));
  const failed = Math.max(0, Math.trunc(input.failed));
  const coveragePct = target > 0
    ? Number((completed / target * 100).toFixed(2))
    : 0;
  const minimumTarget = input.minimumTarget ?? 1;
  const hasFullUniverse = target >= minimumTarget;
  return {
    targetDate: input.targetDate,
    completed,
    target,
    failed,
    remaining: Math.max(0, target - completed),
    coveragePct,
    minimumTarget,
    universeComplete: hasFullUniverse,
    ready: hasFullUniverse && coveragePct >= 95,
    complete: hasFullUniverse && completed === target,
    updatedAt: input.updatedAt,
  };
}

export function formatNewHighProgress(progress: NewHighProgress): string {
  if (progress.target === 0) return "历史行情初始化等待股票库";
  if (!progress.universeComplete) {
    return `股票库补全中 ${progress.target}/${progress.minimumTarget}+`;
  }
  const failed = progress.failed > 0 ? ` · 失败 ${progress.failed}` : "";
  return `历史行情初始化 ${progress.coveragePct.toFixed(2)}% · ${progress.completed}/${progress.target}${failed}`;
}

export function parseNewHighBootstrapFailureCount(message: string | null | undefined): number {
  const match = message?.match(/(?:^|;\s*)failed\s+(\d+)(?:;|$)/);
  return match ? Number(match[1]) : 0;
}

export function resolveNewHighProgressTargetDate(
  requestedDate: string,
  persistedDate: string | null | undefined,
): string {
  return persistedDate && persistedDate <= requestedDate ? persistedDate : requestedDate;
}
