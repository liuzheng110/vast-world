# VastWorld CI、自动 PR 与发布方案

状态：M0 工作流已落地（CI / release-please / release / preview / deploy-staging 占位）。
本文件同时描述目标与已实现的自动化。**当前阶段明确禁止 Docker 构建、GHCR 推送与容器部署**，
相关步骤已删除或禁用；制品以 tarball 形式随 GitHub Release 发布。自动化未推送 GitHub，以下状态以代码为准。

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
- 必需检查：`lint`、`typecheck`、`unit`、`build`、`integration`、`e2e`、`migration-check`；聚合检查名为 `required-checks`（供分支保护引用）。
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
4. 机器人创建 SemVer tag 与 GitHub Release（release-please-action v4 默认行为，同一 step 同时维护版本 PR 和创建 Release；v4 不再支持 `command: release-pr` / `command: github-release` 输入，也不输出 `release_id`）。
5. 同一工作流在 `releases_created=true` 后通过 `workflow_call` 调用 `release.yml`，构建并上传制品
   （web-dist / game-server-dist / checksums / version.json）到已存在的 Release（使用 `gh release upload`，
   不再次 `gh release create`）。**不依赖「GITHUB_TOKEN 创建 tag 再触发 release.yml」的旧模式。**

游戏应用先使用一个统一版本号，避免早期分别版本化 web/server/protocol。`protocolVersion` 独立存在，用于运行时兼容，不等同产品 SemVer。

> 注意：release-please-action v4 已移除 `command` 输入。默认行为是同一 step 同时维护版本 PR 和创建 GitHub Release；
> 如需拆分，使用 `skip-github-release: true` 或 `skip-github-pull-request: true`。
> v4 不输出 `release_id`；可用输出包括 `releases_created`、`paths_released`、`tag_name` 等。
> `.release-please-manifest.json` 是 manifest 配置文件（版本映射），与 action 输入无关。

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
- **强制门禁**：`apps/web`、Playwright 与 E2E 若存在则必须真正运行并通过；缺失时报错退出（不 warning 后 0）。聚合检查名为 `required-checks`，供分支保护引用。
- `migration-check` 真实执行 `pnpm db:test`（PGlite 跑迁移/RLS/约束），而非仅检查文件名。

### `preview.yml` — PR 预览

- **必须真实构建 Web 静态产物**（`pnpm --filter @vastworld/web build`），缺失 apps/web 时该步骤失败。
- 构建产物作为 `preview-web` artifact 上传，供人工/Cloudflare 取用。
- Cloudflare Pages 部署步骤在 `CLOUDFLARE_API_TOKEN` 缺失时跳过，但**构建不跳过**。
- 默认连接共享的无生产数据测试服务，或仅运行本地模拟。
- 涉及服务端/迁移的短生命周期环境在 M2 后评估；M0 不承诺每 PR 一套完整后端。
- 预览页面显示 PR 编号、commit SHA、API 目标与“非生产”标识。

### `deploy-staging.yml` — 手动占位（当前禁用）

- **当前明确禁止 Docker 构建与 GHCR 推送**，因此本工作流不构建镜像、不推送制品。
- 仅保留 `workflow_dispatch` 手动触发占位，打印“staging 部署在 M0 阶段禁用”，不假装部署成功。
- 待维护者提供 Docker/Registry/Staging 环境后，再恢复：构建 Web bundle 与 game-server 镜像、推 GHCR（tag 含完整 SHA + digest）、
  向前兼容迁移 → 部署服务端 → 部署 Web、运行健康检查/协议握手/登录/双客户端冒烟，冒烟失败停止并告警。

### `release.yml` — 复用工作流（制品构建，由 release-please 调用）

- 作为 `workflow_call` 复用工作流，由 `release-please.yml` 在 `release_created=true` 后调用。
- **不构建 Docker 镜像、不推 GHCR**；改为打包 tarball 制品：
  - `web-dist.tar.gz`（来自 apps/web/dist）
  - `game-server-dist.tar.gz`（apps/game-server/dist 构建产物，esbuild 内联 @vastworld/* 源码，pnpm 预装 node_modules，下载后解压 `node main.js` 即可运行，不需要 npm install / pnpm install / tsx / monorepo 布局）
  - `checksums.txt`（sha256）
  - `version.json`（tag / version / commitSha / protocolVersion）
- 使用 `gh release upload` 把这些制品上传到 release-please 已创建的 GitHub Release（**不再次 `gh release create`**）。
- 生产晋级（数据库 → 服务端 → Web、只读冒烟）仍由受保护 environment 在维护者批准后执行，不在本工作流内。

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

## 10. 人工配置清单（需维护者在 GitHub 设置完成）

以下动作无法由代码自动完成，需在仓库 **Settings** 中手动配置；工作流已按这些约定编写。

### 10.1 分支保护（Branches → Branch protection rules → main）

- 禁止 force push、禁止删除 `main`。
- 要求 Pull Request 并入，至少 1 名批准，要求解决全部会话线程。
- 要求分支与 `main` 最新（可选 merge queue）。
- **必需状态检查**：勾选聚合检查 `required-checks`（CI 工作流中定义的稳定检查名）。
  其余单项（verify / migration-check / integration / e2e）作为参考，不必逐一勾选。
- 不允许 fork PR 绕过（CI 用 `pull_request` 触发，fork PR 无仓库 secret）。

### 10.2 GitHub Environments

- 创建 `staging` 与 `production` 两个 Environment。
- `production` 必须配置 **Required reviewers**（人工批准），并在 environment 内限定可部署的分支/secret。
- `staging` 当前未启用真实部署（deploy-staging.yml 为禁用占位），environment 可先建好待后续启用。
- 各 environment 之间不共享 secret；密钥仅存于 GitHub Environment secret store。
- 当前工作流未读取任何部署 secret；Cloudflare 部署仅当有 `CLOUDFLARE_API_TOKEN` 时才尝试。

### 10.3 第三方 Action 固定 SHA（已落实）

- 所有 `uses:` 均固定到完整 commit SHA（见各工作流文件顶部注释），不使用浮动 tag/branch。
- 升级第三方 Action 时同步更新 SHA，并由 Dependabot 的 `github-actions` monthly PR 提议。

### 10.4 明确禁止（当前阶段）

- **禁止 Docker 构建、GHCR 推送、容器部署**。所有相关步骤已从 release.yml / deploy-staging.yml 删除或禁用。
- 制品以 tarball 形式随 GitHub Release 发布；生产容器化部署待维护者提供 Registry/Staging 后另行设计。
