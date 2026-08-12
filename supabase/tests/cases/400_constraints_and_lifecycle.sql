-- 用例 400：数据完整性与账号生命周期
--
-- 这一组以服务端/属主身份运行，验证的是"就算写入者可信，脏数据也进不来"，
-- 以及注册与注销这两条链路的自动化行为。

select tests.begin_suite('400_constraints_and_lifecycle');
select tests.act_as_owner();

-- ===========================================================================
-- profiles 约束
-- ===========================================================================
select tests.check_rejected('昵称过短被拒绝',
  'update public.profiles set display_name = ''A'' where id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_rejected('昵称过长被拒绝',
  'update public.profiles set display_name = repeat(''x'', 25) where id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_rejected('昵称首尾空白被拒绝',
  'update public.profiles set display_name = ''  Alice  '' where id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_rejected('昵称含控制字符被拒绝',
  'update public.profiles set display_name = ''Ali'' || chr(10) || ''ce'' where id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_rejected('未知语言代码被拒绝',
  'update public.profiles set locale = ''xx-YY'' where id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_rejected('头像 key 不接受外链',
  'update public.profiles set avatar_key = ''https://evil.example/a.png'' where id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_allowed('头像 key 允许置空',
  'update public.profiles set avatar_key = null where id = ''00000000-0000-4000-8000-00000000a001''');

-- 昵称大小写不敏感唯一。
select tests.check_rejected('昵称大小写不敏感唯一（alice 撞 Alice）',
  'update public.profiles set display_name = ''alice'' where id = ''00000000-0000-4000-8000-00000000a002''');

-- profiles 必须挂在真实账号上。
select tests.check_rejected('profiles 不能挂到不存在的 auth 用户',
  'insert into public.profiles (id, display_name) values (''00000000-0000-4000-8000-0000000000ff'', ''孤儿档'')');

-- ===========================================================================
-- player_state 约束
-- ===========================================================================
select tests.check_rejected('等级 0 被拒绝',
  'update public.player_state set level = 0 where user_id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_rejected('等级超上限被拒绝',
  'update public.player_state set level = 101 where user_id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_rejected('负经验被拒绝',
  'update public.player_state set experience = -1 where user_id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_rejected('血量超过上限被拒绝',
  'update public.player_state set hp = 200, max_hp = 100 where user_id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_rejected('负血量被拒绝',
  'update public.player_state set hp = -1 where user_id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_rejected('NaN 坐标被拒绝',
  'update public.player_state set pos_x = ''NaN''::double precision where user_id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_rejected('Infinity 坐标被拒绝',
  'update public.player_state set pos_y = ''Infinity''::double precision where user_id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_rejected('坐标越界被拒绝',
  'update public.player_state set pos_x = 1e9 where user_id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_rejected('未知朝向被拒绝',
  'update public.player_state set facing = ''up'' where user_id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_rejected('非法 map_id 被拒绝',
  'update public.player_state set map_id = ''Start Village!'' where user_id = ''00000000-0000-4000-8000-00000000a001''');

-- ===========================================================================
-- 触发器行为：updated_at 与 revision 由数据库掌控
-- ===========================================================================
do $$
declare
  v_before_updated timestamptz;
  v_after_updated  timestamptz;
  v_before_rev     bigint;
  v_after_rev      bigint;
begin
  select updated_at, revision into v_before_updated, v_before_rev
    from public.player_state where user_id = '00000000-0000-4000-8000-00000000a002';

  -- 故意把 updated_at 和 revision 写成假值，触发器必须覆盖掉。
  update public.player_state
     set level      = 5,
         updated_at = timestamptz '2000-01-01 00:00:00+00',
         revision   = 999999
   where user_id = '00000000-0000-4000-8000-00000000a002';

  select updated_at, revision into v_after_updated, v_after_rev
    from public.player_state where user_id = '00000000-0000-4000-8000-00000000a002';

  perform tests.check('updated_at 无法被调用方伪造',
    v_after_updated > timestamptz '2020-01-01 00:00:00+00',
    format('updated_at=%s', v_after_updated));
  perform tests.check('updated_at 在更新后前进',
    v_after_updated >= v_before_updated);
  perform tests.check('revision 无法被调用方指定',
    v_after_rev = v_before_rev + 1,
    format('%s -> %s（期望 +1）', v_before_rev, v_after_rev));
