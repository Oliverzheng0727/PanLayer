import type { DailyReview, Quote } from "../domain/types";
import { BRIEF_SECTION_DEFINITIONS, type MorningBrief } from "../ai/morning-brief";
import type { EtfSnapshot } from "./provider";
import type { HistoryRow } from "../history/query";
import type { HighDetail } from "../history/high-details";
import { classifyEtf } from "../etf/catalog";

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

const demoEtf = (symbol: string, name: string, price: number, pctChange: number, amount: number, scale: number): EtfSnapshot => {
  const classified = classifyEtf(name);
  return { symbol, name, category: classified.category, tags: classified.tags, exchange: symbol.startsWith("5") ? "SH" : "SZ", price, pctChange, amount, averageAmount20: amount * .86, scale, turnoverRate: Number((1.2 + amount / 3e9).toFixed(2)), status: "active", updatedAt: "2026-07-22 15:00" };
};

export const demoEtfs: EtfSnapshot[] = [
  demoEtf("510300", "沪深300ETF", 4.12, .46, 5_420_000_000, 118_600_000_000),
  demoEtf("588000", "科创50ETF", 1.08, 1.24, 3_180_000_000, 69_200_000_000),
  demoEtf("159995", "芯片ETF", 1.29, 2.18, 2_860_000_000, 24_600_000_000),
  demoEtf("512480", "半导体ETF", .936, 1.73, 1_920_000_000, 22_400_000_000),
  demoEtf("159327", "存储ETF", 1.106, 1.12, 870_000_000, 8_600_000_000),
  demoEtf("159819", "人工智能ETF", 1.34, 1.72, 1_920_000_000, 18_700_000_000),
  demoEtf("516510", "云计算ETF", 1.018, .88, 740_000_000, 7_900_000_000),
  demoEtf("562500", "机器人ETF", .94, 2.63, 1_460_000_000, 12_900_000_000),
  demoEtf("512010", "医药ETF", .872, -.61, 1_120_000_000, 31_500_000_000),
  demoEtf("159992", "创新药ETF", .784, 1.34, 960_000_000, 16_200_000_000),
  demoEtf("560600", "医美ETF", 1.036, .92, 380_000_000, 4_800_000_000),
  demoEtf("516110", "美容护理ETF", .998, .67, 290_000_000, 3_900_000_000),
  demoEtf("516160", "新能源ETF", .726, -.42, 820_000_000, 14_200_000_000),
  demoEtf("515790", "光伏ETF", .684, -.87, 1_050_000_000, 19_300_000_000),
  demoEtf("159755", "电池ETF", .812, .31, 680_000_000, 9_700_000_000),
  demoEtf("515030", "新能源车ETF", 1.08, -.58, 1_120_000_000, 14_800_000_000),
  demoEtf("516590", "汽车ETF", 1.204, 1.11, 520_000_000, 8_200_000_000),
  demoEtf("512800", "银行ETF", 1.386, .18, 1_580_000_000, 42_600_000_000),
  demoEtf("159928", "消费ETF", 1.086, .54, 720_000_000, 12_600_000_000),
  demoEtf("512660", "军工ETF", 1.172, 1.06, 1_260_000_000, 21_800_000_000),
  demoEtf("515220", "煤炭ETF", 1.492, -.22, 640_000_000, 11_900_000_000),
  demoEtf("515180", "红利ETF", 1.348, .29, 980_000_000, 24_700_000_000),
  demoEtf("513100", "纳斯达克100ETF", 1.624, .82, 2_240_000_000, 33_800_000_000),
  demoEtf("513130", "恒生科技ETF", .736, 1.42, 2_680_000_000, 29_100_000_000),
  demoEtf("518880", "黄金ETF", 6.42, .35, 1_760_000_000, 52_300_000_000),
  demoEtf("511010", "国债ETF", 134.62, .03, 460_000_000, 18_400_000_000),
];

const historyDates = [
  "2026-07-22", "2026-07-21", "2026-07-20", "2026-07-17", "2026-07-16", "2026-07-15",
  "2026-07-14", "2026-07-13", "2026-07-10", "2026-07-09", "2026-07-08", "2026-07-07",
  "2026-07-06", "2026-07-03", "2026-07-02", "2026-07-01", "2026-06-30", "2026-06-29",
];
const historyRising = [1530, 3107, 1740, 482, 2499, 3351, 4211, 1720, 2864, 2018, 1638, 3480, 2921, 1180, 2264, 3068, 1792, 2540];
const historyLimitUp = [47, 121, 53, 33, 42, 72, 81, 29, 92, 75, 47, 66, 79, 38, 56, 84, 41, 63];
const historyLimitDown = [8, 21, 12, 19, 33, 31, 22, 17, 4, 12, 41, 9, 15, 52, 18, 7, 29, 11];
const historySectors = ["电子 / 算力", "医药 / 芯片", "汽车 / 电池", "银行 / 红利", "医药 / 电子", "基础化工 / 机器人", "医药 / 通信", "电子 / 计算机", "机械设备 / 军工", "电子 / 通信", "消费 / 医药", "机器人 / 汽车", "医药 / 机械", "红利 / 银行", "半导体 / 存储", "新能源 / 光伏", "消费 / 汽车", "算力 / 通信"];

