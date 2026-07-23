import { describe, expect, it } from "vitest";
import { buildEtfSearchUrl } from "../lib/etf/search";

describe("ETF remote search", () => {
  it("builds an encoded full-catalog request with the active table state", () => {
    expect(buildEtfSearchUrl({
      query: " 芯片 ETF ",
      category: "半导体存储",
      sort: "amount",
      order: "asc",
      limit: 80,
    })).toBe("/api/v1/etfs?category=%E5%8D%8A%E5%AF%BC%E4%BD%93%E5%AD%98%E5%82%A8&query=%E8%8A%AF%E7%89%87+ETF&sort=amount&order=asc&cursor=0&limit=80");
  });

  it("caps result pages to the API maximum", () => {
    expect(buildEtfSearchUrl({
      query: "159",
      category: "全部",
      sort: "averageAmount20",
      order: "desc",
      limit: 500,
    })).toContain("limit=100");
  });
});
