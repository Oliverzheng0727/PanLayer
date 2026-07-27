const STANDARD_BREADTH_RECOVERY_MINUTES = 20;
const OPENING_BREADTH_RECOVERY_MINUTES = 365;

export function breadthRecoveryMinutes(time: string): number {
  return time === "09:25"
    ? OPENING_BREADTH_RECOVERY_MINUTES
    : STANDARD_BREADTH_RECOVERY_MINUTES;
}

export function breadthRecoveryWindowMs(time: string): number {
  return breadthRecoveryMinutes(time) * 60_000;
}
