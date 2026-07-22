export type GlobalPointStatus = "ok" | "unconfigured" | "failed";

export interface GlobalInstrument {
  key: string;
  symbol: string;
  label: string;
  period: string;
}

export interface OfficialSeries {
  key: string;
  label: string;
  period: string;
}

export interface FredSeries extends OfficialSeries {
  seriesId: string;
}

export interface EiaSeries extends OfficialSeries {
  route: string;
  valueField: string;
}

export interface GlobalPoint {
  key: string;
  label: string;
  provider: string;
  value: number | null;
  previousClose: number | null;
  pctChange: number | null;
  marketTime: string | null;
  receivedAt: string;
  period: string;
  status: GlobalPointStatus;
  message: string;
}

export type ReconciledGlobalStatus = "cross-checked" | "official" | "partial" | "failed" | "unconfigured";

export interface ReconciledGlobalPoint extends Omit<GlobalPoint, "provider" | "status"> {
  providers: string[];
  status: ReconciledGlobalStatus;
}

export function unavailableGlobalPoint(
  item: Pick<GlobalInstrument, "key" | "label" | "period">,
  provider: string,
  status: "unconfigured" | "failed",
  message: string,
): GlobalPoint {
  return {
    key: item.key,
    label: item.label,
    provider,
    value: null,
    previousClose: null,
    pctChange: null,
    marketTime: null,
    receivedAt: new Date().toISOString(),
    period: item.period,
    status,
    message,
  };
}
