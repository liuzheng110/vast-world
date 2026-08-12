#!/usr/bin/env node
/**
 * VastWorld · 无 Docker 的数据库验证运行器
 *
 * 背景：`supabase db reset` + `supabase test db` 需要 Docker。没有 Docker 的机器
 * 无法验证迁移，于是只能"声称通过"。这个脚本用 PGlite（编译成 WASM 的真实
 * PostgreSQL）跑同一套迁移与用例，让本地至少有可复现的证据。
 *
 * 它验证四件事：
 *   1. 迁移能从空库执行；
 *   2. 连续执行两遍结果完全一致（幂等）；
 *   3. 两个独立的空库重建出的结构完全一致（可重复）；
 *   4. seed 可重复执行，且四类角色的权限边界符合设计。
 *
 * 已知边界：PGlite 不是 Supabase。auth schema、平台角色由 _shims 模拟，
 * 没有 GoTrue、PostgREST 和 pgcrypto。它能证伪，但不能替代一次真正的
 * `supabase db reset`。结论请按这个前提解读。
 *
 * 用法：
 *   pnpm db:test                          # 根目录脚本；pglite 已声明为锁定开发依赖
 *   node supabase/tests/run-local.mjs     # 等价写法；若 pglite 不在解析路径，用 PGLITE_PATH 指定
 *
 * 注意：本运行器证明不了真实 Supabase 的行为（无 GoTrue/PostgREST/pgcrypto）。
 *       Docker 在本项目继续暂缓，合并前仍需在有 Docker 的机器上跑一次本地 Supabase。
 */

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const here = dirname(fileURLToPath(import.meta.url))
const supabaseDir = resolve(here, '..')
const paths = {
  migrations: join(supabaseDir, 'migrations'),
  seed: join(supabaseDir, 'seed.sql'),
  shims: join(here, '_shims'),
  harness: join(here, '_harness'),
  cases: join(here, 'cases'),
}

/** 结构快照：把 public schema 的契约摊平成可逐行比对的文本。 */
const SNAPSHOT_SQL = `
with parts as (
  select format('table      %s rls=%s', c.relname, c.relrowsecurity) as line
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
  union all
  select format('column     %s.%s %s notnull=%s default=%s',
                c.relname, a.attname, format_type(a.atttypid, a.atttypmod),
                a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), '-'))
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
   where n.nspname = 'public' and c.relkind = 'r'
  union all
  select format('constraint %s.%s %s', c.relname, con.conname, pg_get_constraintdef(con.oid))
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
  union all
  select format('index      %s', indexdef) from pg_indexes where schemaname = 'public'
  union all
  select format('policy     %s.%s cmd=%s roles=%s using=%s check=%s',
                c.relname, p.polname, p.polcmd,
                (select coalesce(string_agg(pg_get_userbyid(r), ',' order by pg_get_userbyid(r)), '-')
                   from unnest(p.polroles) r),
                coalesce(pg_get_expr(p.polqual, p.polrelid), '-'),
                coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'))
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
  union all
  select format('trigger    %s', pg_get_triggerdef(t.oid))
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname in ('public', 'auth')
  union all
  select format('function   %s(%s) secdef=%s',
                p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
  union all
  select format('acl.table  %s %s -> %s', c.relname, acl.privilege_type,
                case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) acl
   where n.nspname = 'public' and c.relkind = 'r'
  union all
  select format('acl.column %s.%s %s -> %s', c.relname, a.attname, acl.privilege_type,
                case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    cross join lateral aclexplode(a.attacl) acl
   where n.nspname = 'public' and c.relkind = 'r'
)
select coalesce(string_agg(line, chr(10) order by line), '') as snapshot from parts
`

