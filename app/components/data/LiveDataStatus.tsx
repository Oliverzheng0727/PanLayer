export type LiveDataState = "complete" | "partial" | "failed" | "demo";

export function clockTime(value: string | null): string {
  if (!value) return "时间暂缺";
  const timezoneLess = value.match(/^\d{4}-\d{2}-\d{2}[ T](\d{2}:\d{2})(?::(\d{2}))?$/);
  if (timezoneLess) return `${timezoneLess[1]}:${timezoneLess[2] ?? "00"}`;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function LiveDataStatus({
  source,
  status,
  marketTime,
  receivedAt,
  isStale,
  marketSession = true,
  error = "",
  label = "行情",
}: {
  source: string;
  status: LiveDataState;
  marketTime: string | null;
  receivedAt: string | null;
  isStale: boolean;
  marketSession?: boolean;
  error?: string;
  label?: string;
}) {
  const failed = status === "failed" || Boolean(error);
  const effectiveStale = marketSession && isStale;
  const stateLabel = failed
    ? "更新失败 · 旧数据"
    : !marketSession
      ? "最近交易日"
      : effectiveStale
        ? "旧数据"
        : status === "complete"
          ? "完整"
          : status === "demo"
            ? "演示"
            : "部分";
  const tone = failed || effectiveStale ? "failed" : status;

  return (
    <div className={`live-data-status ${tone}`} aria-live="polite" title={error || undefined}>
      <span className="live-data-dot" />
      <strong>{label} {stateLabel}</strong>
      <span>{source}</span>
      <span>行情 {clockTime(marketTime)}</span>
      <span>接收 {clockTime(receivedAt)}</span>
    </div>
  );
}
