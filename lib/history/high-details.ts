export type HighDetailType = "20d" | "120d" | "all-time";
export type HighDetailSort = "name" | "pctChange" | "amount" | "intervalPct";
export type HighDetailOrder = "asc" | "desc";

export interface HighDetail {
  date: string;
  type: HighDetailType;
  symbol: string;
  name: string;
  sector: string;
  pctChange: number;
  close: number;
  highPrice: number;
  amount: number;
  intervalPct: number;
  highDate: string;
  isAllTime: boolean;
}

export interface HighDetailQuery {
  type: HighDetailType;
  query: string;
  sort: HighDetailSort;
  order: HighDetailOrder;
}

export const HIGH_DETAIL_SORT_FIELDS: HighDetailSort[] = ["name", "pctChange", "amount", "intervalPct"];

export function parseHighDetailQuery(params: URLSearchParams): HighDetailQuery {
  const type = params.get("type") ?? "120d";
  if (type !== "20d" && type !== "120d" && type !== "all-time") throw new Error("invalid high detail type");
  const sort = params.get("sort") ?? "amount";
  if (!HIGH_DETAIL_SORT_FIELDS.includes(sort as HighDetailSort)) throw new Error("invalid high detail sort");
  const order = params.get("order") ?? "desc";
  if (order !== "asc" && order !== "desc") throw new Error("invalid high detail order");
  return { type, query: (params.get("query") ?? "").trim(), sort: sort as HighDetailSort, order };
}

export function queryHighDetails(items: HighDetail[], query: HighDetailQuery): HighDetail[] {
  const needle = query.query.toLocaleLowerCase("zh-CN");
  const direction = query.order === "asc" ? 1 : -1;
  return items
    .filter((item) => item.type === query.type && (!needle || `${item.name}${item.symbol}${item.sector}`.toLocaleLowerCase("zh-CN").includes(needle)))
    .toSorted((left, right) => {
      const leftValue = left[query.sort];
      const rightValue = right[query.sort];
      const compared = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), "zh-CN");
      return compared === 0 ? left.symbol.localeCompare(right.symbol) : compared * direction;
    });
}
