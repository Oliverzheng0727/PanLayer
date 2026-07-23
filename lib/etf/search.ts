import type { EtfCategory, EtfSortField } from "./catalog";

export interface EtfSearchRequest {
  query: string;
  category: EtfCategory;
  sort: EtfSortField;
  order: "asc" | "desc";
  limit?: number;
}

export function buildEtfSearchUrl(request: EtfSearchRequest): string {
  const params = new URLSearchParams({
    category: request.category,
    query: request.query.trim(),
    sort: request.sort,
    order: request.order,
    cursor: "0",
    limit: String(Math.min(100, Math.max(1, request.limit ?? 100))),
  });
  return `/api/v1/etfs?${params.toString()}`;
}
