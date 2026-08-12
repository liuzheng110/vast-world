-- VastWorld M0 · 迁移 3/3：新账号自动建档
--
-- 目标：auth.users 出现一行，就自动生成配套的 profiles 与 player_state，
--       让"注册成功但没有角色"的中间态不存在。
--
-- 为什么放在数据库而不是游戏服务：
--   注册由 Supabase Auth（GoTrue）直接完成，游戏服务不在这条链路上。
--   如果靠服务端补建档，第一次登录前的窗口期内数据是残缺的。
--
-- 这是 Supabase 官方文档推荐的 auth.users 触发器模式。
-- 函数用 security definer 执行，因此能绕过 profiles 的 RLS 完成建档。

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested text;
  v_base      text;
  v_candidate text;
  v_suffix    integer := 0;
begin
  -- 1. 清洗注册时带上来的昵称：去控制字符、去首尾空白、截断到 24 字符。
  --    注意截断后可能重新露出尾部空白，所以再 btrim 一次。
  v_requested := coalesce(new.raw_user_meta_data ->> 'display_name', '');
  v_requested := regexp_replace(v_requested, '[[:cntrl:]]', '', 'g');
  v_requested := btrim(v_requested);
  v_requested := btrim(substr(v_requested, 1, 24));

  -- 2. 不合法就退回到从 user id 派生的稳定昵称。
  --    取 12 位十六进制（48 bit）而不是 8 位：v4 UUID 前 8 位只有 32 bit，
  --    在几万量级账号上就会开始碰撞，导致大量昵称退化成 xxx_1、xxx_2。
  if char_length(v_requested) between 2 and 24 then
    v_base := v_requested;
  else
    v_base := 'player_' || substr(replace(new.id::text, '-', ''), 1, 12);
  end if;

  -- 3. 昵称大小写不敏感唯一，冲突时追加数字后缀。
  v_candidate := v_base;
  while exists (
    select 1 from public.profiles p
    where lower(p.display_name) = lower(v_candidate)
  ) loop
    v_suffix := v_suffix + 1;
    if v_suffix > 20 then
      -- 兜底：改用更长的 user id 派生名（16 位十六进制，总长 23 字符）。
      v_candidate := 'player_' || substr(replace(new.id::text, '-', ''), 1, 16);
      exit;
    end if;
    v_candidate := btrim(substr(v_base, 1, 24 - char_length(v_suffix::text) - 1))
                   || '_' || v_suffix::text;
  end loop;

  -- 4. 建档。并发注册可能让上面的检查失效，捕获唯一冲突后退回派生昵称。
  begin
    insert into public.profiles (id, display_name)
    values (new.id, v_candidate)
    on conflict (id) do nothing;
  exception when unique_violation then
    insert into public.profiles (id, display_name)
    values (new.id, 'player_' || substr(replace(new.id::text, '-', ''), 1, 16))
    on conflict (id) do nothing;
  end;

  -- 5. 角色检查点用默认出生点，坐标与数值全部由表默认值决定。
  insert into public.player_state (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  'auth.users 插入后自动创建 profiles 与 player_state，保证账号与角色一致。';

-- security definer 函数不对外暴露调用入口。
-- 触发器的执行权限在 create trigger 时校验，这里回收不影响触发。
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

-- 账号删除不需要额外触发器：
--   auth.users -> profiles -> player_state 都是 on delete cascade。
