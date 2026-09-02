# PanLayer 开源整理设计

## 目标

将 `lihaozheng567-dot/PanLayer` 从私有仓库整理为可安全公开、易于理解和便于贡献的开源项目，同时保留现有线上服务、数据管线和部署方式。

## 范围

本次整理覆盖：

- 公开前的完整 Git 历史密钥扫描和依赖许可证检查；
- 修复生产依赖审计发现的高危漏洞；
- MIT 开源许可与项目元数据；
- README、贡献指南、安全策略、行为准则及 Issue/PR 模板；
- 面向提交与拉取请求的持续集成；
- 本地审查产物、截图、缓存及无关目录的忽略规则；
- 将最新代码收敛至 `main`，设置默认分支并删除已合并的远端旧分支；
- 创建首个开源版本 `v0.1.0`；
- 最后将 GitHub 仓库可见性改为 Public。

本次不重写 Git 历史。只有密钥扫描确认存在真实秘密、个人数据或不可公开材料时，才暂停公开并另行设计历史清理与密钥轮换方案。

## 公开安全门槛

公开前必须同时满足：

1. 完整 Git 历史的密钥扫描无未处理发现；
2. 当前跟踪文件不包含 `.env`、私钥、访问令牌或生产数据；
3. 运行时秘密继续仅存于 GitHub Secrets 和 Sites 环境变量；
4. 生产依赖许可证与 MIT 项目分发方式兼容；
5. `npm audit --omit=dev --audit-level=high` 无高危生产依赖漏洞；
6. 测试、Lint、服务端渲染检查和生产构建全部通过；
7. 所有旧远端分支均为最新 `main` 的祖先，删除不会丢失提交。

任何门槛失败时停止公开。代码和文档修复可以继续，但仓库可见性保持 Private，直到问题解决并重新验证。

## 仓库内容设计

### 项目入口

README 将以中文为主并补充简短英文简介，说明产品定位、功能、技术栈、快速开始、环境变量、数据源限制、部署方式和投资风险免责声明。文档不承诺公开行情接口的授权、稳定性或商业使用权。

`package.json` 使用 `panlayer` 作为包名，补充描述、仓库、主页和 MIT 许可证字段，并保留 `private: true`，避免误发布到 npm；该字段不影响 GitHub 开源。Next.js 从存在已知高危漏洞的 `16.2.6` 升级到修复版本 `16.3.4`，锁文件同步选择已修复的传递依赖。

完整历史和当前目录扫描确认两类 Gitleaks 命中均为源码标识符或文档测试夹具，而非真实秘密。仓库使用 `.gitleaksignore` 按历史与当前目录的精确 fingerprint 忽略这些命中，不添加宽泛规则，也不降低其他秘密检测覆盖率。

### 开源治理

新增：

- `LICENSE`：MIT，版权人为 `lihaozheng567-dot`；
- `CONTRIBUTING.md`：开发环境、分支、测试和提交要求；
- `SECURITY.md`：私下报告漏洞的方式，禁止在公开 Issue 中披露秘密；
- `CODE_OF_CONDUCT.md`：Contributor Covenant；
- Issue 模板：缺陷与功能建议；
- Pull Request 模板：变更、验证和风险检查清单。

GitHub 仓库描述指向 PanLayer 的核心用途，主页设为 `https://panlayer.online`，Topics 覆盖 A 股、市场复盘、Next.js、TypeScript 和 Cloudflare Workers。

### 自动化

保留现有后台任务工作流及其 GitHub Secret。新增独立 CI 工作流，在对 `main` 的推送和拉取请求上执行安装、测试、Lint 和构建。CI 不访问生产秘密，也不触发生产任务。

### 本地文件边界

`.gitignore` 将明确排除 TypeScript 构建缓存、审查输出、设计截图和本地 `Vibe-Research` 目录。这些未跟踪内容不删除，也不纳入开源仓库。

## 分支与发布

当前最新分支为 `codex/tonghua`。`main`、`codex/panlayer` 和 `codex/full-morning-brief` 的远端提交均已包含在最新分支历史中。

整理顺序为：

1. 在最新代码上完成开源文件并验证；
2. 提交并将 `main` 快进到该提交；
3. 将 GitHub 默认分支改为 `main`；
4. 删除远端 `codex/panlayer`、`codex/tonghua` 和 `codex/full-morning-brief`；
5. 创建带说明的 `v0.1.0` GitHub Release；
6. 再次验证秘密、分支、CI 和仓库元数据；
7. 将仓库可见性改为 Public；
8. 从未认证视角确认仓库、README 和 Release 可访问。

## 验证

本地验证命令包括：

```bash
npm test
npm run lint
npm run test:render
npm run build
```

此外执行完整历史密钥扫描、生产依赖许可证清单检查、Git 分支祖先关系检查，以及 GitHub API 对可见性、默认分支、Topics、Release 和社区健康文件的复核。

## 回滚与失败处理

- 在公开前失败：保持 Private，不改变默认分支或删除远端分支；
- 分支整理失败：旧分支在确认 `main` 可用前不删除；
- Release 创建失败：仓库保持 Private，修复后重试；
- 公开后发现非秘密问题：通过正常提交修复；
- 公开后发现真实秘密：立即轮换秘密、暂时改回 Private，并执行经过审查的历史清理。