export const demoHistory: HistoryRow[] = historyDates.map((date, index) => {
  const flat = 70 + index % 6 * 9;
  const falling = 4429 - historyRising[index] - flat;
  return {
    date,
    rising: historyRising[index],
    falling,
    flat,
    riseFallRatio: Number((historyRising[index] / falling).toFixed(2)),
    limitUp: historyLimitUp[index],
    limitDown: historyLimitDown[index],
    largeRise: Math.max(6, Math.round(historyLimitUp[index] * 0.55)),
    brokenCount: null,
    largeDownCount: null,
    sealRate: null,
    yesterdaySuccessRate: null,
    continuationPositiveRate: null,
    continuationAveragePct: null,
    continuationPromotionRate: null,
    marketAmount: null,
    consecutive: [12, 5, 7, 9, 10, 16, 6, 10, 10, 6, 8, 11, 14, 5, 7, 13, 6, 9][index],
    maxStreak: [6, 4, 3, 4, 3, 5, 3, 4, 4, 3, 3, 5, 5, 3, 4, 5, 3, 4][index],
    maxBoardNames: "—",
    brokenBoardCount: null,
    brokenBoardRate: null,
    cycleLeader: "无明确周期龙头",
    recognition: "—",
    indexSummary: "暂缺",
    openPremium: [1.79, 2.2, -0.3, -1.2, 0.8, 3.1, 1.3, -0.6, 2.7, 0.9, -1.1, 2.4, 1.8, -2.1, 0.6, 3.2, -0.4, 1.1][index],
    closePremium: [7.05, 3.16, -0.82, -2.14, 1.42, 5.08, 2.17, -1.03, 4.21, 1.66, -2.32, 3.87, 2.92, -3.04, 1.13, 5.44, -0.91, 2.08][index],
    high120: [20, 19, 17, 16, 21, 39, 16, 33, 47, 23, 18, 45, 79, 14, 28, 36, 20, 31][index],
    allTimeHigh: [8, 2, 4, 4, 4, 9, 7, 15, 47, 23, 16, 20, 31, 8, 12, 18, 10, 15][index],
    marginBalance: Number((26_900 + index * 11.8).toFixed(2)),
    topSector: historySectors[index],
    backfilled: false,
    status: "demo",
    source: "演示历史 · 正式上线后由每日任务替换",
    updatedAt: `${date} 16:10`,
  };
});

const detailSectors = ["半导体", "医药", "机器人", "汽车", "新能源", "算力", "消费", "通信", "军工", "有色"];

export const demoHighDetailsByDate: Record<string, HighDetail[]> = Object.fromEntries(demoHistory.map((row, rowIndex) => {
  const total120 = row.high120 ?? 0;
  const totalAllTime = row.allTimeHigh ?? 0;
  const base = Array.from({ length: total120 }, (_, index): HighDetail => {
    const code = String(600001 + rowIndex * 100 + index).padStart(6, "0");
    const sector = detailSectors[index % detailSectors.length];
    return {
      date: row.date,
      type: "120d",
      symbol: `${code}.SH`,
      name: `${sector}演示标的${String(index + 1).padStart(2, "0")}`,
      sector,
      pctChange: Number((1.2 + (index * 1.37) % 8.5).toFixed(2)),
      close: Number((12 + index * 1.83).toFixed(2)),
      highPrice: Number((12 + index * 1.83).toFixed(2)),
      amount: 260_000_000 + index * 137_000_000,
      intervalPct: Number((18 + (index * 7.3) % 64).toFixed(2)),
      highDate: row.date,
      isAllTime: index < totalAllTime,
    };
  });
  const allTime = base.slice(0, totalAllTime).map((item, index): HighDetail => ({
    ...item,
    type: "all-time",
    intervalPct: Number((72 + index * 18.6).toFixed(2)),
    isAllTime: true,
  }));
  return [row.date, [...base, ...allTime]];
}));

/** Local-only fixture. Production callers must render an unavailable brief instead. */
export const demoBrief: MorningBrief = {
  schemaVersion: 2,
  date: "2026-07-22",
  status: "partial",
  generatedAt: "2026-07-22T07:15:00+08:00",
  sections: BRIEF_SECTION_DEFINITIONS.map((definition) => ({
    key: definition.key,
    title: definition.title,
    summary: "本地开发预览；生产环境仅显示已持久化的联网早参。",
    tags: ["本地预览"],
    status: "partial" as const,
    generatedAt: "2026-07-22T07:15:00+08:00",
    blocks: [{ type: "callout" as const, tone: "missing" as const, text: "本地开发演示内容；生产环境不提供演示早参。", sourceIds: [] }],
    sourceIds: [],
  })),
  sources: [],
  disclaimer: "只做客观市场复盘，不构成投资建议。",
};
