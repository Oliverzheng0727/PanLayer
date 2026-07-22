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
- 隔夜新闻与结构化早参：OpenAI Responses API Web Search。
- 首版不使用 Tushare。

东方财富和腾讯属于无需付费的公开接口，不承诺正式行情授权或 SLA。当前项目只适合个人内部复盘；公开运营或商业化前必须更换为有授权的数据源。

## 免费额度控制

- Twelve Data：主批次固定最多 8 个标的，每日早参运行一次。
- Alpha Vantage：只复核标普 500 与半导体两个核心标的，远低于每日 25 次免费请求上限。
- FRED/EIA：每日各请求一次并缓存。
- OpenAI API 单独计费；同一日期早参完成后自动跳过，只有管理接口显式传入 `?force=true` 才重新生成。

## 服务端 Secrets

复制 `.env.example` 的变量名到本机 `.dev.vars`，或在 OpenAI Sites 项目中配置对应 Runtime Secrets：

```text
ALLOWED_USER_EMAIL
OPENAI_API_KEY
TWELVE_DATA_API_KEY
ALPHA_VANTAGE_API_KEY
FRED_API_KEY
EIA_API_KEY
```

不得把实际密钥写入 `.env.example`、`.openai/hosting.json`、客户端组件、日志或 Git。没有配置某个免费数据源时，网站会显示“未配置/部分”，不会用旧值冒充最新值。

## 验证命令

```bash
npm test
npm run lint
npm run test:render
npm run build
```

## OpenAI Sites

`.openai/hosting.json` 只保存 Sites 项目标识和 D1/R2 绑定，不保存密钥。用户身份由 OpenAI 托管环境注入，页面和 API 仍会在服务端校验 `ALLOWED_USER_EMAIL`。