async function loadPglite() {
  const specifiers = [process.env.PGLITE_PATH, '@electric-sql/pglite'].filter(Boolean)
  const failures = []
  for (const specifier of specifiers) {
    try {
      const mod = await import(specifier)
      return mod.PGlite
    } catch (error) {
      failures.push(`${specifier}: ${error.message}`)
    }
  }
  throw new Error(
    [
      '找不到 @electric-sql/pglite。',
      ...failures,
      '安装后重试，或用 PGLITE_PATH 指定模块路径。',
    ].join('\n  '),
  )
}

async function sqlFilesIn(dir) {
  const entries = await readdir(dir)
  return entries
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, path: join(dir, name) }))
}

async function applyFile(db, file) {
  const sql = await readFile(file.path, 'utf8')
  await db.exec(sql)
}

async function applyDir(db, dir) {
  const files = await sqlFilesIn(dir)
  for (const file of files) {
    await applyFile(db, file)
  }
  return files.map((file) => file.name)
}

async function snapshot(db) {
  const result = await db.query(SNAPSHOT_SQL)
  return result.rows[0].snapshot
}

/** 建一个空库并按 shim -> migrations 的顺序装配。 */
async function buildFreshDatabase(PGlite) {
  const db = await PGlite.create()
  await applyDir(db, paths.shims)
  const migrations = await applyDir(db, paths.migrations)
  return { db, migrations }
}

function firstDifference(a, b) {
  const left = a.split('\n')
  const right = b.split('\n')
  const max = Math.max(left.length, right.length)
  for (let i = 0; i < max; i += 1) {
    if (left[i] !== right[i]) {
      return `第 ${i + 1} 行:\n    A: ${left[i] ?? '(缺失)'}\n    B: ${right[i] ?? '(缺失)'}`
    }
  }
  return '(无差异)'
}

async function fingerprintData(db) {
  const result = await db.query(`
    select
      (select count(*) from auth.users)          as users,
      (select count(*) from public.profiles)     as profiles,
      (select count(*) from public.player_state) as states,
      (select coalesce(string_agg(
                format('%s|%s|%s', p.id, p.display_name, p.is_banned), ',' order by p.id), '')
         from public.profiles p)                 as profile_rows,
      (select coalesce(string_agg(
                format('%s|%s|%s|%s|%s', s.user_id, s.map_id, s.level, s.hp, s.revision),
                ',' order by s.user_id), '')
         from public.player_state s)             as state_rows
  `)
  return result.rows[0]
}

const report = { checks: [], assertions: { passed: 0, failed: 0 } }

function step(name, passed, detail) {
  report.checks.push({ name, passed, detail })
  const mark = passed ? 'ok  ' : 'FAIL'
  console.log(`  ${mark} ${name}${detail ? `\n       ${detail}` : ''}`)
}

async function runCases(db) {
  const files = await sqlFilesIn(paths.cases)
  for (const file of files) {
    console.log(`\n--- 用例 ${file.name} ---`)
    let rows = []
    let fatal = null
    try {
      await db.exec('begin')
      await applyFile(db, file)
      await db.exec('reset role')
      const result = await db.query(
        'select suite, name, passed, detail from tests.results order by id',
      )
      rows = result.rows
    } catch (error) {
      fatal = error.message
    } finally {
      try {
        await db.exec('rollback')
      } catch {
        // 事务已经不可用时忽略：下一个用例会重新 begin。
      }
    }

    if (fatal) {
      step(`${file.name} 执行中断`, false, fatal)
      continue
    }
    if (rows.length === 0) {
      step(`${file.name} 未产生任何断言`, false, '用例文件可能没有调用 tests.check*')
      continue
    }
    for (const row of rows) {
      const passed = row.passed === true
      if (passed) {
        report.assertions.passed += 1
      } else {
        report.assertions.failed += 1
      }
      console.log(
        `  ${passed ? 'ok  ' : 'FAIL'} ${row.name}${row.detail ? `  — ${row.detail}` : ''}`,
      )
      if (!passed) {
        report.checks.push({
          name: `${row.suite} / ${row.name}`,
          passed: false,
          detail: row.detail,
        })
      }
    }
  }
}

