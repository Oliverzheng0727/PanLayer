export interface NewHighProgress {
  targetDate: string;
  /** Reusable full-history baselines. This is the legacy completed field. */
  completed: number;
  currentCursor?: number;
  target: number;
  /** States refreshed through targetDate. Optional for old API fixtures. */
  dailyCompleted?: number;
  dailyRemaining?: number;
  dailyCoveragePct?: number;
  dailyReady?: boolean;
  dailyComplete?: boolean;
  rebuildPending?: number;
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
  currentCursor?: number;
  dailyCompleted?: number;
  rebuildPending?: number;
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
  const dailyCompleted = Math.min(
    target,
    Math.max(0, Math.trunc(input.dailyCompleted ?? completed)),
  );
  const dailyCoveragePct = target > 0
    ? Number((dailyCompleted / target * 100).toFixed(2))
    : 0;
  const dailyReady = hasFullUniverse && dailyCoveragePct >= 95;
  return {
    targetDate: input.targetDate,
    completed,
    currentCursor: Math.max(0, Math.trunc(input.currentCursor ?? completed)),
    target,
    dailyCompleted,
    dailyRemaining: Math.max(0, target - dailyCompleted),
    dailyCoveragePct,
    dailyReady,
    dailyComplete: hasFullUniverse && dailyCompleted === target,
    rebuildPending: Math.max(0, Math.trunc(input.rebuildPending ?? 0)),
    failed,
    remaining: Math.max(0, target - completed),
    coveragePct,
    minimumTarget,
    universeComplete: hasFullUniverse,
    ready: hasFullUniverse && coveragePct >= 95 && dailyReady,
    complete: hasFullUniverse && completed === target && dailyCompleted === target,
    updatedAt: input.updatedAt,
  };
}

export function formatNewHighProgress(progress: NewHighProgress): string {
  if (progress.target === 0) return "历史行情初始化等待股票库";
  if (!progress.universeComplete) {
    return `股票库补全中 ${progress.target}/${progress.minimumTarget}+`;
  }
  const failed = progress.failed > 0 ? ` · 失败 ${progress.failed}` : "";
  const dailyCompleted = progress.dailyCompleted ?? progress.completed;
  const dailyCoveragePct = progress.dailyCoveragePct ?? progress.coveragePct;
  return `历史基线 ${progress.coveragePct.toFixed(2)}% · ${progress.completed}/${progress.target}` +
    ` · 今日刷新 ${dailyCoveragePct.toFixed(2)}% · ${dailyCompleted}/${progress.target}${failed}`;
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
