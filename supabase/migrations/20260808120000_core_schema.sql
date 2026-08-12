-- VastWorld M0 · 迁移 1/3：核心 schema
--
-- 范围：profiles（用户可见资料）与 player_state（角色检查点）两张最小表，
--       以及它们的约束、索引和 updated_at 维护触发器。
-- 不在本迁移范围：背包、货币、任务、内容编辑系统（见 ROADMAP.md M2/M3）。
--
-- 幂等性：本文件可在同一个数据库上重复执行；也可从空库重新执行得到相同结果。
--         手段是 create ... if not exists / create or replace / drop trigger if exists。
--
-- 权限与 RLS 在迁移 20260808120100_rls_and_grants.sql 中统一设置，
-- 本文件只负责结构，避免"结构和授权互相埋伏"。

-- ---------------------------------------------------------------------------
-- 0. 公共辅助函数
-- ---------------------------------------------------------------------------

-- 判断当前会话是否来自"不可信客户端"。
-- PostgREST 会把请求角色切换为 anon / authenticated；游戏服务使用 service_role
-- 或直连角色。这里用**拒绝名单**而不是允许名单，新增的服务端角色默认可信，
-- 而浏览器侧角色永远受限。
create or replace function public.is_client_context()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- current_user 是 SQL 关键字而非普通函数，不受 search_path 影响，无法被劫持。
  select current_user::text in ('anon', 'authenticated')
$$;

comment on function public.is_client_context() is
  'true 表示当前语句由浏览器侧角色（anon/authenticated）发起，权威字段必须拒绝写入。';

-- 统一维护 updated_at，禁止客户端自行伪造时间。
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  '行更新时把 updated_at 强制刷成服务器时间。';

-- ---------------------------------------------------------------------------
-- 1. profiles：与 auth.users 一对一的用户资料
-- ---------------------------------------------------------------------------
-- id 直接复用 auth.users.id，不额外发号，保证 JWT 的 sub 可以直接当主键用。
-- is_banned 是权威字段，只允许服务端写（策略与列级授权在迁移 2 中约束）。

create table if not exists public.profiles (
  id uuid primary key
    references auth.users (id) on delete cascade,

  display_name text not null,
  avatar_key   text,
  locale       text not null default 'zh-CN',

  -- 权威字段：封禁状态由后台/服务端判定。
  is_banned    boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 昵称长度按"可显示在头顶"的预算控制。
  constraint profiles_display_name_length_ck
    check (char_length(display_name) between 2 and 24),
  -- 不允许首尾空白，避免出现视觉上重名的账号。
  constraint profiles_display_name_trimmed_ck
    check (display_name = btrim(display_name)),
  -- 不允许控制字符/换行，避免污染聊天与 HUD 渲染。
  constraint profiles_display_name_charset_ck
    check (display_name !~ '[[:cntrl:]]'),
  -- 头像引用打包素材的 key，不是任意 URL，避免变成外链注入面。
  constraint profiles_avatar_key_format_ck
    check (avatar_key is null or avatar_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint profiles_locale_allowed_ck
    check (locale in ('zh-CN', 'en-US')),
  constraint profiles_updated_after_created_ck
    check (updated_at >= created_at)
);

comment on table public.profiles is
  '用户可见资料，与 auth.users 一对一。用户可在 RLS 下读写自身的非权威字段。';
comment on column public.profiles.id is 'auth.users.id，删除账号时级联清理。';
comment on column public.profiles.display_name is '游戏内昵称，大小写不敏感唯一。';
comment on column public.profiles.avatar_key is '打包素材中的头像 key，不接受外部 URL。';
comment on column public.profiles.is_banned is '权威字段：仅服务端可写，被封禁用户不可修改自身资料。';

-- 昵称大小写不敏感唯一：Alice 与 alice 视为同一个。
create unique index if not exists profiles_display_name_lower_uidx
  on public.profiles (lower(display_name));

-- 后台按注册时间翻页。
create index if not exists profiles_created_at_idx
  on public.profiles (created_at desc);

-- 部分索引：封禁名单通常很小，单独建索引便于风控查询。
create index if not exists profiles_banned_idx
  on public.profiles (id)
  where is_banned;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. player_state：最小角色检查点
-- ---------------------------------------------------------------------------
-- 这是"安全点存档"，不是逐 tick 的热状态。房间内的实时坐标保存在内存中，
-- 只有进入/离开/检查点等事件才落库（ARCHITECTURE.md §6.2）。
-- 因此这里只放服务端重建一个角色所需的最小字段。

create table if not exists public.player_state (
  user_id uuid primary key
    references public.profiles (id) on delete cascade,

  -- 检查点所在地图与坐标（2.5D 权威模拟只有 x, y）。
  map_id text not null default 'start_village',
  pos_x  double precision not null default 0,
  pos_y  double precision not null default 0,
  facing text not null default 'south',

  -- 最小成长数值。
  level      integer not null default 1,
  experience bigint  not null default 0,
  hp         integer not null default 100,
  max_hp     integer not null default 100,

  -- 乐观并发版本号，由触发器自增，供服务端做 compare-and-set。
  revision bigint not null default 0,

  last_checkpoint_at timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint player_state_map_id_format_ck
    check (map_id ~ '^[a-z][a-z0-9_]{2,63}$'),
  -- 范围检查同时挡住 NaN / Infinity：两者都无法满足 between。
  constraint player_state_pos_x_range_ck
    check (pos_x between -1000000 and 1000000),
  constraint player_state_pos_y_range_ck
    check (pos_y between -1000000 and 1000000),
  constraint player_state_facing_allowed_ck
    check (facing in ('north', 'south', 'east', 'west')),
  constraint player_state_level_range_ck
    check (level between 1 and 100),
  constraint player_state_experience_nonnegative_ck
    check (experience >= 0),
  constraint player_state_max_hp_range_ck
    check (max_hp between 1 and 1000000),
  constraint player_state_hp_range_ck
    check (hp >= 0 and hp <= max_hp),
  constraint player_state_revision_nonnegative_ck
    check (revision >= 0),
  constraint player_state_updated_after_created_ck
    check (updated_at >= created_at)
);

comment on table public.player_state is
  '角色检查点存档。只有游戏服务可写；玩家最多只能读取自己的记录。';
comment on column public.player_state.revision is
  '乐观并发版本号，每次更新自增，用于服务端 compare-and-set，防止重复奖励/回档。';
comment on column public.player_state.last_checkpoint_at is
  '最近一次通过安全点写档的时间，与 updated_at 区分开（后者含任何字段变更）。';

-- 按地图统计在档角色（运营/容量评估）。
create index if not exists player_state_map_id_idx
  on public.player_state (map_id);

-- 最近活跃排序。
create index if not exists player_state_last_checkpoint_at_idx
  on public.player_state (last_checkpoint_at desc);

drop trigger if exists player_state_set_updated_at on public.player_state;
create trigger player_state_set_updated_at
  before update on public.player_state
  for each row
  execute function public.set_updated_at();

-- revision 由数据库自增，服务端无法忘记维护，也无法被客户端指定。
create or replace function public.bump_player_state_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;

comment on function public.bump_player_state_revision() is
  'player_state 每次更新时自增 revision，调用方无法覆盖。';

drop trigger if exists player_state_bump_revision on public.player_state;
create trigger player_state_bump_revision
  before update on public.player_state
  for each row
  execute function public.bump_player_state_revision();
