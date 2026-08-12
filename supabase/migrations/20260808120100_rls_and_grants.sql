-- VastWorld M0 · 迁移 2/3：RLS、角色授权与权威字段守卫
--
-- 权限模型（ARCHITECTURE.md §7）：
--   anon           未登录浏览器会话 —— 对业务表零权限。
--   authenticated  已登录浏览器会话 —— 只能读自己的行；profiles 只能改三个展示字段。
--   service_role   游戏服务 / 后台任务 —— 权威写入者。
--
-- 这里做三层防御，任何一层单独失效都不足以让客户端改写权威数据：
--   1. GRANT/REVOKE：列级授权，浏览器角色根本拿不到 is_banned 的 UPDATE 权限。
--   2. RLS 策略：行级限定 id = auth.uid()，且不给客户端 INSERT/DELETE 策略。
--   3. 触发器守卫：即使将来有人误加授权，客户端上下文写权威字段仍然报错。
--
-- 幂等性：revoke/grant 天然幂等；策略统一先 drop if exists 再创建。
--
-- 注意：这里**不使用** force row level security。表属主（postgres）需要在
-- security definer 触发器里为新用户建档；强制 RLS 会在不同 Supabase 版本上
-- 因 bypassrls 属性差异产生难以复现的故障。service_role 的放行改为显式策略，
-- 因此即使目标环境的 service_role 没有 bypassrls，行为也保持一致。

-- ---------------------------------------------------------------------------
-- 0. schema 级可见性
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. 先清空默认授权
-- ---------------------------------------------------------------------------
-- Supabase 对 public schema 配置了 default privileges，新建表会自动授予
-- anon/authenticated。必须显式回收后再按最小权限重新发放。

revoke all on table public.profiles     from public, anon, authenticated;
revoke all on table public.player_state from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. profiles 授权
-- ---------------------------------------------------------------------------
-- 读：整行可读（行范围由 RLS 限定为自己）。
-- 写：只放开三个展示字段的列级 UPDATE。
--     is_banned / id / created_at / updated_at 不在列表中，
--     客户端执行 `update profiles set is_banned = ...` 会直接 42501。
-- 不授予 INSERT：建档由 auth.users 触发器完成（迁移 3）。
-- 不授予 DELETE：注销走 Auth，靠外键级联清理。

grant select on table public.profiles to authenticated;
grant update (display_name, avatar_key, locale) on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

-- ---------------------------------------------------------------------------
-- 3. player_state 授权
-- ---------------------------------------------------------------------------
-- 玩家只读自己的检查点（用于大厅显示"上次在哪"），一切写入归服务端。

grant select on table public.player_state to authenticated;
grant all on table public.player_state to service_role;

-- ---------------------------------------------------------------------------
-- 4. 启用 RLS
-- ---------------------------------------------------------------------------

alter table public.profiles     enable row level security;
alter table public.player_state enable row level security;

-- ---------------------------------------------------------------------------
-- 5. profiles 策略
-- ---------------------------------------------------------------------------
-- auth.uid() 用 (select ...) 包一层：让规划器当成 initplan 求值一次，
-- 而不是每行调用一次，这是 Supabase 官方推荐的 RLS 写法。

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

-- 被封禁用户保留读权限（能看到自己被封），但不能再修改任何字段。
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()) and is_banned = false)
  with check (id = (select auth.uid()));

-- 服务端显式放行，不依赖 bypassrls 属性。
drop policy if exists profiles_service_all on public.profiles;
create policy profiles_service_all
  on public.profiles
  for all
  to service_role
  using (true)
  with check (true);

-- 说明：authenticated 没有 INSERT/DELETE 策略，也没有对应 GRANT，双重拒绝。
--       anon 没有任何策略和授权，读写一律拒绝。

-- ---------------------------------------------------------------------------
-- 6. player_state 策略
-- ---------------------------------------------------------------------------

drop policy if exists player_state_select_own on public.player_state;
create policy player_state_select_own
  on public.player_state
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists player_state_service_all on public.player_state;
create policy player_state_service_all
  on public.player_state
  for all
  to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- 7. 触发器守卫（第三层防御）
-- ---------------------------------------------------------------------------

-- profiles：客户端上下文不得改动权威列。
create or replace function public.guard_profile_protected_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.is_client_context() then
    if new.id is distinct from old.id
       or new.is_banned is distinct from old.is_banned
       or new.created_at is distinct from old.created_at then
      raise exception
        'profiles: id/is_banned/created_at 为服务端权威字段，客户端不可修改'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.guard_profile_protected_columns() is
  '兜底守卫：即使列级授权被放宽，浏览器侧角色仍然无法改写 profiles 权威字段。';

drop trigger if exists profiles_guard_protected_columns on public.profiles;
create trigger profiles_guard_protected_columns
  before update on public.profiles
  for each row
  execute function public.guard_profile_protected_columns();

-- player_state：客户端上下文一律不得写入。
create or replace function public.guard_player_state_writes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.is_client_context() then
    raise exception
      'player_state 是服务端权威数据，客户端不可直接写入'
      using errcode = '42501';
  end if;

  -- BEFORE DELETE 必须返回 old，否则删除会被静默取消。
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.guard_player_state_writes() is
  '兜底守卫：player_state 的任何客户端直写都会失败，写入必须经过游戏服务。';

drop trigger if exists player_state_guard_writes on public.player_state;
create trigger player_state_guard_writes
  before insert or update or delete on public.player_state
  for each row
  execute function public.guard_player_state_writes();
