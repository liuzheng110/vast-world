-- VastWorld · 本地开发种子数据
--
-- ⚠ 仅用于本地开发与自动化测试（`supabase db reset`）。
--   - 不得在 staging / production 执行。
--   - 邮箱使用不可路由的 .local 域，不是任何真实账号。
--   - 这里出现的开发口令是公开的占位口令，不是密钥；线上账号一律由 Auth 自行创建。
--
-- 安全阀：如果 auth.users 里存在任何"非种子"账号，本文件会直接报错退出，
--         避免有人误把它指向一个真实数据库。
--
-- 幂等：可以重复执行。第二次运行不会重复建号，也不会再次改动已经正确的行
--       （因此 player_state.revision 不会被反复自增）。

do $$
declare
  v_seed_ids uuid[] := array[
    '00000000-0000-4000-8000-00000000a001'::uuid,
    '00000000-0000-4000-8000-00000000a002'::uuid,
    '00000000-0000-4000-8000-00000000a003'::uuid
  ];
  v_foreign_users   bigint;
  v_pgcrypto_schema text;
  v_password        text;
  v_profiles        bigint;
  v_states          bigint;
begin
  ---------------------------------------------------------------------------
  -- 0. 安全阀
  ---------------------------------------------------------------------------
  select count(*)
    into v_foreign_users
    from auth.users u
   where not (u.id = any (v_seed_ids));

  if v_foreign_users > 0 then
    raise exception
      'seed.sql 已中止：auth.users 中存在 % 个非种子账号，目标库不像干净的本地环境。',
      v_foreign_users
      using hint = '本文件只服务本地 supabase db reset；请勿对 staging/production 执行。';
  end if;

  ---------------------------------------------------------------------------
  -- 1. 开发口令
  ---------------------------------------------------------------------------
  -- pgcrypto 在 Supabase 位于 extensions schema，在裸 PostgreSQL 常在 public，
  -- 在 PGlite 等精简引擎里可能完全不存在。动态定位，缺失时退化为"无密码账号"，
  -- 这样纯数据/RLS 测试仍然可以跑。
  select n.nspname
    into v_pgcrypto_schema
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'gen_salt'
   limit 1;

  if v_pgcrypto_schema is not null then
    execute format('select %I.crypt($1, %I.gen_salt(%L))',
                   v_pgcrypto_schema, v_pgcrypto_schema, 'bf')
      into v_password
     using 'vastworld-local-dev';
  else
    raise notice 'seed.sql：未找到 pgcrypto，种子账号不设置口令（仅影响本地密码登录）。';
  end if;

  ---------------------------------------------------------------------------
  -- 2. 种子账号
  ---------------------------------------------------------------------------
  -- 插入 auth.users 会触发 public.handle_new_auth_user()，
  -- 自动生成 profiles 与 player_state。种子数据顺带验证了这条链路。
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  select
    '00000000-0000-0000-0000-000000000000'::uuid,
    d.id,
    'authenticated',
    'authenticated',
    d.email,
    v_password,
    now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('display_name', d.display_name),
    now(),
    now()
  from (values
    ('00000000-0000-4000-8000-00000000a001'::uuid, 'alice@vastworld.local',   'Alice'),
    ('00000000-0000-4000-8000-00000000a002'::uuid, 'bob@vastworld.local',     'Bob观星'),
    ('00000000-0000-4000-8000-00000000a003'::uuid, 'mallory@vastworld.local', 'Mallory')
  ) as d(id, email, display_name)
  on conflict (id) do nothing;

  ---------------------------------------------------------------------------
  -- 3. 邮箱身份记录（本地密码登录需要）
  ---------------------------------------------------------------------------
  -- auth.identities 的列在 GoTrue 各版本间有差异，按实际列结构分支写入；
  -- 表不存在时（例如 PGlite 测试壳）直接跳过。
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'auth' and table_name = 'identities'
  ) then
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'auth' and table_name = 'identities'
         and column_name = 'provider_id'
    ) then
      insert into auth.identities (
        id, user_id, provider_id, provider, identity_data,
        last_sign_in_at, created_at, updated_at
      )
      select
        gen_random_uuid(), u.id, u.id::text, 'email',
        jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
        now(), now(), now()
      from auth.users u
      where u.id = any (v_seed_ids)
        and not exists (
          select 1 from auth.identities i
           where i.user_id = u.id and i.provider = 'email'
        );
    else
      insert into auth.identities (
        id, user_id, provider, identity_data,
        last_sign_in_at, created_at, updated_at
      )
      select
        u.id::text, u.id, 'email',
        jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
        now(), now(), now()
      from auth.users u
      where u.id = any (v_seed_ids)
        and not exists (
          select 1 from auth.identities i
           where i.user_id = u.id and i.provider = 'email'
        );
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 4. 资料补齐
  ---------------------------------------------------------------------------
  -- Mallory 预置为封禁状态，用来验证"被封禁用户无法修改自身资料"。
  update public.profiles p
     set locale    = d.locale,
         avatar_key = d.avatar_key,
         is_banned = d.is_banned
    from (values
      ('00000000-0000-4000-8000-00000000a001'::uuid, 'zh-CN', 'avatar_scout',  false),
      ('00000000-0000-4000-8000-00000000a002'::uuid, 'en-US', 'avatar_ranger', false),
      ('00000000-0000-4000-8000-00000000a003'::uuid, 'zh-CN', null,            true)
    ) as d(id, locale, avatar_key, is_banned)
   where p.id = d.id
     and (p.locale, p.avatar_key, p.is_banned)
         is distinct from (d.locale, d.avatar_key, d.is_banned);

  ---------------------------------------------------------------------------
  -- 5. 角色检查点
  ---------------------------------------------------------------------------
  -- 给三个账号不同的地图与进度，便于本地肉眼区分。
  update public.player_state s
     set map_id     = d.map_id,
         pos_x      = d.pos_x,
         pos_y      = d.pos_y,
         facing     = d.facing,
         level      = d.level,
         experience = d.experience,
         hp         = d.hp,
         max_hp     = d.max_hp
    from (values
      ('00000000-0000-4000-8000-00000000a001'::uuid, 'start_village', 12.5,  -8.0,  'south', 3,  260::bigint, 92,  120),
      ('00000000-0000-4000-8000-00000000a002'::uuid, 'start_village', -40.0, 16.25, 'east',  1,  0::bigint,   100, 100),
      ('00000000-0000-4000-8000-00000000a003'::uuid, 'quarry_ruins',  128.0, 64.0,  'north', 7,  1840::bigint, 55, 160)
    ) as d(id, map_id, pos_x, pos_y, facing, level, experience, hp, max_hp)
   where s.user_id = d.id
     and (s.map_id, s.pos_x, s.pos_y, s.facing, s.level, s.experience, s.hp, s.max_hp)
         is distinct from (d.map_id, d.pos_x, d.pos_y, d.facing, d.level, d.experience, d.hp, d.max_hp);

  ---------------------------------------------------------------------------
  -- 6. 结果自检
  ---------------------------------------------------------------------------
  select count(*) into v_profiles from public.profiles     where id      = any (v_seed_ids);
  select count(*) into v_states   from public.player_state where user_id = any (v_seed_ids);

  if v_profiles <> array_length(v_seed_ids, 1) or v_states <> array_length(v_seed_ids, 1) then
    raise exception
      'seed.sql 自检失败：profiles=% player_state=%，期望各 % 行（建档触发器可能未生效）。',
      v_profiles, v_states, array_length(v_seed_ids, 1);
  end if;

  raise notice 'seed.sql 完成：% 个本地账号，profiles/player_state 均已就绪。',
    array_length(v_seed_ids, 1);
end;
$$;
