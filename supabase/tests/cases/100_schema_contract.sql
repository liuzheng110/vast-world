-- 用例 100：结构与授权契约
--
-- 这一组不切换角色，只读系统目录，用来锁住"结构本身"的承诺：
-- 表在、RLS 开、外键/唯一/检查约束在、索引在、各角色拿到的授权正好是设计值。
-- 目的是让后续任何一次迁移如果悄悄放宽权限，这里立刻变红。

select tests.begin_suite('100_schema_contract');
select tests.act_as_owner();

-- ---------------------------------------------------------------------------
-- 表与 RLS 开关
-- ---------------------------------------------------------------------------
do $$
declare
  v_profiles_rls     boolean;
  v_player_state_rls boolean;
begin
  select c.relrowsecurity into v_profiles_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'profiles';

  select c.relrowsecurity into v_player_state_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'player_state';

  perform tests.check('public.profiles 存在', v_profiles_rls is not null);
  perform tests.check('public.player_state 存在', v_player_state_rls is not null);
  perform tests.check('profiles 已启用 RLS', coalesce(v_profiles_rls, false));
  perform tests.check('player_state 已启用 RLS', coalesce(v_player_state_rls, false));
end;
$$;

-- public schema 下不应存在未启用 RLS 的业务表（防止以后新增表时漏开）。
do $$
declare
  v_leaky text;
