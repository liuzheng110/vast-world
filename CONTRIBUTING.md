# 贡献 VastWorld

欢迎提交玩法、代码、测试、地图、文档和问题报告。仓库当前处于规划/M0 阶段；文档中的计划目录和命令只有在对应文件存在后才视为可用。

## 1. 开始前

1. 阅读 `README.md` 和 `AGENTS.md`。
2. 玩法改动阅读 `GAME_DESIGN.md`，跨边界改动阅读 `ARCHITECTURE.md`。
3. 搜索已有 Issue，避免重复实现。
4. 大功能先创建 Issue；协议、数据库、认证、部署拓扑或渲染引擎变更先写 ADR。
5. 检查项目许可证。许可证尚未由维护者选定前，仓库不应公开接收无法确认授权的外部代码或素材。

## 2. 分支模型

采用受保护 `main` + 短生命周期分支，不维护长期 `develop` 分支：

```text
feat/short-name
fix/short-name
docs/short-name
chore/short-name
```

- 禁止直接推送 `main`，所有改动经 Pull Request。
- 分支尽量在数天内合并或关闭，及时同步 `main`。
- 发布机器人可以维护 `release/*` 或发布 PR；人不要把功能直接开发在发布分支。
- 不擅自 force-push 别人的分支，不覆盖工作区中的未知改动。

## 3. 本地验证

M0 工程建立后，标准命令为：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

本地服务命令预计为 `pnpm dev`，数据库重建预计为 `pnpm db:reset`。在根 `package.json` 真正提供这些 script 之前，它们是工程契约，不是已完成事实。

按改动补充：

- Web/2.5D：真实浏览器检查画面、深度排序、输入、控制台和窄屏降级。
- 多人：至少两个独立会话验证加入、离开、重连和版本错误。
- 协议：新旧版本兼容或明确拒绝的测试。
- 数据库：从空库执行全部迁移，验证 RLS 和回滚/前向修复方案。
- 游戏规则：固定随机种子、边界条件、非法输入和 feature flag 测试。
- 性能：记录房间人数、tick 延迟、消息带宽和测试环境。

## 4. Commit 规范

使用 Conventional Commits 风格：

```text
feat(content): add slime definition
fix(server): reject stale movement input
docs(architecture): clarify reconnect ownership
test(protocol): cover unsupported client version
chore(deps): update phaser
```

标题使用英文小写类型，正文可用中文。一次提交表达一个逻辑变化；不要为满足格式拆成无法运行的碎片。

破坏性变更使用 `!` 或正文 `BREAKING CHANGE:`，并附迁移与发布顺序。

## 5. Pull Request 要求

PR 必须包含：

- 目的和所属 Issue/路线阶段。
- 玩家可观察变化；纯内部改动说明“不影响玩家表现”。
- 改动范围与明确未改内容。
- 测试命令和结果；UI/多人改动附截图、录屏或 trace。
- 协议、迁移、权限、性能、素材许可和兼容性影响。
- feature flag、发布步骤和回滚方式。
- AI 协作记录：工具/模型、AI 参与部分、人工验证、残余风险；不要粘贴可能含秘密或私人数据的完整 Prompt。

不要填写主观的“AI 生成比例”。可追溯单位是 PR 中的具体改动和验证，不是无法核实的百分比。

## 6. 评审与合并

- 所有必需 CI 检查通过且分支保持最新。
- 至少一名维护者批准；高风险区域按 CODEOWNERS（建立后）要求额外批准。
- 作者不能批准自己的高风险改动。
- 数据库迁移、认证/RLS、协议破坏、奖励/经济、发布工作流和权限配置不得自动合并。
- 依赖更新可以由机器人创建 PR，但仍要经过 CI；重大版本升级需人工验证。
- 推荐 squash merge，使一个 PR 对应 `main` 上一个可回滚变更。

高风险区域：

```text
apps/game-server
packages/protocol
packages/game-core
supabase/migrations
.github/workflows
认证、权限、奖励和内容执行边界
```

## 7. 玩法与素材贡献

- 新内容优先写成 `packages/content` 中的声明式定义，复用已有规则。
- 新规则类型必须有服务端实现、确定性测试、网络影响说明和开关。
- 地图源文件与导出文件必须一起版本化，并能在 CI 重新校验。
- 素材必须记录作者、来源 URL、许可证和允许的修改/分发范围。
- AI 生成素材必须说明使用工具，并确认工具条款允许项目所需用途。
- 禁止提交来源不明、抓取、侵权或带真实个人信息的素材。

## 8. 安全问题

不要在公开 Issue 中披露可利用漏洞、令牌或真实用户数据。`SECURITY.md` 建立前，请私下联系仓库维护者；若无法私下联系，只提交不含利用细节的提醒。

## 9. 自动化边界

自动化可以创建依赖更新 PR、版本 PR和生成制品；不能自行决定玩法规则、自动合并高风险改动、绕过环境审批或修改生产数据。完整发布流程见 `RELEASE.md`。
