# Contributing to PanLayer

感谢你愿意改进 PanLayer。请先通过 Issue 说明较大的功能或数据口径变化；小型修复可以直接提交 Pull Request。

## 开发环境

- Node.js `>=22.13.0`
- npm（使用仓库内的 `package-lock.json`）

```bash
git clone https://github.com/lihaozheng567-dot/PanLayer.git
cd PanLayer
npm install
cp .env.example .dev.vars
npm run dev
```

不要提交真实密钥、生产数据、个人信息、`.dev.vars` 或运行日志。测试夹具必须使用明显的虚构值。

## 工作流程

1. Fork 仓库并从最新 `main` 创建聚焦的功能分支。
2. 保持变更范围清晰，避免在同一 Pull Request 中混入无关重构。
3. 为行为变更补充或更新测试，并确保数据口径有可追溯依据。
4. 使用简洁、可读的提交信息。
5. 提交 Pull Request，说明目的、验证方式、数据源影响和潜在风险。

## 必须通过的检查

```bash
npm test
npm run lint
npm run test:render
npm run build
```

如果变更涉及生产依赖，还需运行：

```bash
npm audit --omit=dev --audit-level=high
```

## 数据与内容规则

- 市场数字必须来自结构化数据源，不能由模型或搜索摘要猜测。
- 新闻、解读和早参必须保留来源，不能把观点包装成客观行情数据。
- 新增第三方数据源前，请确认其许可、调用额度和公开运营限制。
- 本项目不接受荐股、收益承诺或规避数据授权要求的实现。

提交贡献即表示你同意按仓库的 [MIT License](LICENSE) 授权你的贡献，并遵守 [Code of Conduct](CODE_OF_CONDUCT.md)。
