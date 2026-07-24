# PanLayer 分级资讯预采集与早参生成设计

## 1. 目标

在不改变 PanLayer 现有页面框架、五模块早参结构和市场数据口径的前提下，增加独立的分级资讯预采集层：

- 北京时间 06:50 从固定白名单 RSS/Atom 源预采集资讯，清洗后写入 D1。
- 北京时间 06:55 检查一级资讯的行业和必查主题缺口，通过 Firecrawl 定向搜索形成二级补充资讯。
- 北京时间 07:15 由 Qwen 读取当日资讯包，生成固定五模块盘前早参。
- 一级资讯始终优先；二级资讯只有经过来源校验或交叉验证后才能进入 Qwen 输入，不能覆盖一级来源事实。
- 行情数字继续只来自结构化行情适配器；RSS、Firecrawl 和 Qwen 均不得生成或修补市场数字。
- 任一 RSS 源、Qwen 模块或 Firecrawl 调用失败时，其他模块仍可正常展示，并明确标记“部分”或“失败”。

本设计使用用户提供的 12 个行业、108 个 RSS 源、26 个红线关键词配置。首版不增加荐股、买卖点、仓位建议，也不改变历史复盘指标定义。

## 2. 总体架构

```text
一级：固定 RSS 白名单
      │
      ▼
06:50 采集器 ── 超时/重试/安全校验
      │
      ▼
解析与清洗 ── URL 去重/标题去重/红线过滤/行业映射
      │
      ▼
D1 一级资讯包 + 采集健康状态
      │
      ▼
06:55 缺口扫描 ── 二级 Firecrawl 定向搜索/交叉验证
      │
      ▼
07:15 模块选择器 ── 结构化行情快照
      │
      ▼
Qwen 五模块生成 ── 模块校验与定向重试
      │                    │
      │                    └─ 资讯不足时 Firecrawl 补充
      ▼
早参持久化 ── 完整/部分/失败 + 来源引用 + 生成时间
```

06:50、06:55 与 07:15 是三个独立、可幂等重跑的任务。07:15 不等待实时抓取全部 RSS 或搜索，而是优先读取已经落库的当日分级资讯包，从而降低网络波动造成整份早参缺失的概率。

## 3. 配置与来源管理

### 3.1 配置文件

实施时把用户提供的 JSON 转为仓库内受版本控制的配置，例如：

```text
config/tier1-rss-sources.json
```

配置保留：

- `fetch.per_source = 6`
- `fetch.timeout = 15`
- `fetch.recent_days = 7`
- 12 个行业及其来源
- 26 个红线关键词

同一 URL 出现在多个行业时，只创建一个来源记录，但保留全部行业标签。Engadget、少数派等重复源不会重复请求。

### 3.2 来源安全

- 仅请求配置中的静态白名单地址，不接受用户提交的任意 URL。
- HTTPS 源直接启用；HTTP 源只有在重定向最终落到 HTTPS 时才启用，否则记录为不可用。
- 最多跟随 3 次重定向，拒绝本机、内网、链路本地和保留地址。
- 单源响应上限 2 MB。
- RSS/XML 解析禁用 DTD 与外部实体，避免 XXE。
- 来源失败不会阻塞其他来源。

### 3.3 来源健康

每个来源保存：

- 最近请求状态
- 最近成功时间
- 请求耗时
- 最近错误原因
- 连续失败次数
- 当日原始条目数与保留条目数

健康信息扩展到现有 `/api/v1/data-health`，无需新增公开页面入口。页面继续使用现有视觉语言展示采集时间、成功率和完整状态。

### 3.4 二级资讯层

二级资讯不是未经筛选的小媒体集合，也不是让 Qwen 自由联网。它是对一级资讯缺口的受控搜索层：

