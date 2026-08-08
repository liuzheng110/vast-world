# VastWorld 免费开发环境方案

## 项目概况

- **项目**：VastWorld（万象世界）— 浏览器多人在线 2.5D Web 游戏
- **当前阶段**：M0 工程基线（仅 `packages/config` 已初始化，`apps/` 尚未创建）
- **技术栈**：pnpm monorepo + TypeScript + React + Vite + Phaser（客户端）/ Node.js + Colyseus（服务端）/ Supabase + PostgreSQL（数据）
- **本机已有**：Node v22.22.3、pnpm 11.20.0、Git 2.47.1
- **本机缺失**：Docker（Supabase 本地容器依赖）

## 免费环境选型

### 1. 本地开发（免费）
| 组件 | 方案 | 说明 |
| --- | --- | --- |
| Node.js / pnpm | ✅ 已有 | Node 22.22.3 + pnpm 11.20.0 满足 `engines` 要求 |
| 编辑器 | VS Code / Cursor | 免费 |
| 本地 Supabase | **Supabase CLI**（无需 Docker） | `supabase start` 需 Docker；**替代**：直接用云免费档 |
| 本地 PostgreSQL | **Supabase 云免费档** 或 `pglite` | 免安装即可开发 |

### 2. 云端免费档（零成本生产路径）
| 服务 | 免费档 | 用途 |
| --- | --- | --- |
| **Supabase** | 2 个免费项目，500MB DB / 50k MAU | Auth + PostgreSQL + Storage |
| **Cloudflare Pages** | 无限静态站点 | Web 客户端托管 |
| **Railway** | $5 免费额度/月（需绑卡）⚠️ | 游戏服务端容器（WebSocket 常驻） |
| **Fly.io** | 3 个 shared-cpu-1x VM（256MB）| 替代 Railway，更适合 WebSocket |
| **GitHub** | 私有仓库无限 | 代码 + GitHub Actions CI |
| **GHCR** | 免费 | Docker 镜像仓库 |

### 3. 推荐组合（完全免费）

```
本地开发 → Supabase 云免费档（Auth + DB）
Web 部署 → Cloudflare Pages
服务端部署 → Fly.io（3 个免费 VM）
CI → GitHub Actions（2000 分钟/月免费）
```

## 立即可执行的步骤

### 第 0 步：初始化 monorepo 子包
当前 `apps/`、`packages/protocol`、`packages/game-core`、`packages/content` 均未创建。
需要创建：
1. `apps/web` — React + Vite + Phaser 客户端
2. `apps/game-server` — Colyseus 服务端
3. `packages/protocol` — 共享消息/类型
4. `packages/game-core` — 纯游戏规则
5. `packages/content` — 数据驱动内容

### 第 1 步：注册 Supabase 云免费项目
- https://supabase.com 注册
- 创建 1 个项目（staging/local 共用）
- 获取：Project URL、anon key、service_role key
- 填入 `.env`

### 第 2 步：建立首个数据库迁移
- `supabase/migrations/0001_init.sql`
- 建表：`profiles`、`player_state`、`inventory`、`audit_log`
- 启用 RLS

### 第 3 步：搭建最小客户端
- Vite + React + Phaser 空场景
- 显示协议版本和 commit SHA

### 第 4 步：搭建最小服务端
- Colyseus 空房间
- 健康检查 `/health/live` `/health/ready`
- 协议握手（返回 protocolVersion + serverVersion）

### 第 5 步：连通验证
- 客户端连接服务端
- 显示版本信息
- CI 跑通 lint / typecheck / test / build

## 待用户决策

1. **是否安装 Docker Desktop？**
   - ✅ 装：可用 `supabase start` 全本地开发
   - ❌ 不装：直接用 Supabase 云免费档（推荐，更省资源）

2. **服务端部署平台选择？**
   - Fly.io（推荐，3 个免费 VM，适合 WebSocket）
   - Railway（$5/月免费额度，需绑卡）

3. **是否已有 Supabase / Cloudflare / Fly.io 账号？**
