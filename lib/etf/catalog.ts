import type { EtfSnapshot } from "../data/provider";

export const ETF_CATEGORIES = [
  "全部", "宽基指数", "科技AI", "通信光模块", "半导体存储", "机器人制造", "医药医疗", "美容护理",
  "新能源", "汽车", "电力公用", "食品饮料", "家电家居", "传媒游戏", "消费农业",
  "金融", "地产基建", "军工", "有色金属", "化工材料", "资源周期", "红利策略", "港股",
  "海外指数", "商品", "债券货币", "其他",
] as const;

export type EtfCategory = (typeof ETF_CATEGORIES)[number];
export type EtfSortField = "price" | "pctChange" | "amount" | "averageAmount20" | "scale" | "turnoverRate";

export interface EtfQuery {
  category: EtfCategory;
  query: string;
  sort: EtfSortField;
  order: "asc" | "desc";
  cursor: number;
  limit: number;
}

export interface EtfPage { items: EtfSnapshot[]; nextCursor: number | null; total: number }

export interface EtfCategoryCount { category: EtfCategory; count: number }

const rules: Array<{ category: Exclude<EtfCategory, "全部" | "其他">; pattern: RegExp; tags: string[] }> = [
  { category: "美容护理", pattern: /医美|医疗美容|美容|美妆|化妆品|护肤|日化|个护/, tags: ["医美", "美容护理", "消费"] },
  { category: "半导体存储", pattern: /半导体|芯片|集成电路|存储|科创芯片/, tags: ["半导体", "芯片", "存储"] },
  { category: "机器人制造", pattern: /机器人|工业母机|智能制造|高端装备|机械/, tags: ["机器人", "智能制造"] },
  { category: "汽车", pattern: /汽车|智能车|新能源车|电动车|车联网|智能驾驶/, tags: ["汽车", "智能驾驶"] },
  { category: "新能源", pattern: /新能源|光伏|储能|锂电|电池|风电|绿色电力|碳中和/, tags: ["新能源", "光伏", "储能", "电池"] },
  { category: "电力公用", pattern: /电力|公用事业|水务|燃气/, tags: ["电力", "公用事业"] },
  { category: "医药医疗", pattern: /医药|医疗|创新药|中药|生物|疫苗|医疗器械|养老/, tags: ["医药", "医疗", "创新药"] },
  { category: "通信光模块", pattern: /通信|5G|光模块|光通信|卫星通信/, tags: ["通信", "光模块", "5G"] },
  { category: "科技AI", pattern: /科技|人工智能|AI|算力|云计算|计算机|软件|大数据|互联网/, tags: ["科技", "AI", "算力"] },
  { category: "食品饮料", pattern: /食品|饮料|白酒|啤酒|乳业|调味品/, tags: ["食品", "饮料", "消费"] },
  { category: "家电家居", pattern: /家电|家居|家装|厨卫/, tags: ["家电", "家居", "消费"] },
  { category: "传媒游戏", pattern: /传媒|游戏|影视|动漫|文化|数字媒体/, tags: ["传媒", "游戏", "内容"] },
  { category: "消费农业", pattern: /消费|农业|畜牧|养殖|旅游|零售/, tags: ["消费", "农业"] },
  { category: "金融", pattern: /银行|证券|券商|保险|金融/, tags: ["金融", "银行", "证券"] },
  { category: "地产基建", pattern: /房地产|地产|基建|建筑|建材/, tags: ["地产", "基建", "建筑"] },
  { category: "军工", pattern: /军工|国防|航空|航天|卫星/, tags: ["军工", "航空航天"] },
  { category: "商品", pattern: /黄金|白银|原油|豆粕|商品|有色金属期货/, tags: ["商品"] },
  { category: "有色金属", pattern: /有色|稀土|铜|铝|锂矿|金属/, tags: ["有色", "金属", "资源"] },
  { category: "化工材料", pattern: /化工|化学|基础化工|新材料/, tags: ["化工", "材料", "周期"] },
  { category: "资源周期", pattern: /煤炭|钢铁|能源|资源|石油|矿业/, tags: ["资源", "周期"] },
  { category: "红利策略", pattern: /红利|低波|价值|成长|质量|央企|国企|ESG/, tags: ["红利", "策略"] },
  { category: "港股", pattern: /恒生|港股|香港|中概互联/, tags: ["港股", "跨境"] },
  { category: "海外指数", pattern: /纳斯达克|纳指|标普|道琼斯|日经|德国|法国|印度|越南|海外|全球|美股/, tags: ["海外", "跨境"] },
  { category: "债券货币", pattern: /国债|债券|信用债|可转债|货币|现金|同业存单/, tags: ["债券", "货币"] },
  { category: "宽基指数", pattern: /沪深300|中证500|中证1000|上证50|科创50|创业板|深证|上证|A500|宽基/, tags: ["宽基"] },
];

export function classifyEtf(name: string): { category: Exclude<EtfCategory, "全部">; tags: string[] } {
  const matched = rules.find((rule) => rule.pattern.test(name));
  return matched ? { category: matched.category, tags: [...matched.tags] } : { category: "其他", tags: ["其他"] };
}

export function buildEtfCategoryCounts(items: EtfSnapshot[]): EtfCategoryCount[] {
  return ETF_CATEGORIES.map((category) => ({
    category,
    count: category === "全部" ? items.length : items.filter((item) => item.category === category).length,
  }));
}

function compareNullable(left: number | null, right: number | null, order: "asc" | "desc"): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return (left - right) * (order === "asc" ? 1 : -1);
}

export function queryEtfs(items: EtfSnapshot[], query: EtfQuery): EtfPage {
  const needle = query.query.trim().toLocaleLowerCase("zh-CN");
  const filtered = items.filter((item) => {
    const categoryMatch = query.category === "全部" || item.category === query.category;
    const searchText = `${item.name}${item.symbol}${item.category}${item.tags.join("")}`.toLocaleLowerCase("zh-CN");
    return categoryMatch && (!needle || searchText.includes(needle));
  });
  const sorted = filtered.toSorted((left, right) => {
    const compared = compareNullable(left[query.sort], right[query.sort], query.order);
    return compared === 0 ? left.symbol.localeCompare(right.symbol) : compared;
  });
  const itemsPage = sorted.slice(query.cursor, query.cursor + query.limit);
  const next = query.cursor + itemsPage.length;
  return { items: itemsPage, nextCursor: next < sorted.length ? next : null, total: sorted.length };
}