- 06:55 读取当日一级资讯包，逐模块检查行业覆盖、必查主题和来源多样性。
- 只对缺失项生成固定查询，例如“美债 10 年期收益率”“存储芯片 涨价 减产”“人形机器人 产业公告”。
- 使用 Firecrawl Search 获取候选结果；Qwen 只负责最终摘要，不负责发现来源。
- 候选结果优先接受政府、交易所、央行、上市公司官网、研究机构和一级媒体原文。
- 非官方二级媒体事实必须获得至少 2 个相互独立来源的交叉印证，才能标记为 `verified` 并进入 Qwen 输入。
- 只有一个二级来源、时间不明、标题与正文不一致或无法读取原文时，保存为 `unverified`，仅用于健康诊断，不进入早参。
- 二级资讯不能推翻一级资讯；若两级来源冲突，模块显示“来源存在差异”，并同时保留证据。
- 每个模块最多补充 6 条二级资讯，同一事件最多保留 2 个来源，控制成本和噪声。

二级搜索失败不会阻塞 07:15 生成。一级资讯已经满足要求时，06:55 不调用 Firecrawl。

## 4. 采集、解析与清洗

### 4.1 调度与并发

- Cloudflare UTC Cron：`50 22 * * 0-4`，对应北京时间周一至周五 06:50。
- Cloudflare UTC Cron：`55 22 * * 0-4`，对应北京时间周一至周五 06:55。
- 任务入口再次检查中国交易日；休市日跳过正式生成并记录原因。
- 最大并发 8 个来源。
- 每个来源 15 秒超时。
- 仅对网络错误、超时和 5xx 重试 1 次；4xx、解析失败不盲目重试。
- 整批采集最长 180 秒，超时后保留已成功结果。

### 4.2 RSS/Atom 标准化

解析 RSS 2.0、RSS 1.0/RDF 与 Atom，统一输出：

```ts
interface NormalizedRssItem {
  canonicalUrl: string
  title: string
  excerpt: string | null
  publishedAt: string | null
  receivedAt: string
  sourceIds: string[]
  sourceNames: string[]
  industries: string[]
}
```

发布时间无法可靠解析时保留 `null`，不得使用接收时间伪装发布时间。只选择发布时间在最近 7 天内的条目；无发布时间条目可以入库，但只能作为低优先级候选并显示接收时间。

### 4.3 去重

依次执行：

1. 规范 URL：去除常见跟踪参数、片段、默认端口和多余尾斜杠。
2. 完全相同规范 URL 只保存一条，合并来源和行业标签。
3. 标题转小写、去标点与空白后，用字符 n-gram 相似度去除近似重复，阈值默认 `0.86`。
4. 同一事件最多向一个模块提供 2 个不同来源，避免单一事件淹没早参。

### 4.4 红线过滤

对规范化后的标题与摘要执行不区分大小写的关键词匹配。命中任一红线关键词时：

- 不进入 Qwen 资讯包。
- 记录过滤原因与命中词，便于审计。
- 页面不展示被过滤正文。

红线过滤仅作为内容安全层，不替代来源可靠性判断。

### 4.5 当日新鲜度

“最近 7 天”是文章发布时间窗口；“当日资讯包”是采集批次窗口。07:15 只读取北京日期与当前交易日一致、且来自当日成功运行的条目，不把昨天的采集结果冒充今天的新资讯。

若 06:50 任务完全失败，06:55 仍可生成经过验证的二级资讯包；07:15 还会触发一次轻量重采集。一级和二级均失败时，早参进入“部分”状态。

## 5. D1 数据模型

为同时容纳 RSS 和 Firecrawl 结果，新增三张通用幂等表：

### 5.1 `brief_sources`

```text
source_id TEXT PRIMARY KEY
name TEXT NOT NULL
url TEXT NOT NULL UNIQUE
industry_keys_json TEXT NOT NULL
source_tier INTEGER NOT NULL
transport TEXT NOT NULL
enabled INTEGER NOT NULL
last_status TEXT
last_success_at TEXT
last_error TEXT
latency_ms INTEGER
consecutive_failures INTEGER NOT NULL DEFAULT 0
updated_at TEXT NOT NULL
```

### 5.2 `brief_items`

```text
item_id TEXT PRIMARY KEY
canonical_url TEXT NOT NULL
title TEXT NOT NULL
excerpt TEXT
published_at TEXT
received_at TEXT NOT NULL
fetch_date TEXT NOT NULL
run_id TEXT NOT NULL
source_ids_json TEXT NOT NULL
source_names_json TEXT NOT NULL
industry_keys_json TEXT NOT NULL
source_tier INTEGER NOT NULL
verification_status TEXT NOT NULL
corroborating_urls_json TEXT NOT NULL
content_hash TEXT NOT NULL
filter_status TEXT NOT NULL
filter_reason TEXT
UNIQUE(fetch_date, canonical_url)
```

