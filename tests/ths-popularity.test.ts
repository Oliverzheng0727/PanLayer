import { describe, expect, it } from "vitest";
import { fetchThsPopularitySnapshot } from "../lib/data/ths-popularity";

describe("THS popularity source", () => {
  it("keeps verified A-share top-30 rows and source metadata", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      status_code: 0,
      data: {
        stock_list: [
          {
            code: "600001",
            name: "热榜甲",
            order: 1,
            rate: "999",
            hot_rank_chg: 2,
            analyse_title: "机器人+算力",
            tag: { concept_tag: ["机器人", "算力"] },
          },
          { code: "000002", name: "*ST样本", order: 2, rate: "888" },
          { code: "600003", name: "榜外样本", order: 31, rate: "777" },
        ],
      },
    }));

    const result = await fetchThsPopularitySnapshot(
      "2026-07-27",
      new Date("2026-07-27T08:10:00.000Z"),
      fetcher,
    );

    expect(result).toMatchObject({
      source: "同花顺热榜",
      status: "partial",
      rawCount: 3,
      marketTime: "2026-07-27T15:00:00+08:00",
    });
    expect(result.items).toEqual([
      {
        symbol: "600001.SH",
        name: "热榜甲",
        rank: 1,
        rankChange: 2,
        heat: 999,
        concepts: ["机器人", "算力"],
        analysisTitle: "机器人+算力",
      },
      {
        symbol: "000002.SZ",
        name: "*ST样本",
        rank: 2,
        rankChange: 0,
        heat: 888,
        concepts: [],
        analysisTitle: null,
      },
    ]);
  });

  it("returns a failed snapshot instead of throwing or inventing rows", async () => {
    const fetcher: typeof fetch = async () => new Response("blocked", { status: 403 });
    const result = await fetchThsPopularitySnapshot("2026-07-27", new Date(), fetcher);
    expect(result.status).toBe("failed");
    expect(result.items).toEqual([]);
    expect(result.message).toContain("403");
  });
});
