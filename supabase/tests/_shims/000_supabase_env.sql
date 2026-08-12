-- VastWorld · 测试专用：Supabase 平台环境替身（shim）
--
-- ⚠⚠ 本文件**绝对不能**放进 supabase/migrations。
--     真实 Supabase 已经内置 auth schema、anon/authenticated/service_role 角色
--     和 auth.uid() 等函数；重复创建会与平台冲突。
--
-- 用途：在没有 Docker / Supabase CLI 的机器上，用裸 PostgreSQL 或 PGlite
--       跑迁移与 RLS 测试。只补齐迁移所依赖的最小平台契约。
--
-- 与真实 Supabase 的已知差异（测试解读时必须记住）：
--   1. 这里的 auth.users 只有种子与迁移用到的列，不是 GoTrue 的完整表。
--   2. service_role 故意**不**授予 BYPASSRLS。真实 Supabase 的 service_role
--      带 bypassrls，会绕过策略；这里不给，是为了让测试真正检验策略本身。
--      策略通过 = 即使 bypassrls 消失，服务端权限依然成立（更严格的下界）。
--   3. 没有 PostgREST，角色切换用 set local role + request.jwt.claims 模拟。

create schema if not exists auth;
create schema if not exists extensions;

-- ---------------------------------------------------------------------------
-- 平台角色
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- 见文件头说明：故意不加 bypassrls。
    create role service_role nologin noinherit;
  end if;
end;
$$;

grant usage on schema auth       to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth.users 最小替身
-- ---------------------------------------------------------------------------
create table if not exists auth.users (
  instance_id        uuid,
  id                 uuid primary key,
  aud                varchar(255),
  role               varchar(255),
  email              varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  last_sign_in_at    timestamptz,
  raw_app_meta_data  jsonb,
  raw_user_meta_data jsonb,
  is_anonymous       boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table auth.users is '测试替身：仅覆盖 VastWorld 迁移与种子用到的列。';

-- 平台表默认对业务角色不可见。
revoke all on table auth.users from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- auth 辅助函数（签名与语义对齐 Supabase）
-- ---------------------------------------------------------------------------
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', current_user::text)
$$;

grant execute on function auth.jwt()  to anon, authenticated, service_role;
grant execute on function auth.uid()  to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