async function main() {
  const PGlite = await loadPglite()

  console.log('=== 1. 从空库执行迁移 ===')
  const { db, migrations } = await buildFreshDatabase(PGlite)
  migrations.forEach((name) => console.log(`  applied ${name}`))
  const snapshotFirst = await snapshot(db)
  step('迁移可在空库上执行', true, `${migrations.length} 个文件`)

  console.log('\n=== 2. 重复执行同一批迁移 ===')
  await applyDir(db, paths.migrations)
  const snapshotSecond = await snapshot(db)
  step(
    '迁移重复执行后结构不变（幂等）',
    snapshotFirst === snapshotSecond,
    snapshotFirst === snapshotSecond ? undefined : firstDifference(snapshotFirst, snapshotSecond),
  )

  console.log('\n=== 3. 另一个空库独立重建 ===')
  const rebuilt = await buildFreshDatabase(PGlite)
  const snapshotRebuilt = await snapshot(rebuilt.db)
  step(
    '独立空库重建出的结构与首次一致（可重复）',
    snapshotFirst === snapshotRebuilt,
    snapshotFirst === snapshotRebuilt ? undefined : firstDifference(snapshotFirst, snapshotRebuilt),
  )
  await rebuilt.db.close()

  console.log('\n=== 4. seed 执行与重复执行 ===')
  const seedSql = await readFile(paths.seed, 'utf8')
  await db.exec(seedSql)
  const afterFirstSeed = await fingerprintData(db)
  step(
    'seed 建立了 3 个本地账号并自动建档',
    Number(afterFirstSeed.users) === 3 &&
      Number(afterFirstSeed.profiles) === 3 &&
      Number(afterFirstSeed.states) === 3,
    `users=${afterFirstSeed.users} profiles=${afterFirstSeed.profiles} player_state=${afterFirstSeed.states}`,
  )
  await db.exec(seedSql)
  const afterSecondSeed = await fingerprintData(db)
  const seedStable =
    afterFirstSeed.profile_rows === afterSecondSeed.profile_rows &&
    afterFirstSeed.state_rows === afterSecondSeed.state_rows
  step(
    'seed 重复执行不改变数据（幂等）',
    seedStable,
    seedStable ? undefined : `第二次执行后数据发生变化\n       ${afterSecondSeed.state_rows}`,
  )

  console.log('\n=== 5. seed 的生产误用安全阀 ===')
  let guardTriggered = false
  let guardMessage = ''
  try {
    await db.exec('begin')
    await db.exec(`
      insert into auth.users (id, aud, role, email, created_at, updated_at)
      values ('00000000-0000-4000-8000-0000000000ee', 'authenticated', 'authenticated',
              'real-looking-user@example.com', now(), now())
    `)
    await db.exec(seedSql)
  } catch (error) {
    guardTriggered = true
    guardMessage = error.message
  } finally {
    await db.exec('rollback')
  }
  step(
    '库中存在非种子账号时 seed 拒绝执行',
    guardTriggered && guardMessage.includes('非种子账号'),
    guardTriggered ? guardMessage.split('\n')[0] : 'seed 竟然执行成功了',
  )

  console.log('\n=== 6. 权限边界与数据完整性用例 ===')
  await applyDir(db, paths.harness)
  await runCases(db)

  await db.close()

  const failedSteps = report.checks.filter((check) => !check.passed)
  console.log('\n=== 汇总 ===')
  console.log(`  断言：通过 ${report.assertions.passed}，失败 ${report.assertions.failed}`)
  console.log(`  流程检查：失败 ${failedSteps.length}`)
  console.log('  注意：运行引擎为 PGlite + 测试 shim，不等同于一次真实的 supabase db reset。')

  if (failedSteps.length > 0 || report.assertions.failed > 0) {
    console.log('\n失败项：')
    failedSteps.forEach((check) =>
      console.log(`  - ${check.name}${check.detail ? `: ${check.detail}` : ''}`),
    )
    process.exitCode = 1
    return
  }
  console.log('\n全部通过。')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
