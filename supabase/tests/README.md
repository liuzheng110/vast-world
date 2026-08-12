# 数据库测试

这里的用例锁住 M0 数据基线的三类承诺：结构契约、权限边界、数据完整性。
用例是**纯 SQL**，不依赖 pgTAP，因此同一套文件可以跑在本地 Supabase、裸
PostgreSQL 和 PGlite 上。

> ⚠️ **PGlite 是验证手段，不是 Supabase 的替代品。**
> 本目录的用例用 PGlite（编译成 WASM 的真实 PostgreSQL）跑同一套迁移与断言，
> 用来在没有 Docker 的机器上提供**可复现的证据**。但 PGlite 没有 GoTrue、
> PostgREST、`pgcrypto` 与平台角色，不能覆盖注册/登录链路、JWT 头转换和真实
> 权限放行。任何合并前都必须在一台**有 Docker** 的机器上跑一次本地 Supabase
> （跑法一）作为最终裁决。
> **Docker 在本项目继续暂缓**——CI 与本地都先用 PGlite 路径，真实
> `supabase db reset` 留待环境就绪后再接入。

## 目录

| 路径          | 作用                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| `_shims/`     | 仅在没有 Supabase 平台时使用的替身：auth schema、平台角色、`auth.uid()` 等 |
| `_harness/`   | 断言框架：`tests.check*` 系列与角色切换助手                                |
| `cases/`      | 用例本体，按编号顺序执行                                                    |
| `run-local.mjs` | 无 Docker 时的运行器（PGlite）                                            |

`_shims/` **绝不能**放进 `supabase/migrations`——真实 Supabase 已内置这些对象。

## 跑法一：本地 Supabase（首选，需要 Docker）

```bash
supabase start
supabase db reset            # 从空库重放迁移 + 执行 seed.sql

# 用真实平台跑用例：不加载 _shims
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
  -v ON_ERROR_STOP=1 \
  -f supabase/tests/_harness/010_test_harness.sql

for f in supabase/tests/cases/*.sql; do
  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f "$f" \
    -c "select suite, name, passed, detail from tests.results order by id"
done
```

注意用 `-1`（单事务）执行用例文件，否则夹具会残留在库里。

## 跑法二：PGlite（无 Docker，首选验证路径）

`@electric-sql/pglite` 已声明为**根目录锁定的开发依赖**，随 `pnpm install` 一并安装。
直接用根脚本运行即可：

```bash
pnpm db:test          # 等价于 node supabase/tests/run-local.mjs
```

若 pglite 不在解析路径中，用 `PGLITE_PATH` 指向模块入口：

```bash
PGLITE_PATH="file:///abs/path/to/@electric-sql/pglite/dist/index.js" \
  node supabase/tests/run-local.mjs
```

运行器依次验证以下全部用例，任一失败退出码非 0：

| 步骤 | 覆盖的承诺                         | 对应本任务要求     |
| ---- | ---------------------------------- | ------------------ |
| 1    | 从**空库**执行全部迁移             | 空库执行迁移       |
| 2    | **重复执行**同一批迁移，结构不变   | 重复迁移（幂等）   |
| 3    | 独立空库重建出的结构与前两次一致   | 可重复 + 重复迁移  |
| 4    | seed 执行并可重复执行（幂等）      | seed               |
| 5    | seed 的安全阀（库中存在非种子账号时拒绝） | seed 误用防护 |
| 6    | 权限边界（`cases/200`、`cases/300`）与数据完整性（`cases/400`） | RLS + 约束用例 |

> 跑法二只证明"迁移与策略在真实 PostgreSQL 语义下成立"，不证明"在 Supabase 平台上成立"。
> 见顶部警告：Docker 继续暂缓，合并前仍需在有 Docker 的机器上跑一次跑法一。

### 这条路径证明不了什么

PGlite 不是 Supabase，解读结论时必须扣掉以下部分：

- 没有 GoTrue：`auth.users` 是 shim 里的简化表，注册/登录链路未被覆盖。
- 没有 PostgREST：角色切换用 `set local role` + `request.jwt.claims` 模拟，
  真实请求头到 JWT claims 的转换未被覆盖。
- 没有 pgcrypto：种子账号不会写入口令哈希，本地密码登录未被覆盖。
- shim 里的 `service_role` **故意不带 `bypassrls`**。这让测试检验的是策略本身，
  比真实环境更严格；反过来说，真实环境中 bypassrls 带来的额外放行没有被测到。
- PostgreSQL 大版本可能与 `config.toml` 里声明的不一致。

合并前仍需在有 Docker 的机器上跑一次跑法一。

## 断言 API

| 函数                                        | 用途                                     |
| ------------------------------------------- | ---------------------------------------- |
| `tests.begin_suite(name)`                   | 标记当前用例名                           |
| `tests.act_as_anon()`                       | 切到未登录浏览器会话                     |
| `tests.act_as('authenticated', uid)`        | 切到指定用户的已登录会话                 |
| `tests.act_as_service()`                    | 切到游戏服务/后台任务                    |
| `tests.act_as_owner()`                      | 切回迁移属主，用来准备夹具               |
| `tests.check(name, condition, detail)`      | 布尔断言                                 |
| `tests.check_denied(name, sql)`             | 期望 SQLSTATE 42501（授权/RLS/守卫拒绝） |
| `tests.check_rejected(name, sql)`           | 期望约束拒绝（check/unique/fk 等）       |
| `tests.check_allowed(name, sql)`            | 期望执行成功                             |
| `tests.check_rowcount(name, sql, expected)` | 期望影响行数——用来抓 RLS 的"静默 0 行"   |

断言失败不抛异常，而是写进 `tests.results`，避免中止事务导致后面的断言跑不到。
