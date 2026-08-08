# VastWorld 架构

状态：已接受的基线方案  
适用阶段：M0–M2  
架构变更方式：在 `docs/adr/` 新增 ADR，经评审后更新本文

## 1. 目标与非目标

VastWorld 是浏览器直接运行的多人在线 **2.5D** 游戏。架构首先服务于小团队和 AI Agent 的并行贡献、快速玩法试验、稳定发布与低成本运维。

MVP 目标：

- 登录账号后进入大厅和房间。
- 每房间目标 16 人，同屏移动、昵称、聊天与断线重连。
- 服务端判定移动、战斗、奖励和存档。
- 一份代码库可在本地、测试和生产环境重复构建。

当前非目标：

- 单一无缝 MMO 世界、数百人同房间。
- 自由相机或完整 3D 物理。
- 用户上传并执行任意 JavaScript、Shader 或服务端插件。
- 微服务拆分、多区域容灾和过早的水平扩容。

## 2. 2.5D 的统一定义

本项目中的 2.5D 是固定斜俯视/正交视角下的二维世界模拟：

- 权威世界坐标为 `x, y`；高度/层级用于表现和有限的高低差，不作为完整 3D 物理轴。
- 地图使用 Tiled JSON，首发采用等距（isometric）或斜俯视瓦片；首张地图确定一种投影后不得混用。
- 人物、怪物、道具以 spritesheet/texture atlas 表现，通过脚点位置进行深度排序。
- 碰撞使用二维圆形、AABB、导航网格和触发区；服务端不加载 Phaser 或浏览器物理引擎。
- 客户端可加入光影、粒子、伪高度、遮挡淡出等效果，但不能改变权威判定。

这一定义排除了自由旋转 3D 摄像机和必须依赖 3D 模型的玩法。若未来改变，必须单独立项和做性能原型。

## 3. 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 语言 | TypeScript strict | 客户端、服务端与共享包统一语言 |
| Web 壳与 UI | React + Vite | 登录、大厅、HUD、设置和构建 |
| 2.5D 客户端 | Phaser | Tilemap、精灵动画、相机、输入、音频和表现碰撞 |
| 地图工具 | Tiled | 输出版本化 JSON；构建时校验自定义属性 |
| 实时游戏服务 | Node.js LTS + Colyseus | 权威房间、状态同步、匹配、重连和固定 tick |
| 契约校验 | TypeScript + Zod/Colyseus Schema | 命令、HTTP DTO、配置和同步状态 |
| 身份与数据 | Supabase Auth + PostgreSQL | JWT 身份、角色资料、存档、迁移和备份 |
| 包管理 | pnpm workspace | 单锁文件的 monorepo |
| 测试 | Vitest + Playwright | 纯规则、协议、集成和双客户端流程 |
| 制品 | Docker + GHCR | 游戏服务构建为不可变镜像 |
| 自动化 | GitHub Actions | CI、依赖 PR、版本 PR、制品和部署 |

依赖版本只在工程基线中锁入 `pnpm-lock.yaml`，文档不写浮动的具体版本号。生产构建必须使用锁文件。

### 为什么不用原方案的 Three.js + Socket.IO

- Three.js 是通用 3D 渲染库；本项目已确定 2.5D，Phaser 直接提供 Tilemap、精灵、相机、输入与音频，玩法贡献者需要维护的基础设施更少。
- Socket.IO 是通用实时通信层；Colyseus 在其上层提供权威房间、匹配、状态同步和重连语义，能减少自研多人框架代码。
- 如原型验证发现 Phaser 的等距地图能力不满足具体美术需求，可通过 ADR 比较 PixiJS 或 Three.js 正交相机方案；不能在不同模块同时混用多套渲染引擎。

## 4. 系统拓扑

```text
Browser
  ├─ React：登录 / 大厅 / HUD
  └─ Phaser：2.5D 场景 / 输入 / 插值
       │ HTTPS + WSS（Supabase JWT）
       ▼
Game Server（Node.js + Colyseus）
  ├─ HTTP：健康检查、版本、少量管理接口
  ├─ Lobby / World Room：鉴权、加入、重连
  ├─ Fixed Tick：权威规则与碰撞
  └─ Persistence Adapter：幂等命令、存档、审计
       │ TLS
       ▼
Supabase
  ├─ Auth：账号、会话、OAuth
  └─ PostgreSQL：角色、背包、进度、内容版本
```

静态 Web 部署到 Cloudflare Pages；游戏服务以 Docker 部署到一个支持常驻 WebSocket 的容器平台。M0 只选一个生产平台，建议先以 Railway 为实现目标；不得依赖会休眠的免费实例承载公开测试。数据库使用独立的 staging 与 production Supabase 项目。

## 5. 仓库边界

```text
vast-world/
├─ apps/
│  ├─ web/                   # React + Phaser 客户端
│  └─ game-server/           # Colyseus 权威服务
├─ packages/
│  ├─ protocol/              # 网络消息、错误码、协议版本
│  ├─ game-core/             # 无渲染/网络/数据库依赖的纯规则
│  ├─ content/               # 地图清单、技能、物品、怪物配置与 schema
│  └─ config/                # tsconfig、lint 等共享配置
├─ assets/
│  └─ source/                # 有来源与许可证记录的源素材
├─ supabase/
│  ├─ migrations/
│  └─ seed.sql
├─ tests/
│  ├─ e2e/
│  └─ load/
├─ docs/
│  └─ adr/
├─ .github/
└─ 根级项目文档与工程配置
```

