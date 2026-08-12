# VastWorld（万象世界）

VastWorld 是一个由社区持续扩展的多人在线 2.5D Web 游戏。玩家打开网页、登录账号、进入房间即可游玩；开发者通过 Issue 和 Pull Request 增加玩法。

当前仓库处于 **M0：工程基线** 阶段。M0 已落地最小可运行的客户端、服务端、共享协议与 CI 流水线，但尚无登录、房间玩法或战斗等内容。不要把规划文档描述成已经实现的功能。

## 已确定的产品边界

- 浏览器直接运行，桌面端优先，后续再适配移动端。
- 固定斜俯视/正交视角，二维权威坐标，分层精灵呈现 2.5D 世界。
- 首个可玩版本支持账号登录、房间、多人移动、昵称、聊天、断线重连。
- 首发按每房间 16 名玩家设计，不以"单一无缝 MMO 世界"为目标。
- 游戏规则和关键状态由服务端判定，客户端只负责输入、表现与预测。
- 玩法通过小模块逐步加入；每个改动必须可测试、可关闭、可回滚。

## 技术方案

| 区域 | 选型 | 职责 |
| --- | --- | --- |
| Web 客户端 | TypeScript、React、Vite、Phaser | 页面/UI、2.5D 渲染、输入、插值与客户端预测 |
| 实时游戏服务 | Node.js、Colyseus | 房间、权威状态、游戏循环、同步、重连 |
| 账号与数据 | Supabase Auth、PostgreSQL | 身份、角色资料、存档、迁移、备份 |
| 共享契约 | TypeScript package、运行时校验 | 消息、内容配置、错误码和版本兼容 |
| 工程 | pnpm workspace、GitHub Actions | 一致构建、测试、制品与发布 |

选择依据和系统边界见 [架构文档](ARCHITECTURE.md)。

## 仓库结构

```text
vast-world/
├─ apps/
│  ├─ web/                 # React + Phaser 2.5D 客户端
│  └─ game-server/         # Colyseus 权威游戏服务
├─ packages/
│  ├─ protocol/            # 网络消息、错误码、协议版本
│  ├─ game-core/           # 可在无渲染环境测试的纯游戏规则
│  └─ config/              # 共享 TypeScript/ESLint/Prettier 配置
├─ supabase/
│  ├─ migrations/          # 数据库迁移
│  └─ tests/               # PGlite 本地迁移/RLS 测试
├─ tests/
│  └─ e2e/                 # Playwright 双客户端端到端测试
├─ docs/
│  └─ adr/                 # 架构决策记录
├─ .github/
│  ├─ workflows/           # CI / release-please / preview / deploy-staging
│  └─ dependabot.yml
├─ AGENTS.md
├─ ARCHITECTURE.md
├─ GAME_DESIGN.md
├─ ROADMAP.md
├─ RELEASE.md
├─ CONTRIBUTING.md
└─ pnpm-workspace.yaml
```

## 快速开始

### 前置要求

- Node.js ≥ 22（推荐 22.22.3）
- pnpm ≥ 11（推荐 11.20.0，通过 `corepack enable` 启用）
- Git

### 安装与运行

```bash
# 克隆并安装依赖
git clone <repo-url> vast-world
cd vast-world
pnpm install

# 复制环境变量示例（按需修改）
cp .env.example .env

# 同时启动 Web 开发服务器和游戏服务端
pnpm dev

# 或分别启动
pnpm web:dev          # Web 开发服务器（Vite，默认 http://localhost:5173）
pnpm --filter @vastworld/game-server dev  # 游戏服务端（默认 ws://localhost:2567）
```

启动后打开 Web 开发服务器地址，客户端会自动连接本地游戏服务端并完成协议握手。页面显示连接状态、协议版本、应用版本和 commit SHA 即代表 M0 连接基线正常。

### 验证与测试

```bash
pnpm lint             # ESLint 全仓库
pnpm typecheck        # TypeScript 类型检查（根 + 所有 workspace）
pnpm -r run test      # 运行所有 workspace 的单元测试（共 73 个）
pnpm test             # 仅运行根 Vitest（只覆盖 packages/，不含 apps/）
pnpm build            # 构建所有 workspace 产物
pnpm format:check     # Prettier 格式检查
pnpm db:test          # PGlite 本地数据库迁移/RLS 测试
pnpm test:e2e         # Playwright E2E（需先 pnpm build 并启动服务）
```

### 环境变量

`.env.example` 列出了所有需要的环境变量。浏览器只可使用 `VITE_` 前缀变量；服务端变量（`DATABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 等）不得出现在客户端代码中。

## M0 当前状态

已实现：

- pnpm workspace monorepo：`apps/web`、`apps/game-server`、`packages/protocol`、`packages/game-core`、`packages/config`
- Colyseus 权威游戏服务端：房间、握手门禁、20Hz tick、聊天广播、健康检查（`/health/live`、`/health/ready`、`/version`、`/metrics`）
- React + Phaser 客户端：连接状态机、握手流程、协议版本不匹配/连接失败覆盖层、WASD/方向键移动、滚轮缩放
- 共享协议包：协议版本、消息类型、错误码、运行时校验、速率限制
- 纯规则游戏核心：移动归一化、AABB 钳制、序列号单调递增、速率限制器
- CI：lint、typecheck、全 workspace 单元测试（73 个）、build、协议契约检查、迁移检查、集成测试、Playwright E2E 双客户端验证
- 自动发布：release-please v4 manifest 模式 + 制品构建（web-dist + game-server-dist + checksums + version.json）
- 数据库：Supabase 迁移 + PGlite 本地测试

尚未实现（M1 范围）：

- 账号登录、昵称、大厅
- 多人移动互相可见的精灵渲染
- 聊天 UI
- 断线重连的完整体验
- 16 人房间压测

## 文档入口

- [AGENTS.md](AGENTS.md)：所有开发 Agent 开始工作前必须阅读的操作边界。
- [ARCHITECTURE.md](ARCHITECTURE.md)：唯一有效的系统架构和技术决策。
- [GAME_DESIGN.md](GAME_DESIGN.md)：产品边界、核心体验与内容扩展规则。
- [ROADMAP.md](ROADMAP.md)：按验收条件推进的版本路线。
- [RELEASE.md](RELEASE.md)：CI、自动 PR、制品、部署与回滚设计。
- [CONTRIBUTING.md](CONTRIBUTING.md)：Issue、分支、Commit、PR 和评审流程。

## 当前下一步

完成 [M1 权威多人垂直切片](ROADMAP.md)：登录、昵称、大厅、16 人房间、一张 2.5D 地图、权威移动、玩家显示、聊天、离开和断线重连。

> 人提出方向，代码通过验证，所有人共同让世界持续成长。
