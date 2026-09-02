# PanLayer 盘层

[![CI](https://github.com/lihaozheng567-dot/PanLayer/actions/workflows/ci.yml/badge.svg)](https://github.com/lihaozheng567-dot/PanLayer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg)](LICENSE)
[![Live Site](https://img.shields.io/badge/Live-panlayer.online-e8702a)](https://panlayer.online)

PanLayer is an open-source A-share market review workspace for market breadth, limit-up structure, new highs, themes, ETF charts, historical comparison, and sourced morning briefs.

PanLayer（盘层）是一套面向个人研究与每日复盘的 A 股市场工作台。它把盘中广度、涨跌停结构、新高股票、热点板块、ETF 行情、历史对比和带来源的隔夜早参放在同一套可追溯界面中。

> 在线体验：[panlayer.online](https://panlayer.online)

![PanLayer 市场复盘界面](public/hero-market-reveal.png)

## 主要功能

- 市场温度：涨跌家数、涨跌停、炸板率与盘中广度快照。
- 连板与新高：客观展示连板梯队、新高股票及历史证据。
- 热点板块：基于可验证榜单整理市场主题，不生成主观荐股结论。
- ETF 工作台：分类目录、自选、K 线和历史指标。
- 历史复盘：按交易日查询并横向比较市场结构。
- 隔夜早参：结合结构化行情、官方宏观数据与带来源资讯生成分模块摘要。
- 数据健康：显示后台任务进度、数据新鲜度和部分失败状态。

## 技术栈

- Next.js / Vinext、React 19、TypeScript
- Vite、Vitest、ESLint、Tailwind CSS
- Cloudflare Workers、D1、Drizzle ORM
- Lightweight Charts、Recharts
- OpenAI Sites 托管

## 快速开始

要求 Node.js `>=22.13.0`。

```bash
git clone https://github.com/lihaozheng567-dot/PanLayer.git
cd PanLayer
npm install
cp .env.example .dev.vars
npm run dev
```

本机未配置外部服务时会展示演示数据。访问 `http://localhost:3000/dashboard` 打开工作台。

## 环境变量

仅在服务端配置实际值。不要把密钥提交到 Git、Issue、日志或客户端代码。

| 变量 | 用途 |
| --- | --- |
| `FUYAO_API_KEY` | 扶摇结构化 A 股与 ETF 数据 |
| `FUYAO_MCP_BASE_URL` | 扶摇 MCP 服务地址 |
| `TWELVE_DATA_API_KEY` | 海外市场行情主数据 |
| `ALPHA_VANTAGE_API_KEY` | 海外行情抽样复核 |
| `FRED_API_KEY` | FRED 官方宏观数据 |
| `EIA_API_KEY` | EIA 官方能源数据 |
| `DASHSCOPE_API_KEY` | 阿里云百炼 Qwen 早参生成 |
| `OPENAI_API_KEY` | 可选的早参生成降级服务 |
| `FIRECRAWL_API_KEY` | 一级资讯覆盖不足时的定向补充 |
| `FIRECRAWL_API_URL` | 可选的 Firecrawl API 地址 |
| `ALLOWED_USER_EMAIL` | 兼容旧配置的受保护用户邮箱 |
| `ADMIN_USER_EMAIL` | 管理任务授权邮箱 |

本地变量放在 `.dev.vars`；线上变量通过 Sites Runtime Secrets 管理。`.openai/hosting.json` 只保存项目标识和逻辑资源绑定。

## 数据来源与边界

- A 股和 ETF 结构化数据优先使用扶摇数据接口。
- 东方财富与腾讯公开行情接口用于部分行情补充、交叉校验或降级。
- 海外行情使用 Twelve Data，并以 Alpha Vantage 抽样复核。
- 宏观数据来自 FRED 与 EIA。
- 资讯来自白名单 RSS/Atom 源；覆盖不足时才使用 Firecrawl 定向搜索。
- 早参优先由阿里云百炼 Qwen 基于已验证资料包生成，OpenAI 仅作可选降级。

第三方接口、数据和内容分别受其服务条款、许可证和额度约束。东方财富、腾讯等公开接口不提供正式行情授权或 SLA；公开运营或商业化前必须更换或补充具备相应授权的数据源。

## 验证

```bash
npm test
npm run lint
npm run test:render
npm run build
```

日常任务的验收时间和补跑边界见 [`docs/operations/daily-data-runbook.md`](docs/operations/daily-data-runbook.md)。

## 部署

项目使用 OpenAI Sites 和 Cloudflare Workers 兼容构建输出。公开仓库不包含生产密钥、D1 实例数据或部署凭证。

## 参与贡献

提交 Issue 或 Pull Request 前请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md) 和 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。安全问题请按照 [`SECURITY.md`](SECURITY.md) 私下报告。

## 风险声明

本软件仅用于研究和市场复盘，不构成投资建议、交易信号或收益承诺。任何公开或商业运营都必须使用具备适当许可的市场数据，并自行满足所在地区的监管、数据和内容合规要求。

## License

PanLayer is released under the [MIT License](LICENSE).