`plugins/` 暂不建立。公开的“玩家创造”先采用声明式内容数据，经 schema、测试与评审后随版本发布，不加载不受信任代码。

## 6. 服务端权威与同步

### 6.1 输入与状态

客户端只发送意图，例如：

```ts
type MoveInput = {
  sequence: number;
  clientTime: number;
  axisX: number; // -1..1
  axisY: number; // -1..1
};
```

客户端不得发送“我现在位于某坐标”“我造成了多少伤害”“我获得了某物品”等结果。服务端验证身份、频率、取值、距离、碰撞、冷却和资源后产生结果。

### 6.2 时间模型

- MVP 以 20 Hz 固定 tick 模拟，具体值由压测决定并配置化。
- 客户端以浏览器帧率渲染；其他实体使用带缓冲的插值。
- 本地玩家可做输入预测，收到权威状态后按序列号校正。
- 热状态只保存在房间内存中；不逐 tick 写 PostgreSQL。
- 进入、离开、奖励、背包和任务检查点以幂等事务持久化。

### 6.3 房间与扩容

- 首发模型为大厅 + 多个独立世界房间，每房间上限 16 人。
- 一个房间在同一时刻只由一个服务进程拥有。
- M0/M1 使用单实例；达到真实容量瓶颈后才引入 Redis presence、外部 matchmaking 和多实例。
- 跨房间通过明确的 leave/join 完成，不能依赖客户端复制状态。

### 6.4 协议兼容

- 每次握手包含 `clientVersion`、`protocolVersion` 和访问令牌。
- 不兼容客户端收到明确错误和刷新指引。
- 破坏性变更按“数据库向前兼容 → 服务端兼容新旧 → Web 发布 → 移除旧协议”顺序上线。
- 所有公共 ID（物品、技能、怪物、地图）发布后不可复用。

## 7. 认证、授权与数据

- Supabase Auth 是唯一身份源；优先支持邮箱 magic link，后续可加 GitHub/Discord OAuth。
- WebSocket 加入房间时由游戏服务验证 JWT，并将 `auth user id` 映射到内部玩家记录。
- 浏览器只持有 publishable/anon key；`service_role` 和数据库连接字符串只存在于服务端密钥管理中。
- `profiles` 可在严格 RLS 下由用户读写自己的非关键资料。
- 角色状态、背包、货币、任务、奖励和内容发布状态只能由游戏服务写入。
- 所有 public schema 表启用 RLS、约束、外键与必要索引；结构只通过 `supabase/migrations` 修改。

初始数据域：

| 数据 | 持久化 | 写入者 |
| --- | --- | --- |
| 账号/身份 | Supabase Auth | Auth 服务 |
| 昵称/偏好 | `profiles` | 用户自身（RLS）/服务端 |
| 角色检查点 | `player_state` | 游戏服务 |
| 背包/奖励 | `inventory`、事务函数 | 游戏服务 |
| 房间坐标/怪物瞬时状态 | 房间内存 | 游戏服务 tick |
| 内容草稿/发布版 | 版本化内容表或仓库 | 审核流程 |
| 安全审计 | `audit_log` | 服务端/后台任务 |

## 8. 内容扩展模型

新增技能、怪物和物品优先是数据，而不是一个任意脚本文件：

```text
content definition
  → schema validation
  → rule registry in game-core
  → deterministic tests
  → review
  → feature flag / versioned release
```

第一阶段允许开发者通过 Git PR 贡献内容。玩家在游戏内创建内容属于 M3 以后范围，必须经过草稿、审核、发布、禁用和回滚状态机。任何用户输入都不得成为可执行代码。

## 9. 安全与可靠性基线

- 登录、聊天、加入房间和动作命令分别限频；聊天保留屏蔽与举报接口。
- 网络 payload 设大小上限并做运行时校验，未知消息拒绝处理。
- 奖励和库存命令使用 `requestId` 幂等，关键变更写审计日志。
- 密钥按 local/staging/production 隔离，不放在前端、日志、PR 或录屏中。
- 服务提供 `/health/live` 与 `/health/ready`，记录 room 数、在线数、tick 延迟、消息量、异常和重连率。
- 生产数据库启用备份；上线前至少完成一次恢复演练。

## 10. 架构验收门槛

M1 前必须证明：

- 两个真实浏览器能登录并加入同一房间。
- 服务端拒绝超速、非法坐标/动作和过大 payload。
- 断线后能在限定时间内重连，失败时安全回到大厅。
- 客户端与服务端构建来自同一个 commit SHA，协议版本可观测。
- 本地可从空数据库执行迁移并通过 RLS 测试。
- 16 个模拟客户端的 tick 延迟和带宽有基线报告。

发布与自动化细节见 `RELEASE.md`，阶段范围见 `ROADMAP.md`。