begin
  select string_agg(c.relname, ', ')
    into v_leaky
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity;

  perform tests.check(
    'public schema 中不存在未启用 RLS 的表',
    v_leaky is null,
    coalesce('缺少 RLS 的表: ' || v_leaky, '全部已启用')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 外键：profiles -> auth.users，player_state -> profiles，均级联删除
-- ---------------------------------------------------------------------------
do $$
declare
  v_ok boolean;
begin
  select exists (
    select 1
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_class tgt on tgt.oid = con.confrelid
      join pg_namespace sn on sn.oid = src.relnamespace
      join pg_namespace tn on tn.oid = tgt.relnamespace
     where con.contype = 'f'
       and sn.nspname = 'public' and src.relname = 'profiles'
       and tn.nspname = 'auth'   and tgt.relname = 'users'
       and con.confdeltype = 'c'
  ) into v_ok;
  perform tests.check('profiles.id 外键指向 auth.users 且级联删除', v_ok);

  select exists (
    select 1
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_class tgt on tgt.oid = con.confrelid
      join pg_namespace sn on sn.oid = src.relnamespace
     where con.contype = 'f'
       and sn.nspname = 'public' and src.relname = 'player_state'
       and tgt.relname = 'profiles'
       and con.confdeltype = 'c'
  ) into v_ok;
  perform tests.check('player_state.user_id 外键指向 profiles 且级联删除', v_ok);
end;
$$;

-- ---------------------------------------------------------------------------
-- 检查约束与唯一索引
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg(expected.name, ', ')
    into v_missing
    from (values
      ('profiles_display_name_length_ck'),
      ('profiles_display_name_trimmed_ck'),
      ('profiles_display_name_charset_ck'),
      ('profiles_avatar_key_format_ck'),
      ('profiles_locale_allowed_ck'),
      ('player_state_map_id_format_ck'),
      ('player_state_pos_x_range_ck'),
      ('player_state_pos_y_range_ck'),
      ('player_state_facing_allowed_ck'),
      ('player_state_level_range_ck'),
      ('player_state_experience_nonnegative_ck'),
      ('player_state_max_hp_range_ck'),
      ('player_state_hp_range_ck'),
      ('player_state_revision_nonnegative_ck')
    ) as expected(name)
   where not exists (
     select 1 from pg_constraint con where con.conname = expected.name
   );

  perform tests.check(
    '全部预期检查约束都存在',
    v_missing is null,
    coalesce('缺失: ' || v_missing, '14 个检查约束齐全')
  );
end;
$$;

do $$
declare
  v_missing text;
begin
  select string_agg(expected.name, ', ')
    into v_missing
    from (values
      ('profiles_display_name_lower_uidx'),
      ('profiles_created_at_idx'),
      ('profiles_banned_idx'),
      ('player_state_map_id_idx'),
      ('player_state_last_checkpoint_at_idx')
    ) as expected(name)
   where not exists (
     select 1
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = expected.name and c.relkind = 'i'
   );

  perform tests.check(
    '全部预期索引都存在',
    v_missing is null,
    coalesce('缺失: ' || v_missing, '5 个索引齐全')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- updated_at / revision 触发器
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg(expected.name, ', ')
    into v_missing
    from (values
      ('profiles_set_updated_at'),
      ('profiles_guard_protected_columns'),
      ('player_state_set_updated_at'),
      ('player_state_bump_revision'),
      ('player_state_guard_writes')
    ) as expected(name)
   where not exists (
     select 1 from pg_trigger t where t.tgname = expected.name and not t.tgisinternal
   );

  perform tests.check(
    '全部预期触发器都存在',
    v_missing is null,
    coalesce('缺失: ' || v_missing, '5 个触发器齐全')
  );

  perform tests.check(
    'auth.users 建档触发器存在',
    exists (select 1 from pg_trigger t where t.tgname = 'on_auth_user_created' and not t.tgisinternal)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 授权矩阵：anon 零权限
-- ---------------------------------------------------------------------------
do $$
declare
  v_has_any boolean;
begin
  select bool_or(has_table_privilege('anon', t.tbl, p.priv))
    into v_has_any
    from (values ('public.profiles'), ('public.player_state')) as t(tbl),
         (values ('select'), ('insert'), ('update'), ('delete')) as p(priv);

  perform tests.check('anon 对业务表没有任何表级权限', not coalesce(v_has_any, false));
end;
$$;

-- ---------------------------------------------------------------------------
-- 授权矩阵：authenticated 只读 + profiles 三列可写
-- ---------------------------------------------------------------------------
do $$
begin
  perform tests.check('authenticated 可读 profiles',
    has_table_privilege('authenticated', 'public.profiles', 'select'));
  perform tests.check('authenticated 可读 player_state',
    has_table_privilege('authenticated', 'public.player_state', 'select'));

  perform tests.check('authenticated 不能插入 profiles',
    not has_table_privilege('authenticated', 'public.profiles', 'insert'));
  perform tests.check('authenticated 不能删除 profiles',
    not has_table_privilege('authenticated', 'public.profiles', 'delete'));

  perform tests.check('authenticated 不能插入 player_state',
    not has_table_privilege('authenticated', 'public.player_state', 'insert'));
  perform tests.check('authenticated 不能更新 player_state',
    not has_table_privilege('authenticated', 'public.player_state', 'update'));
  perform tests.check('authenticated 不能删除 player_state',
    not has_table_privilege('authenticated', 'public.player_state', 'delete'));

  -- 列级授权：只有这三列可改。
  perform tests.check('authenticated 可改 profiles.display_name',
    has_column_privilege('authenticated', 'public.profiles', 'display_name', 'update'));
  perform tests.check('authenticated 可改 profiles.avatar_key',
    has_column_privilege('authenticated', 'public.profiles', 'avatar_key', 'update'));
  perform tests.check('authenticated 可改 profiles.locale',
    has_column_privilege('authenticated', 'public.profiles', 'locale', 'update'));

  perform tests.check('authenticated 不能改 profiles.is_banned',
    not has_column_privilege('authenticated', 'public.profiles', 'is_banned', 'update'));
  perform tests.check('authenticated 不能改 profiles.id',
    not has_column_privilege('authenticated', 'public.profiles', 'id', 'update'));
  perform tests.check('authenticated 不能改 profiles.created_at',
    not has_column_privilege('authenticated', 'public.profiles', 'created_at', 'update'));
  perform tests.check('authenticated 不能改 profiles.updated_at',
    not has_column_privilege('authenticated', 'public.profiles', 'updated_at', 'update'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 授权矩阵：service_role 是权威写入者
-- ---------------------------------------------------------------------------
do $$
declare
  v_all boolean;
begin
  select bool_and(has_table_privilege('service_role', t.tbl, p.priv))
    into v_all
    from (values ('public.profiles'), ('public.player_state')) as t(tbl),
         (values ('select'), ('insert'), ('update'), ('delete')) as p(priv);

  perform tests.check('service_role 对业务表拥有完整读写权限', coalesce(v_all, false));
end;
$$;
