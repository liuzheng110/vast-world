-- 用例 300：player_state 的权威写入边界
--
-- 核心承诺：玩家最多只能读自己的检查点，任何直写都必须失败；
--           只有服务端能改写存档。

select tests.begin_suite('300_player_state_rls');

-- ===========================================================================
-- 匿名用户
-- ===========================================================================
select tests.act_as_anon();

select tests.check_denied('匿名用户不能读取 player_state',
  'select * from public.player_state');
select tests.check_denied('匿名用户不能写入 player_state',
  'update public.player_state set level = 99');

-- ===========================================================================
-- 已登录用户：只读自己
-- ===========================================================================
select tests.act_as('authenticated', '00000000-0000-4000-8000-00000000a001');

do $$
declare
  v_total bigint;
  v_other bigint;
  v_level integer;
begin
  select count(*) into v_total from public.player_state;
  select count(*) into v_other from public.player_state
   where user_id = '00000000-0000-4000-8000-00000000a002';
  select level into v_level from public.player_state
   where user_id = '00000000-0000-4000-8000-00000000a001';

  perform tests.check('本人查询 player_state 只返回 1 行', v_total = 1, format('实际 %s 行', v_total));
  perform tests.check('本人读不到他人的检查点', v_other = 0, format('实际 %s 行', v_other));
  perform tests.check('读到 seed 中 Alice 的等级 3', v_level = 3, format('level=%s', v_level));
end;
$$;

-- ===========================================================================
-- 已登录用户：一切写入都被拒绝（表级授权拦截，连语句都跑不起来）
-- ===========================================================================
select tests.check_denied('玩家不能刷等级',
  'update public.player_state set level = 99 where user_id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_denied('玩家不能瞬移到任意坐标',
  'update public.player_state set pos_x = 999, pos_y = 999 where user_id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_denied('玩家不能自己回血',
  'update public.player_state set hp = 100 where user_id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_denied('玩家不能插入检查点',
  'insert into public.player_state (user_id) values (''00000000-0000-4000-8000-00000000a002'')');
select tests.check_denied('玩家不能删除检查点',
  'delete from public.player_state where user_id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_denied('玩家不能篡改乐观锁版本号',
  'update public.player_state set revision = 0 where user_id = ''00000000-0000-4000-8000-00000000a001''');

-- ===========================================================================
-- 纵深防御：即使有人误开了授权和策略，守卫触发器仍然兜底
-- ===========================================================================
-- 这段临时放宽权限，验证第三层防御真的存在。整个用例文件运行在事务里，
-- 结束时回滚，不会留下痕迹。
select tests.act_as_owner();
grant insert, update, delete on public.player_state to authenticated;
create policy tmp_client_write_for_test
  on public.player_state
  for all
  to authenticated
  using (true)
  with check (true);

select tests.act_as('authenticated', '00000000-0000-4000-8000-00000000a001');

select tests.check_denied('授权与策略都放宽后，守卫触发器仍拒绝玩家写入',
  'update public.player_state set level = 99 where user_id = ''00000000-0000-4000-8000-00000000a001''');
select tests.check_denied('授权与策略都放宽后，守卫触发器仍拒绝玩家插入',
  'insert into public.player_state (user_id) values (''00000000-0000-4000-8000-00000000a002'')');
select tests.check_denied('授权与策略都放宽后，守卫触发器仍拒绝玩家删除',
  'delete from public.player_state where user_id = ''00000000-0000-4000-8000-00000000a001''');

-- 复原（事务回滚也会复原，这里显式写出来是为了让用例意图清晰）。
select tests.act_as_owner();
drop policy if exists tmp_client_write_for_test on public.player_state;
revoke insert, update, delete on public.player_state from authenticated;

-- ===========================================================================
-- 服务端：可以读写全部检查点
-- ===========================================================================
select tests.act_as_service();

do $$
declare
  v_total bigint;
begin
  select count(*) into v_total from public.player_state;
  perform tests.check('服务端能读到全部检查点', v_total = 3, format('实际 %s 行', v_total));
end;
$$;

select tests.check_allowed('服务端可以写入检查点',
  'update public.player_state
      set pos_x = 24.5, pos_y = -3.25, hp = 77, last_checkpoint_at = now()
    where user_id = ''00000000-0000-4000-8000-00000000a001''');

do $$
declare
  v_x        double precision;
  v_hp       integer;
  v_revision bigint;
begin
  select pos_x, hp, revision into v_x, v_hp, v_revision
    from public.player_state
   where user_id = '00000000-0000-4000-8000-00000000a001';

  perform tests.check('服务端写入的坐标生效', v_x = 24.5, format('pos_x=%s', v_x));
  perform tests.check('服务端写入的血量生效', v_hp = 77, format('hp=%s', v_hp));
  perform tests.check('写入后 revision 自增', v_revision >= 1, format('revision=%s', v_revision));
end;
$$;

select tests.check_allowed('服务端可以为新角色建档',
  'insert into public.player_state (user_id) values (''00000000-0000-4000-8000-00000000a002'')
     on conflict (user_id) do nothing');
