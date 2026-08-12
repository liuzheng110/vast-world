-- 用例 200：profiles 的四类权限边界
--
-- 覆盖：匿名用户 / 本人 / 其他用户 / 服务端。
-- 依赖 seed.sql 建立的三个本地账号：
--   Alice   ...a001  正常
--   Bob     ...a002  正常（用来验证"读不到别人"）
--   Mallory ...a003  已封禁

select tests.begin_suite('200_profiles_rls');

-- ===========================================================================
-- 匿名用户（未登录浏览器）
-- ===========================================================================
select tests.act_as_anon();

select tests.check_denied('匿名用户不能读取 profiles',
  'select * from public.profiles');
select tests.check_denied('匿名用户不能修改 profiles',
  'update public.profiles set display_name = ''hacked''');
select tests.check_denied('匿名用户不能插入 profiles',
  'insert into public.profiles (id, display_name) values (gen_random_uuid(), ''ghost'')');
select tests.check_denied('匿名用户不能删除 profiles',
  'delete from public.profiles');

-- ===========================================================================
-- 已登录用户：只能看到自己
-- ===========================================================================
select tests.act_as('authenticated', '00000000-0000-4000-8000-00000000a001');

do $$
declare
  v_total   bigint;
  v_self    bigint;
  v_other   bigint;
  v_name    text;
begin
  select count(*) into v_total from public.profiles;
  select count(*) into v_self  from public.profiles
   where id = '00000000-0000-4000-8000-00000000a001';
  select count(*) into v_other from public.profiles
   where id = '00000000-0000-4000-8000-00000000a002';
  select display_name into v_name from public.profiles
   where id = '00000000-0000-4000-8000-00000000a001';

  perform tests.check('本人查询 profiles 只返回 1 行', v_total = 1, format('实际 %s 行', v_total));
  perform tests.check('本人能读到自己的 profile', v_self = 1);
  perform tests.check('本人读不到其他用户的 profile', v_other = 0, format('实际 %s 行', v_other));
  perform tests.check('读到的是 seed 中的 Alice', v_name = 'Alice', format('display_name=%s', v_name));
end;
$$;

-- ===========================================================================
-- 已登录用户：允许修改的字段
-- ===========================================================================
select tests.check_allowed('本人可以修改自己的昵称',
  'update public.profiles set display_name = ''Alice新名'' where id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_allowed('本人可以修改自己的语言偏好',
  'update public.profiles set locale = ''en-US'' where id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_allowed('本人可以修改自己的头像 key',
  'update public.profiles set avatar_key = ''avatar_ranger'' where id = ''00000000-0000-4000-8000-00000000a001''');

do $$
declare
  v_name text;
begin
  select display_name into v_name from public.profiles
   where id = '00000000-0000-4000-8000-00000000a001';
  perform tests.check('昵称修改真的落库', v_name = 'Alice新名', format('display_name=%s', v_name));
end;
$$;

-- ===========================================================================
-- 已登录用户：禁止修改的权威字段（列级授权拦截）
-- ===========================================================================
select tests.check_denied('本人不能修改 is_banned',
  'update public.profiles set is_banned = false where id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_denied('本人不能修改 id',
  'update public.profiles set id = gen_random_uuid() where id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_denied('本人不能修改 created_at',
  'update public.profiles set created_at = now() where id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_denied('本人不能伪造 updated_at',
  'update public.profiles set updated_at = now() where id = ''00000000-0000-4000-8000-00000000a001''');

-- ===========================================================================
-- 已登录用户：不能建号 / 不能销号
-- ===========================================================================
select tests.check_denied('本人不能插入新的 profile',
  'insert into public.profiles (id, display_name) values (gen_random_uuid(), ''smurf'')');
select tests.check_denied('本人不能删除 profile',
  'delete from public.profiles where id = ''00000000-0000-4000-8000-00000000a001''');

-- ===========================================================================
-- 其他用户：写别人的行是"静默 0 行"，必须显式断言
-- ===========================================================================
select tests.check_rowcount('修改他人昵称影响 0 行',
  'update public.profiles set display_name = ''被顶号'' where id = ''00000000-0000-4000-8000-00000000a002''', 0);

-- 不带 where 的批量更新同样只会命中自己那一行。
select tests.check_rowcount('无条件批量更新只命中自己 1 行',
  'update public.profiles set locale = ''zh-CN''', 1);

-- ===========================================================================
-- 被封禁用户：可读不可写
-- ===========================================================================
select tests.act_as('authenticated', '00000000-0000-4000-8000-00000000a003');

do $$
declare
  v_self bigint;
begin
  select count(*) into v_self from public.profiles
   where id = '00000000-0000-4000-8000-00000000a003';
  perform tests.check('被封禁用户仍能读到自己的 profile', v_self = 1);
end;
$$;

select tests.check_rowcount('被封禁用户修改自身资料影响 0 行',
  'update public.profiles set display_name = ''解封尝试'' where id = ''00000000-0000-4000-8000-00000000a003''', 0);

-- ===========================================================================
-- 服务端：权威写入者
-- ===========================================================================
select tests.act_as_service();

do $$
declare
  v_total bigint;
begin
  select count(*) into v_total from public.profiles;
  perform tests.check('服务端能读到全部 profiles', v_total = 3, format('实际 %s 行', v_total));
end;
$$;

select tests.check_allowed('服务端可以封禁用户',
  'update public.profiles set is_banned = true where id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_allowed('服务端可以解封用户',
  'update public.profiles set is_banned = false where id = ''00000000-0000-4000-8000-00000000a003''');

do $$
declare
  v_banned boolean;
begin
  select is_banned into v_banned from public.profiles
   where id = '00000000-0000-4000-8000-00000000a001';
  perform tests.check('服务端的封禁写入生效', v_banned is true);
end;
$$;
