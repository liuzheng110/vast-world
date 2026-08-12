-- VastWorld · 测试框架（不依赖 pgTAP）
--
-- 选择理由：pgTAP 需要安装扩展，PGlite 等精简引擎没有。这里用纯 SQL/plpgsql
-- 实现最小断言集，同一套用例可以在 PGlite、裸 PostgreSQL 和本地 Supabase 上跑。
--
-- 用法约定：
--   - 每个用例文件由运行器包在一个事务里执行，结束后回滚，互不污染。
--   - 断言结果写入 tests.results；运行器在回滚前读走。
--   - 断言失败**不抛异常**，避免中止事务导致后续断言无法执行；
--     由运行器根据 passed=false 判定整体失败。
--
-- ⚠ 本目录不属于迁移，不会进入 staging/production。

create schema if not exists tests;
grant usage on schema tests to public;

create table if not exists tests.results (
  id      bigserial primary key,
  suite   text        not null,
  name    text        not null,
  passed  boolean     not null,
  detail  text,
  ran_at  timestamptz not null default now()
);

-- 当前用例名，避免每次断言都重复传。
create or replace function tests.begin_suite(p_suite text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('tests.suite', p_suite, true);
end;
$$;

-- 记录一条结果。security definer：断言时的角色可能是 anon，没有写表权限。
create or replace function tests.record(p_name text, p_passed boolean, p_detail text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into tests.results (suite, name, passed, detail)
  values (
    coalesce(pg_catalog.current_setting('tests.suite', true), '(unnamed)'),
    p_name,
    p_passed,
    p_detail
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 角色切换
-- ---------------------------------------------------------------------------
-- 先 reset role 回到会话属主，再切到目标角色：
-- anon/authenticated 之间没有互相 SET ROLE 的成员资格，必须经过属主中转。
create or replace function tests.act_as(p_role text, p_uid uuid default null)
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config(
    'request.jwt.claims',
    case
      when p_uid is null then json_build_object('role', p_role)::text
      else json_build_object('sub', p_uid::text, 'role', p_role)::text
    end,
    true
  );
  execute format('set local role %I', p_role);
end;
$$;

-- 未登录浏览器会话：没有 sub。
create or replace function tests.act_as_anon()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end;
$$;

-- 游戏服务 / 后台任务。
create or replace function tests.act_as_service()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end;
$$;

-- 回到迁移属主（用于准备夹具）。
create or replace function tests.act_as_owner()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 断言
-- ---------------------------------------------------------------------------

create or replace function tests.check(p_name text, p_condition boolean, p_detail text default null)
returns void
language plpgsql
as $$
begin
  perform tests.record(p_name, coalesce(p_condition, false), p_detail);
end;
$$;

-- 期望语句被权限/RLS 拒绝（SQLSTATE 42501）。
-- 覆盖三种拒绝来源：表级授权、列级授权、RLS 策略与守卫触发器。
create or replace function tests.check_denied(p_name text, p_sql text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception
    when insufficient_privilege then
      perform tests.record(p_name, true, 'denied: ' || sqlerrm);
      return;
    when others then
      perform tests.record(p_name, false,
        format('期望 42501 拒绝，实际 %s: %s', sqlstate, sqlerrm));
      return;
  end;
  perform tests.record(p_name, false, '期望被拒绝，但语句执行成功');
end;
$$;

-- 期望语句因为数据约束被拒绝（check / unique / foreign key 等）。
create or replace function tests.check_rejected(p_name text, p_sql text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception
    when check_violation or unique_violation or foreign_key_violation
      or not_null_violation or exclusion_violation or invalid_text_representation then
      perform tests.record(p_name, true, 'rejected: ' || sqlerrm);
      return;
    when others then
      perform tests.record(p_name, false,
        format('期望约束拒绝，实际 %s: %s', sqlstate, sqlerrm));
      return;
  end;
  perform tests.record(p_name, false, '期望被约束拒绝，但语句执行成功');
end;
$$;

create or replace function tests.check_allowed(p_name text, p_sql text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception when others then
    perform tests.record(p_name, false, format('期望成功，实际 %s: %s', sqlstate, sqlerrm));
    return;
  end;
  perform tests.record(p_name, true, null);
end;
$$;

-- 期望语句影响的行数。RLS 过滤掉的行不会报错，只是"影响 0 行"，
-- 这类静默失败必须单独断言。
create or replace function tests.check_rowcount(p_name text, p_sql text, p_expected bigint)
returns void
language plpgsql
as $$
declare
  v_actual bigint;
begin
  begin
    execute p_sql;
    get diagnostics v_actual = row_count;
  exception when others then
    perform tests.record(p_name, false, format('执行失败 %s: %s', sqlstate, sqlerrm));
    return;
  end;
  perform tests.record(
    p_name,
    v_actual = p_expected,
    format('期望 %s 行，实际 %s 行', p_expected, v_actual)
  );
end;
$$;