`item_id` 使用确定性哈希生成。任务重跑时更新同一日期的记录，不产生重复条目。

### 5.3 `brief_fetch_runs`

```text
run_id TEXT PRIMARY KEY
fetch_date TEXT NOT NULL
source_tier INTEGER NOT NULL
transport TEXT NOT NULL
started_at TEXT NOT NULL
finished_at TEXT
status TEXT NOT NULL
source_total INTEGER NOT NULL
source_success INTEGER NOT NULL
raw_item_count INTEGER NOT NULL
kept_item_count INTEGER NOT NULL
filtered_item_count INTEGER NOT NULL
error_summary_json TEXT
UNIQUE(fetch_date, run_id)
```

正式任务按日期和资讯级别获取租约；同一级别、同一日期并发运行时只允许一个写入者。手动重跑创建新 `run_id`，模块选择器读取当日最新的成功或部分成功批次。

## 6. 五模块资讯选择

模块选择器只把与模块相关、未被过滤且已验证的条目交给 Qwen。默认每模块最多 12 条一级资讯，并在存在覆盖缺口时补充最多 6 条二级资讯；每条摘要最多 900 字符，总输入按现有模型上下文预算截断。候选按以下顺序排序：

1. 资讯级别，一级优先于二级
2. 验证状态
3. 发布时间新鲜度
4. 标题和摘要与固定主题的相关度
5. 不同来源覆盖度
6. 同事件去重后的补充价值

各模块来源范围：

1. **全球外围市场全景**：宏观、海外主要财经媒体和结构化外围市场快照。
2. **全球产业重大催化**：AI、半导体、机器人、汽车、能源、生物医药、航天、科学；强制检查 Kimi、DeepSeek、GPT、存储、人形机器人、算力/光模块、钠离子电池。
3. **国内隔夜重磅信息**：中文财经、科技、产业来源，以及现有国内公告和政策数据。
4. **板块利好、利空与内需映射**：已验证的前一交易日复盘、ETF 分类映射和 RSS 产业催化；Qwen 不得生成股票或板块排名。
5. **盘前情绪、观察方向与风险**：只基于已验证行情和有引用的事实，禁止买卖、仓位和收益承诺。

正常情况下，一个模块至少需要 4 条有效资讯、覆盖至少 3 个不同来源；全球外围市场模块因同时包含结构化行情，资讯最低可为 3 条。未达到阈值时标记为“资讯不足”，进入定向补充流程。

## 7. Qwen 生成与引用约束

### 7.1 输入

Qwen 每个模块只接收：

- 结构化行情快照
- 经过清洗的 RSS 条目
- 条目内部来源 ID、标题、URL、发布时间与摘要
- 固定的模块结构、重点赛道和合规约束

默认生成阶段不再调用实时全网搜索。

### 7.2 输出

每条重要事实必须引用输入中存在的来源 ID。服务端在保存前校验：

- 五个固定模块是否存在
- 来源 ID 是否属于本次输入
- 重要事实是否带引用
- 重点赛道是否逐项检查
- 是否出现荐股、仓位、收益承诺或未经输入支持的市场数字

“未查到可靠更新”是合法结果，不能用推测补齐。

### 7.3 模块级恢复

当校验发现缺少必要主题，例如全球外围模块缺少“美债”：

1. 只重试失败模块，传入缺失项诊断和相同 RSS 资讯包。
2. 第二次仍失败时，检查 06:55 二级资讯包是否已经包含该主题；若缺失，Firecrawl 只搜索该模块缺失主题。
3. 将 Firecrawl 返回的标题、URL、发布时间和摘要通过二级来源验证后加入资讯包，再进行最后一次 Qwen 模块生成。
4. 仍失败则保存该模块失败原因，其他成功模块照常发布，整份早参状态为“部分”。

Firecrawl 不是市场数字来源，不能替换行情 API。

## 8. 状态、日志与页面行为

两个任务都写任务日志：

