# VastWorld（万象世界）

VastWorld 是一个由社区持续扩展的多人在线 2.5D Web 游戏。玩家打开网页、登录账号、进入房间即可游玩；开发者通过 Issue 和 Pull Request 增加玩法。

当前仓库处于 **M0：工程基线规划** 阶段，尚无可运行游戏代码。不要把规划文档描述成已经实现的功能。

## 已确定的产品边界

- 浏览器直接运行，桌面端优先，后续再适配移动端。
- 固定斜俯视/正交视角，二维权威坐标，分层精灵呈现 2.5D 世界。
- 首个可玩版本支持账号登录、房间、多人移动、昵称、聊天、断线重连。
- 首发按每房间 16 名玩家设计，不以“单一无缝 MMO 世界”为目标。
- 游戏规则和关键状态由服务端判定，客户端只负责输入、表现与预测。
- 玩法通过小模块逐步加入；每个改动必须可测试、可关闭、可回滚。

## 技术方案

| 区域 | 选型 | 职责 |
| --- | --- | --- |
| Web 客户端 | TypeScript、React、Vite、Phaser | 页面/UI、2.5D 渲染、输入、插值与客户端预测 |
| 实时游戏服务 | Node.js、Colyseus | 房间、权威状态、游戏循环、同步、重连 |
| 账号与数据 | Supabase Auth、PostgreSQL | 身份、角色资料、存档、迁移、备份 |
| 共享契约 | TypeScript package、运行时校验 | 消息、内容配置、错误码和版本兼容 |
| 工程 | pnpm workspace、GitHub Actions、Docker | 一致构建、测试、制品与发布 |

选择依据和系统边界见 [架构文档](ARCHITECTURE.md)。

## 计划中的仓库结构

```text
vast-world/
├─ apps/
│  ├─ web/                 # React + Phaser 2.5D 客户端
│  └─ game-server/         # Colyseus 权威游戏服务
├─ packages/
│  ├─ protocol/            # 网络消息、错误码、协议版本
│  ├─ game-core/           # 可在无渲染环境测试的纯游戏规则
│  ├─ content/             # 技能、物品、怪物等数据定义
│  └─ config/              # 共享 TypeScript/ESLint 配置
├─ supabase/
│  ├─ migrations/          # 数据库迁移
│  └─ seed.sql             # 本地开发数据
├─ tests/
│  ├─ e2e/
│  └─ load/
├─ docs/
├─ .github/
├─ AGENTS.md
└─ pnpm-workspace.yaml
```

目录会在 M0 实现时创建；未进入代码库的目录不代表已完成。

## 文档入口

- [AGENTS.md](AGENTS.md)：所有开发 Agent 开始工作前必须阅读的操作边界。
- [ARCHITECTURE.md](ARCHITECTURE.md)：唯一有效的系统架构和技术决策。
- [GAME_DESIGN.md](GAME_DESIGN.md)：产品边界、核心体验与内容扩展规则。
- [ROADMAP.md](ROADMAP.md)：按验收条件推进的版本路线。
- [RELEASE.md](RELEASE.md)：CI、自动 PR、制品、部署与回滚设计。
- [CONTRIBUTING.md](CONTRIBUTING.md)：Issue、分支、Commit、PR 和评审流程。

## 当前下一步

完成 [M0 工程基线](ROADMAP.md)：初始化 monorepo、建立最小客户端/服务端、接入本地 Supabase、加入 CI 和首个自动发布流水线。远程 GitHub 仓库、域名、云账号和生产密钥需要项目维护者提供。

> 人提出方向，代码通过验证，所有人共同让世界持续成长。
