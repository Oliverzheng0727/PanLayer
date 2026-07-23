import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { etfCatalogCache } from "../db/schema";

describe("ETF catalog cache schema", () => {
  it("defines the durable ETF catalog table", () => {
    expect(getTableName(etfCatalogCache)).toBe("etf_catalog_cache");
  });
});
