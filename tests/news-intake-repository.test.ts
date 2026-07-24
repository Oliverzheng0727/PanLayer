import { describe, expect, it } from "vitest";
import { NEWS_INTAKE_SCHEMA_STATEMENTS, persistNewsCollection, readCurrentNewsBundle } from "../lib/ai/news-intake/repository";
import type { NewsCollectionSummary } from "../lib/ai/news-intake/types";

function collection(): NewsCollectionSummary {
  return {
    runId: "run-1",
    fetchDate: "2026-07-24",
    tier: 1,
    transport: "rss",
    status: "complete",
    startedAt: "2026-07-24T06:50:00+08:00",
    finishedAt: "2026-07-24T06:50:10+08:00",
    sourceTotal: 1,
    sourceSuccess: 1,
    rawItemCount: 1,
    keptItemCount: 1,
    filteredItemCount: 0,
    errors: [],
    sourceHealth: [{
      sourceId: "source-1",
      name: "Source",
      url: "https://example.com/feed",
      tier: 1,
      industries: ["ai"],
      status: "complete",
      latencyMs: 10,
      rawCount: 1,
      keptCount: 1,
      error: null,
    }],
    items: [{
      id: "item-1",
      runId: "run-1",
      canonicalUrl: "https://example.com/a",
      title: "AI update",
      excerpt: "Detail",
      publishedAt: "2026-07-23T23:00:00.000Z",
      receivedAt: "2026-07-24T06:50:00+08:00",
      fetchDate: "2026-07-24",
      sourceIds: ["source-1"],
      sourceNames: ["Source"],
      industries: ["ai"],
      tier: 1,
      verification: "verified",
      corroboratingUrls: [],
      filterReason: null,
    }],
  };
}

describe("news intake D1 repository", () => {
  it("declares all three idempotent tables", () => {
    expect(NEWS_INTAKE_SCHEMA_STATEMENTS.join("\n")).toContain("brief_sources");
    expect(NEWS_INTAKE_SCHEMA_STATEMENTS.join("\n")).toContain("brief_items");
    expect(NEWS_INTAKE_SCHEMA_STATEMENTS.join("\n")).toContain("brief_fetch_runs");
    expect(NEWS_INTAKE_SCHEMA_STATEMENTS.join("\n")).toContain("PRIMARY KEY");
  });

  it("persists sources, items and run metadata with upserts", async () => {
    const sql: string[] = [];
    const db = {
      prepare(statement: string) {
        sql.push(statement);
        return { bind() { return this; }, async run() { return {}; } };
      },
      async batch(statements: unknown[]) { return statements; },
    } as unknown as D1Database;

    await persistNewsCollection(db, collection());
    expect(sql.some((item) => item.includes("INSERT INTO brief_sources") && item.includes("ON CONFLICT"))).toBe(true);
    expect(sql.some((item) => item.includes("INSERT INTO brief_items") && item.includes("ON CONFLICT"))).toBe(true);
    expect(sql.some((item) => item.includes("INSERT INTO brief_fetch_runs") && item.includes("ON CONFLICT"))).toBe(true);
  });

  it("reads only items attached to the latest current-date successful run", async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() { return this; },
          async all() {
            if (sql.includes("brief_fetch_runs")) return { results: [{
              run_id: "run-2", fetch_date: "2026-07-24", status: "partial",
              finished_at: "2026-07-24T06:56:00+08:00", source_tier: 2,
            }] };
            return { results: [{
              item_id: "item-2", canonical_url: "https://example.com/b", title: "Robot",
              excerpt: null, published_at: null, received_at: "2026-07-24T06:55:00+08:00",
              fetch_date: "2026-07-24", run_id: "run-2", source_ids_json: "[\"source-2\"]",
              source_names_json: "[\"Source 2\"]", industry_keys_json: "[\"robot\"]", source_tier: 2,
              verification_status: "verified", corroborating_urls_json: "[]", filter_status: "kept", filter_reason: null,
            }] };
          },
        };
      },
    } as unknown as D1Database;

    await expect(readCurrentNewsBundle(db, "2026-07-24")).resolves.toMatchObject({
      fetchDate: "2026-07-24",
      status: "partial",
      items: [{ id: "item-2", tier: 2, verification: "verified" }],
    });
  });
});
