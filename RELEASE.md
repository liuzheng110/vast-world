# VastWorld CI、自动 PR 与发布方案

状态：M0 实施契约。工作流文件尚未创建前，本文件描述目标，不代表自动化已经运行。

## 1. 原则

- `main` 永远应可部署，但合并 `main` 不等于立即发布生产。
- 同一 commit 只构建一次；测试通过的不可变制品在环境之间晋级。
- 自动化可以提出 PR 和生成制品，不能替代玩法、权限、迁移和生产发布审批。
- staging 自动，production 受 GitHub Environment 审批保护。
- 每次生产发布可定位到 Git SHA、协议版本、数据库迁移版本和制品 digest。

## 2. GitHub 基础设置

仓库建立后配置：

- 默认分支：`main`。
- 禁止 force push 和删除 `main`。
- 要求 Pull Request、至少 1 名批准、解决全部会话。
- 要求分支与 `main` 最新，启用 merge queue（仓库计划支持时）。
- 必需检查：`lint`、`typecheck`、`unit`、`build`、`integration`、`e2e-smoke`、`migration-check`（按路径触发，但聚合检查名稳定）。
- `staging` 和 `production` 使用 GitHub Environments；production 要人工批准。
- Actions 默认 `contents: read`，每个 job 仅增加所需权限；第三方 Action 固定到 commit SHA。

## 3. 自动 PR

### 3.1 依赖更新

使用 Dependabot：

- npm/pnpm 依赖每周分组创建 PR。
- GitHub Actions 依赖每月创建 PR。
- patch/minor 可在 CI 与人工抽查后合并；major 不自动合并。
- Phaser、Colyseus、Supabase、数据库驱动和构建工具的升级始终需要运行对应集成/E2E。

### 3.2 版本 PR

采用 release-please（M0 实现时固定版本）：

1. 功能 PR 使用 Conventional Commits。
2. 合并到 `main` 后，机器人维护一个版本 PR，更新 changelog 和版本。
3. 维护者选择发布窗口并合并版本 PR。
4. 机器人创建 SemVer tag 和 GitHub Release。
5. tag 触发制品构建/签名/发布工作流。

游戏应用先使用一个统一版本号，避免早期分别版本化 web/server/protocol。`protocolVersion` 独立存在，用于运行时兼容，不等同产品 SemVer。

### 3.3 自动修复边界

格式化、生成文件或机器人修复只能提交到机器人自己的 PR。自动化不得把代码直接写入贡献者分支或 `main`，不得自动修改迁移、权限策略、奖励数值与玩法规则。

## 4. 工作流设计

### `ci.yml` — 每个 PR

```text
checkout
→ setup Node/corepack
→ pnpm install --frozen-lockfile
→ lint + typecheck
→ unit tests
→ build web + server
→ protocol/content schema checks
→ migration/RLS checks（相关路径）
→ server integration
→ two-browser e2e smoke
```

要求：

- 使用 concurrency 取消同分支过期运行。
- 缓存 pnpm store，不缓存未验证的构建产物。
- 测试日志不得打印 token、连接字符串或用户数据。
- fork PR 不获得仓库 secret；需要 secret 的 preview 由维护者批准后运行。

### `preview.yml` — PR 预览

- Web 由 Cloudflare Pages 创建静态 preview。
- 默认连接共享的无生产数据测试服务，或仅运行本地模拟。
- 涉及服务端/迁移的短生命周期环境在 M2 后评估；M0 不承诺每 PR 一套完整后端。
- 预览页面显示 PR 编号、commit SHA、API 目标与“非生产”标识。

### `deploy-staging.yml` — 合并 main

- 复用 CI 结论，构建 Web bundle 和 game-server Docker image。
- 镜像推送到 GHCR，tag 至少包含完整 commit SHA；记录 digest。
- 先执行向前兼容迁移，再部署服务端，再部署 Web。
- 运行健康检查、协议握手、登录测试账号、加入房间和双客户端冒烟。
- 冒烟失败停止流水线并告警，不晋级生产。

### `release.yml` — 版本 tag

- 校验 tag 指向已在 staging 通过的 commit/digest。
- 生成 GitHub Release 附件：Web bundle、server 镜像引用、SBOM、checksums 和变更说明。
- 生产部署 job 进入受保护 environment，等待维护者批准。
- 批准后按数据库 → 服务端 → Web 顺序晋级同一制品，完成后运行生产只读冒烟。

## 5. 环境与密钥

| 环境 | 数据 | 部署 | 目的 |
| --- | --- | --- | --- |
| local | 本地 Supabase seed | 开发机 | 开发与单测 |
| preview | 合成数据 | Cloudflare preview | PR UI 验收 |
| staging | 独立测试项目 | 自动 | 完整集成、压测、发布候选 |
| production | 真实数据 | 受审批 | 玩家服务 |

- 环境之间不共享 Supabase 项目、数据库密码或 service role key。
- 浏览器只接收允许公开的配置；密钥只保存在平台 secret store/GitHub Environment。
- 测试账号由 staging 专用种子或受控任务创建，不复制生产账号。
- 数据库迁移账号和运行时账号分离，运行时账号无 DDL 权限。

## 6. 数据库发布

采用 expand/contract：

1. Expand：新增可空列/新表/新索引，旧服务仍能运行。
2. Deploy server：同时理解旧/新数据。
3. Deploy web：开始使用新协议。
4. Observe：至少经历约定观察窗口。
5. Contract：在后续版本删除旧列或旧路径。

禁止在同一发布中先删除旧结构再部署新代码。生产迁移必须记录预计耗时、锁风险、备份点和前向修复方案；回滚应用不能假设数据库也能安全向下迁移。

## 7. 发布策略与回滚

M1 起始使用停机风险较低的滚动/替换部署：

- 服务端收到终止信号后停止接纳新房间，给现有房间短暂重连窗口。
- 房间热状态在 M1 不保证跨进程无缝迁移；玩家可重连并从最近检查点恢复。
- Web 文件使用内容哈希，旧客户端在协议兼容窗口内继续工作。
- feature flag 默认关，可先对测试房间开启。

回滚顺序：

1. 关闭新 feature flag，停止扩大影响。
2. Web 指向上一份静态制品。
3. 服务端部署上一镜像 digest（前提是数据库仍向前兼容）。
4. 若数据已变化，执行预先评审的前向修复，不临时手写生产 SQL。
5. 记录事件时间线、影响、恢复证据和后续行动。

## 8. 发布完成定义

- 版本 tag、GitHub Release、changelog 和制品 digest 一致。
- staging 必需检查与生产只读冒烟通过。
- 生产客户端显示正确版本并可完成登录/加入房间。
- 关键指标无异常：登录失败率、连接/重连率、room 数、tick 延迟、错误率。
- 回滚目标已知且上一制品仍可获取。
- 发布记录不包含秘密或玩家个人数据。

## 9. 尚需维护者提供

- GitHub 组织/仓库和维护者账号。
- Cloudflare、Railway、Supabase 与 GHCR 的项目/权限。
- 域名、DNS 与环境命名。
- 生产发布审批人、告警接收渠道和预算。
- 开源或私有许可证选择。

在这些外部条件具备前，可以完成本地工程和 CI 设计，但不能声称已发布到公网。