end;
$$;

-- ===========================================================================
-- 注册链路：插入 auth.users 自动建档
-- ===========================================================================
do $$
declare
  v_new_id   uuid := '00000000-0000-4000-8000-00000000b001';
  v_profiles bigint;
  v_states   bigint;
  v_name     text;
  v_map      text;
  v_level    integer;
begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (v_new_id, 'authenticated', 'authenticated', 'newbie@vastworld.local',
          jsonb_build_object('display_name', '新来的'), now(), now());

  select count(*) into v_profiles from public.profiles     where id = v_new_id;
  select count(*) into v_states   from public.player_state where user_id = v_new_id;
  select display_name into v_name from public.profiles     where id = v_new_id;
  select map_id, level into v_map, v_level from public.player_state where user_id = v_new_id;

  perform tests.check('注册后自动创建 profile', v_profiles = 1);
  perform tests.check('注册后自动创建 player_state', v_states = 1);
  perform tests.check('昵称取自注册元数据', v_name = '新来的', format('display_name=%s', v_name));
  perform tests.check('新角色落在默认出生点', v_map = 'start_village', format('map_id=%s', v_map));
  perform tests.check('新角色等级为 1', v_level = 1, format('level=%s', v_level));
end;
$$;

-- 昵称撞车时自动加后缀，而不是让注册失败。
do $$
declare
  v_new_id uuid := '00000000-0000-4000-8000-00000000b002';
  v_name   text;
begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (v_new_id, 'authenticated', 'authenticated', 'dup@vastworld.local',
          jsonb_build_object('display_name', 'Alice'), now(), now());

  select display_name into v_name from public.profiles where id = v_new_id;

  perform tests.check('昵称冲突时自动加后缀且注册不失败',
    v_name is not null and lower(v_name) <> 'alice',
    format('display_name=%s', v_name));
end;
$$;

-- 没有提供昵称时回落到 user id 派生名。
do $$
declare
  v_new_id uuid := '00000000-0000-4000-8000-00000000b003';
  v_name   text;
begin
  insert into auth.users (id, aud, role, email, created_at, updated_at)
  values (v_new_id, 'authenticated', 'authenticated', 'anon-name@vastworld.local', now(), now());

  select display_name into v_name from public.profiles where id = v_new_id;

  perform tests.check('缺少昵称元数据时自动生成合法昵称',
    v_name like 'player\_%' and char_length(v_name) between 2 and 24,
    format('display_name=%s', v_name));
end;
$$;

-- 只有空白/控制字符的昵称同样回落。
do $$
declare
  v_new_id uuid := '00000000-0000-4000-8000-00000000b004';
  v_name   text;
begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (v_new_id, 'authenticated', 'authenticated', 'blank-name@vastworld.local',
          jsonb_build_object('display_name', '   '), now(), now());

  select display_name into v_name from public.profiles where id = v_new_id;

  perform tests.check('空白昵称被清洗并回落到派生名',
    v_name like 'player\_%',
    format('display_name=%s', v_name));
end;
$$;

-- ===========================================================================
-- 注销链路：删除账号级联清理
-- ===========================================================================
do $$
declare
  v_id       uuid := '00000000-0000-4000-8000-00000000b001';
  v_profiles bigint;
  v_states   bigint;
begin
  delete from auth.users where id = v_id;

  select count(*) into v_profiles from public.profiles     where id = v_id;
  select count(*) into v_states   from public.player_state where user_id = v_id;

  perform tests.check('删除账号级联清理 profile', v_profiles = 0);
  perform tests.check('删除账号级联清理 player_state', v_states = 0);
end;
$$;
