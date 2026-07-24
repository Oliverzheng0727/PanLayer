# PanLayer 盘层

个人私密使用的 A 股复盘网站，记录涨跌家数、涨跌停、连板梯队、新高股票、热点板块、ETF K 线和带来源的隔夜早参。

## 本机运行

要求 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

本机默认展示演示数据。访问 `http://localhost:3000/dashboard` 查看工作台。

## 数据源

- A 股盘中主源：东方财富公开行情接口。
- A 股交叉校验与降级：腾讯行情公开接口，每批最多 60 只、并发最多 4 批。
- 海外收盘行情：Twelve Data 免费档主源，Alpha Vantage 免费档抽样复核。
- 官方宏观：FRED 与 EIA。
- 一级隔夜资讯：12 个行业、108 个白名单 RSS/Atom 源，北京时间 06:50 预采集。
- 二级资讯补充：北京时间 06:55 检查一级覆盖缺口，使用 Firecrawl 定向搜索；非官方事实必须双来源交叉验证。
- 结构化早参：北京时间 07:15 由阿里云百炼 Qwen 汇总当日已验证资料包；OpenAI 仅作可选降级。
- 首版不使用 Tushare。

东方财富和腾讯属于无需付费的公开接口，不承诺正式行情授权或 SLA。当前项目只适合个人内部复盘；公开运营或商业化前必须更换为有授权的数据源。

## 免费额度控制

- Twelve Data：主批次固定最多 8 个标的，每日早参运行一次。
- Alpha Vantage：只复核标普 500 与半导体两个核心标的，远低于每日 25 次免费请求上限。
- FRED/EIA：每日各请求一次并缓存。
- Firecrawl 只搜索一级资讯未覆盖的模块，不做全网无差别抓取。
- 百炼 API 按量计费；同一日期早参完成后自动跳过，只有管理接口显式传入 `?force=true` 才重新生成。

## 服务端 Secrets

复制 `.env.example` 的变量名到本机 `.dev.vars`，或在 OpenAI Sites 项目中配置对应 Runtime Secrets：

```text
ALLOWED_USER_EMAIL
ADMIN_USER_EMAIL
DASHSCOPE_API_KEY
OPENAI_API_KEY
FIRECRAWL_API_KEY
FIRECRAWL_API_URL
TWELVE_DATA_API_KEY
ALPHA_VANTAGE_API_KEY
FRED_API_KEY
EIA_API_KEY
```

早参优先使用 `DASHSCOPE_API_KEY` 调用北京地域的 `qwen-plus`。当日分级资料包可用时关闭 Qwen 自主搜索，只允许引用服务端提供的来源 ID；资料包不可用时才保留现有联网路径。未配置百炼但配置了 `OPENAI_API_KEY` 时，才使用 OpenAI 回退。

受保护的手动任务：

```text
POST /api/v1/admin/jobs/tier1-rss-prefetch/run
POST /api/v1/admin/jobs/tier2-news-prefetch/run
POST /api/v1/admin/jobs/morning-brief/run?force=true
```

RSS、Firecrawl 和 Qwen 只提供新闻事实与解读，不能生成、覆盖或修补指数、汇率、利率、商品和 A 股统计数字。结构化行情缺失时页面必须显示“暂缺/部分”。

不得把实际密钥写入 `.env.example`、`.openai/hosting.json`、客户端组件、日志或 Git。没有配置某个免费数据源时，网站会显示“未配置/部分”，不会用旧值冒充最新值。

## 验证命令

```bash
npm test
npm run lint
npm run test:render
npm run build
```

## OpenAI Sites

`.openai/hosting.json` 只保存 Sites 项目标识和 D1/R2 绑定，不保存密钥。用户身份由 OpenAI 托管环境注入；任何已登录 ChatGPT 账号都能查看工作台，管理任务仅允许 `ADMIN_USER_EMAIL`（兼容旧配置 `ALLOWED_USER_EMAIL`）执行。
