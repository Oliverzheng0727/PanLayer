import type { DailyReview, Quote } from "../domain/types";
import type { MorningBrief } from "../ai/morning-brief";
import type { EtfSnapshot } from "./provider";

const makeLeader = (symbol: string, name: string, sector: string, streak: number, pctChange = 10.01): Quote => ({
  symbol, name, sector, limitStreak: streak, pctChange,
  exchange: symbol.endsWith("SH") ? "SH" : "SZ", board: "MAIN", isST: false, isNoLimitDay: false,
  previousClose: 10, open: 10.3, price: 11, high: 11, low: 10.2, amount: 1_280_000_000,
  turnoverRate: 9.8, limitUpPrice: 11, limitDownPrice: 9, firstLimitTime: "09:43:16",
});

export const demoReview: DailyReview = {
  date: "2026-07-22",
  status: "demo",
  source: "演示数据 · 等待首次定时采集",
  updatedAt: "2026-07-22 16:10",
  breadth: [
    { time: "09:25", rising: 860, falling: 3291, flat: 184 },
    { time: "10:00", rising: 2091, falling: 2235, flat: 97 },
    { time: "11:00", rising: 1242, falling: 3098, flat: 88 },
    { time: "13:00", rising: 1704, falling: 2631, flat: 92 },
    { time: "14:00", rising: 1378, falling: 2954, flat: 96 },
    { time: "15:00", rising: 1530, falling: 2798, flat: 101 },
  ],
  metrics: { limitUp: 47, limitDown: 8, consecutive: 12, largeRise: 23, high120: 20, allTimeHigh: 8, marginBalance: 26978.8 },
  premium: { openPct: 1.79, closePct: 7.05, sampleSize: 12 },
  ladder: {
    first: [makeLeader("002097.SZ", "山河智能", "机器人", 1), makeLeader("600410.SH", "华胜天成", "算力", 1), makeLeader("002156.SZ", "通富微电", "半导体", 1)],
    second: [makeLeader("002837.SZ", "英维克", "液冷算力", 2), makeLeader("603011.SH", "合锻智能", "机器人", 2)],
    third: [makeLeader("002031.SZ", "巨轮智能", "机器人", 3)],
    fourth: [makeLeader("600589.SH", "大位科技", "算力", 4)],
    fivePlus: [makeLeader("603083.SH", "剑桥科技", "光模块", 6)],
  },
  sectors: [
    { name: "人形机器人", limitUpCount: 9, averagePct: 3.82, amountGrowthPct: 26.4, maxStreak: 3 },
    { name: "算力 / 光模块", limitUpCount: 7, averagePct: 3.15, amountGrowthPct: 31.2, maxStreak: 6 },
    { name: "存储芯片", limitUpCount: 6, averagePct: 2.73, amountGrowthPct: 18.7, maxStreak: 2 },
    { name: "钠离子电池", limitUpCount: 4, averagePct: 2.21, amountGrowthPct: 14.5, maxStreak: 2 },
  ],
  leaders: [makeLeader("603083.SH", "剑桥科技", "光模块", 6), makeLeader("600589.SH", "大位科技", "算力", 4), makeLeader("002031.SZ", "巨轮智能", "机器人", 3)],
};

export const demoEtfs: EtfSnapshot[] = [
  { symbol: "510300", name: "沪深300ETF", category: "宽基", price: 4.12, pctChange: 0.46, amount: 5_420_000_000, scale: 118_600_000_000 },
  { symbol: "588000", name: "科创50ETF", category: "宽基", price: 1.08, pctChange: 1.24, amount: 3_180_000_000, scale: 69_200_000_000 },
  { symbol: "159995", name: "芯片ETF", category: "半导体 / 存储", price: 1.29, pctChange: 2.18, amount: 2_860_000_000, scale: 24_600_000_000 },
  { symbol: "159819", name: "人工智能ETF", category: "AI算力", price: 1.34, pctChange: 1.72, amount: 1_920_000_000, scale: 18_700_000_000 },
  { symbol: "562500", name: "机器人ETF", category: "机器人", price: 0.94, pctChange: 2.63, amount: 1_460_000_000, scale: 12_900_000_000 },
  { symbol: "515030", name: "新能源车ETF", category: "新能源", price: 1.08, pctChange: -0.58, amount: 1_120_000_000, scale: 14_800_000_000 },
];

export const demoBrief: MorningBrief = {
  date: "2026-07-22",
  sections: [
    { title: "全球外围市场全景", items: [{ text: "美股科技板块震荡，费城半导体指数相对强势；美元与美债收益率变化仍是早盘风险偏好的主要外部变量。", sourceIds: ["s1"] }] },
    { title: "全球产业重大催化", items: [{ text: "AI算力、存储价格与人形机器人产业链仍处于高频催化窗口；重点核对海外龙头公告与供应链涨价信息。", sourceIds: ["s2"] }] },
    { title: "国内隔夜重磅信息", items: [{ text: "政策与公司公告应按半导体、电力、消费、医药和AI分类核验；演示模式不生成未经检索确认的具体新闻。", sourceIds: ["s3"] }] },
    { title: "板块利好、利空与内需映射", items: [{ text: "机器人、算力/光模块和存储芯片处于高热度区；若高开后成交额未同步放大，应降低对持续性的判断。", sourceIds: ["s4"] }] },
    { title: "盘前情绪、观察方向与风险", items: [{ text: "早盘先观察连板梯队晋级率、上涨家数扩散和主流ETF成交变化；避免把单一消息直接等同于确定性行情。", sourceIds: ["s5"] }] },
  ],
  sources: [1, 2, 3, 4, 5].map((index) => ({ id: `s${index}`, title: "演示来源占位", url: "https://example.com", publishedAt: "2026-07-22T07:00:00+08:00" })),
  disclaimer: "只做客观市场复盘，不构成投资建议。",
};