- 开始时间、结束时间、耗时
- 成功/部分/失败
- 来源总数、成功数、失败数
- 原始、保留、过滤条目数
- Qwen 各模块尝试次数
- Firecrawl 是否触发及原因

页面继续显示：

- 早参生成时间
- 资讯采集时间
- 数据来源
- 完整/部分/失败状态

某一模块失败时显示该模块的明确提示，不隐藏其他模块，不回退到旧早参冒充今日结果。已成功模块在重试时不重新生成，以降低成本并避免内容漂移。

## 9. 接口与代码边界

实现建议拆分为：

```text
lib/ai/rss/config.ts
lib/ai/rss/types.ts
lib/ai/rss/parser.ts
lib/ai/rss/normalizer.ts
lib/ai/rss/collector.ts
lib/ai/rss/repository.ts
lib/ai/rss/bundle-selector.ts
lib/jobs/rss-prefetch.ts
lib/ai/news-tier2/gap-detector.ts
lib/ai/news-tier2/firecrawl-collector.ts
lib/ai/news-tier2/verifier.ts
lib/jobs/tier2-news-prefetch.ts
```

现有 `lib/jobs/runner.ts` 负责：

- 注册 `tier1-rss-prefetch`
- 注册 `tier2-news-prefetch`
- 07:15 读取资讯包
- 调用 Qwen 模块生成器
- 按需调用现有 Firecrawl fallback
- 保存模块级状态

对外早参接口结构保持兼容，只增加可选的 `collectionStatus`、`collectionTime` 和模块级来源健康字段。现有页面无需重构。

## 10. 测试

### 10.1 单元测试

- RSS 2.0、RDF、Atom 解析
- RFC 822、ISO 8601 与缺失发布时间
- URL 规范化和跟踪参数去除
- 相同 URL、相似标题、跨行业重复源合并
- 中英文红线关键词过滤
- 超时、5xx 重试、4xx 不重试
- 非 HTTPS 最终地址、私网地址、大响应和 XML 实体拒绝
- D1 同日重跑幂等
- 模块选择的行业范围、来源数量与输入长度上限
- 二级缺口检测、固定查询生成和单模块数量上限
- 二级官方来源直接验证、非官方来源双源交叉验证
- 未验证二级资讯不得进入 Qwen 输入

### 10.2 集成测试

- 06:50 部分来源失败仍生成当日资讯包
- 06:55 只搜索一级资讯未覆盖的主题
- 一级资讯充分时不产生 Firecrawl 调用
- 07:15 仅读取当日运行，不使用旧批次冒充
- Qwen 只能引用已提供的来源 ID
- 缺少“美债”等必要项时只重试失败模块
- RSS 不足时触发 Firecrawl，Firecrawl 失败时仍发布其他模块
- 结构化市场数字不会被 RSS、Firecrawl 或 Qwen 覆盖
- 手动重跑不会重复写入或覆盖更完整的成功结果

### 10.3 调度测试

- UTC Cron 正确对应北京时间 06:50
- UTC Cron 正确对应北京时间 06:55
- 周末和休市日跳过
- 任务租约阻止同一日期并发写入
- 单一 RSS、Qwen 或 Firecrawl 故障不会导致整份早参不可见

## 11. 验收标准

- 交易日 06:50 后 D1 存在当日资讯包和来源健康记录。
- 交易日 06:55 后，一级资讯缺口已有经过验证的二级补充，或记录明确的补充失败原因。
- 交易日 07:15 后页面存在固定五模块早参，或明确显示具体失败模块。
- 早参重要事实均能追溯到标题、URL、发布时间和引用位置。
- 单源失败不影响其他源；单模块失败不影响其他模块。
- 旧资讯不会被标记为今日采集结果。
- 市场数字只来自结构化行情适配器，无法验证时显示“暂缺”。
- 页面保持现有 PanLayer 暗色视觉和信息架构。

## 12. 非目标

- 不建设公开 RSS 管理后台。
- 不允许用户添加任意抓取网址。
- 不把未经交叉验证的二级搜索结果直接交给 Qwen。
- 不用 AI 生成市场统计数据、板块排名或个股排名。
- 不承诺免费公开源达到专业行情 SLA。
- 不改变历史复盘表、ETF 工作台、登录和账号体系。
