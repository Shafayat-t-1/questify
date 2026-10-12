-- ============================================================================
-- Questify · Web3 & Micro-Task Reward Platform
-- PostgreSQL / Supabase schema, indexes, RLS policies and reward functions.
--
-- Run in the Supabase SQL editor (or `supabase db push`) before starting the
-- Next.js app. Safe to re-run: objects are created idempotently.
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ----------------------------------------------------------------------------
-- PROFILES
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key default gen_random_uuid(),
  telegram_id    bigint unique not null,
  username       citext,
  first_name     text,
  last_name      text,
  photo_url      text,
  language_code  text,
  coins          bigint      not null default 0 check (coins >= 0),
  usdt_balance   numeric(18,6) not null default 0 check (usdt_balance >= 0),
  trust_score    integer     not null default 50 check (trust_score between 0 and 100),
  level          integer     not null default 1 check (level >= 1),
  referral_code  text unique not null default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  referred_by    uuid references public.profiles (id) on delete set null,
  referral_count integer     not null default 0,
  is_premium     boolean     not null default false,
  is_banned      boolean     not null default false,
  is_admin       boolean     not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_profiles_telegram_id on public.profiles (telegram_id);
create index if not exists idx_profiles_usdt        on public.profiles (usdt_balance desc);
create index if not exists idx_profiles_referral    on public.profiles (referred_by);
create index if not exists idx_profiles_refcode     on public.profiles (referral_code);

-- ----------------------------------------------------------------------------
-- WALLETS
-- ----------------------------------------------------------------------------
create table if not exists public.wallets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references public.profiles (id) on delete cascade,
  usdt_bep20   text,
  ton_address  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_wallets_user on public.wallets (user_id);

-- ----------------------------------------------------------------------------
-- TASKS
-- ----------------------------------------------------------------------------
create table if not exists public.tasks (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text,
  platform         text not null check (platform in ('telegram','x','tiktok','youtube','github','reddit','discord')),
  action_label     text not null default 'START',
  action_url       text not null,
  reward_coins     integer not null default 0 check (reward_coins >= 0),
  reward_usdt      numeric(18,6) not null default 0 check (reward_usdt >= 0),
  difficulty       text not null default 'easy' check (difficulty in ('easy','medium','hard')),
  duration_seconds integer not null default 15 check (duration_seconds >= 0),
  max_completions  integer not null default 1000000,
  completions      integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create index if not exists idx_tasks_active_platform on public.tasks (is_active, platform, created_at desc);

-- ----------------------------------------------------------------------------
-- USER_TASKS
-- ----------------------------------------------------------------------------
create table if not exists public.user_tasks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  task_id       uuid not null references public.tasks (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','verifying','completed','rejected')),
  reward_coins  integer not null default 0,
  reward_usdt   numeric(18,6) not null default 0,
  submitted_at  timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (user_id, task_id)
);

create index if not exists idx_user_tasks_user   on public.user_tasks (user_id, status);
create index if not exists idx_user_tasks_task   on public.user_tasks (task_id);

-- ----------------------------------------------------------------------------
-- DAILY_CHECKINS
-- ----------------------------------------------------------------------------
create table if not exists public.daily_checkins (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  day_index     integer not null check (day_index between 1 and 7),
  reward_coins  integer not null default 0,
  streak_date   date not null default current_date,
  checked_in_at timestamptz not null default now(),
  unique (user_id, streak_date)
);

create index if not exists idx_checkins_user on public.daily_checkins (user_id, checked_in_at desc);

-- ----------------------------------------------------------------------------
-- WITHDRAWALS
-- ----------------------------------------------------------------------------
create table if not exists public.withdrawals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  amount_usdt numeric(18,6) not null check (amount_usdt > 0),
  network     text not null check (network in ('BEP20','TON')),
  address     text not null,
  status      text not null default 'pending' check (status in ('pending','processing','paid','rejected')),
  tx_hash     text,
  created_at  timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_withdrawals_user   on public.withdrawals (user_id, created_at desc);
create index if not exists idx_withdrawals_status on public.withdrawals (status, created_at desc);

-- ----------------------------------------------------------------------------
-- REFERRALS
-- ----------------------------------------------------------------------------
create table if not exists public.referrals (
  id            uuid primary key default gen_random_uuid(),
  referrer_id   uuid not null references public.profiles (id) on delete cascade,
  referred_id   uuid not null unique references public.profiles (id) on delete cascade,
  reward_coins  integer not null default 0,
  reward_usdt   numeric(18,6) not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists idx_referrals_referrer on public.referrals (referrer_id, created_at desc);

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_wallets_touch on public.wallets;
create trigger trg_wallets_touch before update on public.wallets
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- new profile => wallet bootstrap
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.wallets (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_profiles_wallet on public.profiles;
create trigger trg_profiles_wallet after insert on public.profiles
  for each row execute function public.handle_new_profile();

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.wallets        enable row level security;
alter table public.tasks          enable row level security;
alter table public.user_tasks     enable row level security;
alter table public.daily_checkins enable row level security;
alter table public.withdrawals    enable row level security;
alter table public.referrals      enable row level security;

-- profiles: self read only. The public leaderboard is served by the
-- `public_profiles` view below, which projects only non-sensitive columns and
-- never leaks telegram_id / is_admin / language / ban state.
drop policy if exists profiles_read   on public.profiles;
create policy profiles_read on public.profiles for select using (auth.uid() = id);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- Harden profiles against privilege escalation / balance minting.
--
-- The `profiles_update` policy above only scopes rows to the caller; by itself it
-- would let a client PATCH its own row and set is_admin / coins / usdt_balance.
-- Protection is therefore layered:
--   1. Revoke blanket writes from the client roles and grant column-level UPDATE
--      only on the self-service (non-sensitive) columns.
--   2. A BEFORE UPDATE guard trigger rejects any change to a protected column by
--      a client role. The trigger is deliberately NOT SECURITY DEFINER so
--      `current_user` reflects the effective session role (anon/authenticated for
--      PostgREST clients; the function owner, e.g. postgres, for SECURITY DEFINER
--      reward/admin RPCs and the service role).
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (username, first_name, last_name, photo_url, language_code)
  on public.profiles to authenticated;

create or replace function public.guard_profiles_protected_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.id             is distinct from old.id
       or new.telegram_id  is distinct from old.telegram_id
       or new.is_admin     is distinct from old.is_admin
       or new.is_banned    is distinct from old.is_banned
       or new.is_premium   is distinct from old.is_premium
       or new.coins        is distinct from old.coins
       or new.usdt_balance is distinct from old.usdt_balance
       or new.trust_score  is distinct from old.trust_score
       or new.level        is distinct from old.level
       or new.referral_code is distinct from old.referral_code
       or new.referred_by  is distinct from old.referred_by
       or new.referral_count is distinct from old.referral_count
    then
      raise exception 'profiles: protected columns cannot be modified by clients'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard before update on public.profiles
  for each row execute function public.guard_profiles_protected_columns();

-- Public, column-limited leaderboard projection. Runs as the view owner so it
-- bypasses RLS on the base table while exposing only safe columns.
drop view if exists public.public_profiles;
create view public.public_profiles as
  select id, username, photo_url, level, usdt_balance, referral_count
  from public.profiles
  where is_banned = false;
grant select on public.public_profiles to anon, authenticated;

-- wallets: owner only
drop policy if exists wallets_rw on public.wallets;
create policy wallets_rw on public.wallets for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- tasks: readable when active
drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select using (is_active or auth.uid() is not null);

-- user_tasks: owner read only (writes via SECURITY DEFINER RPC)
drop policy if exists user_tasks_read on public.user_tasks;
create policy user_tasks_read on public.user_tasks for select using (auth.uid() = user_id);

-- checkins: owner read
drop policy if exists checkins_read on public.daily_checkins;
create policy checkins_read on public.daily_checkins for select using (auth.uid() = user_id);

-- withdrawals: owner read
drop policy if exists withdrawals_read on public.withdrawals;
create policy withdrawals_read on public.withdrawals for select using (auth.uid() = user_id);

-- referrals: participant read
drop policy if exists referrals_read on public.referrals;
create policy referrals_read on public.referrals for select
  using (auth.uid() = referrer_id or auth.uid() = referred_id);

-- ----------------------------------------------------------------------------
-- REWARD ENGINE (authoritative, server-side math)
-- ----------------------------------------------------------------------------

-- claim_task: idempotent completion of a task and credit of rewards.
-- Invoked only by the service role (through the Next.js API layer); the acting
-- user id is passed explicitly because auth.uid() is null for the service key.
drop function if exists public.claim_task(uuid);
create or replace function public.claim_task(p_task_id uuid, p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := coalesce(p_user, auth.uid());
  v_task     public.tasks;
  v_existing public.user_tasks;
  v_ref      uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select * into v_task from public.tasks where id = p_task_id and is_active = true;
  if not found then raise exception 'task not found or inactive' using errcode = 'P0002'; end if;

  select * into v_existing from public.user_tasks where user_id = v_uid and task_id = p_task_id;
  if found and v_existing.status = 'completed' then
    raise exception 'task already completed' using errcode = '23505';
  end if;

  insert into public.user_tasks (user_id, task_id, status, reward_coins, reward_usdt, submitted_at, completed_at)
  values (v_uid, p_task_id, 'completed', v_task.reward_coins, v_task.reward_usdt, now(), now())
  on conflict (user_id, task_id) do update
    set status = 'completed', reward_coins = excluded.reward_coins,
        reward_usdt = excluded.reward_usdt, submitted_at = now(), completed_at = now();

  update public.tasks set completions = completions + 1 where id = p_task_id;

  update public.profiles
     set coins = coins + v_task.reward_coins,
         usdt_balance = usdt_balance + v_task.reward_usdt,
         trust_score = least(100, trust_score + 1),
         level = greatest(1, floor((coins + v_task.reward_coins) / 1000) + 1)
   where id = v_uid
   returning referred_by into v_ref;

  -- 10% referral commission (coins) to referrer
  if v_ref is not null then
    update public.profiles
       set coins = coins + floor(v_task.reward_coins * 0.1),
           usdt_balance = usdt_balance + (v_task.reward_usdt * 0.1)
     where id = v_ref;
  end if;

  return jsonb_build_object(
    'coins', v_task.reward_coins,
    'usdt', v_task.reward_usdt,
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid)
  );
end;
$$;

-- claim_daily_checkin: advancing 7-day streak with multiplier.
drop function if exists public.claim_daily_checkin();
create or replace function public.claim_daily_checkin(p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := coalesce(p_user, auth.uid());
  v_last_date  date;
  v_next_day   integer := 1;
  v_rewards    integer[] := array[100,150,220,320,450,600,1000];
  v_reward     integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select max(streak_date) into v_last_date from public.daily_checkins where user_id = v_uid;

  if v_last_date = current_date then
    raise exception 'already checked in today' using errcode = '23505';
  end if;

  if v_last_date = current_date - 1 then
    select coalesce(max(day_index), 0) + 1 into v_next_day
      from public.daily_checkins where user_id = v_uid;
    if v_next_day > 7 then v_next_day := 1; end if;
  end if;

  v_reward := v_rewards[v_next_day];

  insert into public.daily_checkins (user_id, day_index, reward_coins)
  values (v_uid, v_next_day, v_reward)
  on conflict (user_id, streak_date) do nothing;

  update public.profiles
     set coins = coins + v_reward,
         trust_score = least(100, trust_score + 2),
         level = greatest(1, floor((coins + v_reward) / 1000) + 1)
   where id = v_uid;

  return jsonb_build_object(
    'coins', v_reward,
    'usdt', 0,
    'day', v_next_day,
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid)
  );
end;
$$;

-- request_withdrawal: validates balance + trust, debits and queues payout.
drop function if exists public.request_withdrawal(numeric, text, text);
create or replace function public.request_withdrawal(
  p_amount numeric,
  p_network text,
  p_address text,
  p_user uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := coalesce(p_user, auth.uid());
  v_prof  public.profiles;
  v_row   public.withdrawals;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'minimum withdrawal is 1 USDT' using errcode = 'P0001';
  end if;
  if p_network not in ('BEP20','TON') then
    raise exception 'unsupported network' using errcode = 'P0001';
  end if;
  if p_address is null or length(trim(p_address)) < 10 then
    raise exception 'invalid wallet address' using errcode = 'P0001';
  end if;

  select * into v_prof from public.profiles where id = v_uid for update;
  if not found then raise exception 'profile not found' using errcode = 'P0002'; end if;
  if v_prof.is_banned then raise exception 'account suspended' using errcode = '42501'; end if;
  if v_prof.trust_score < 30 then raise exception 'trust score too low' using errcode = '42501'; end if;
  if v_prof.usdt_balance < p_amount then
    raise exception 'insufficient balance' using errcode = 'P0001';
  end if;

  update public.profiles set usdt_balance = usdt_balance - p_amount where id = v_uid;

  insert into public.withdrawals (user_id, amount_usdt, network, address, status)
  values (v_uid, p_amount, p_network, trim(p_address), 'pending')
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- apply_referral: link a new profile to a referrer by code (one time).
drop function if exists public.apply_referral(text);
create or replace function public.apply_referral(p_code text, p_user uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := coalesce(p_user, auth.uid());
  v_ref uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select id into v_ref from public.profiles where referral_code = upper(p_code) and id <> v_uid;
  if v_ref is null then return false; end if;

  if exists (select 1 from public.referrals where referred_id = v_uid) then return false; end if;

  update public.profiles set referred_by = v_ref where id = v_uid and referred_by is null;
  insert into public.referrals (referrer_id, referred_id, reward_coins, reward_usdt)
  values (v_ref, v_uid, 150, 0.03)
  on conflict (referred_id) do nothing;
  update public.profiles set referral_count = referral_count + 1 where id = v_ref;
  return true;
end;
$$;

-- ----------------------------------------------------------------------------
-- grant execute on the RPC surface
-- ----------------------------------------------------------------------------
-- The reward RPCs trust the `p_user` argument, so they must NOT be reachable by
-- anon/authenticated clients. Lock them to the service role; the Next.js API
-- layer authenticates the Telegram session and passes the verified user id.
revoke all on function public.claim_task(uuid, uuid)                        from public;
revoke all on function public.claim_daily_checkin(uuid)                    from public;
revoke all on function public.request_withdrawal(numeric, text, text, uuid) from public;
revoke all on function public.apply_referral(text, uuid)                   from public;

grant execute on function public.claim_task(uuid, uuid)                        to service_role;
grant execute on function public.claim_daily_checkin(uuid)                    to service_role;
grant execute on function public.request_withdrawal(numeric, text, text, uuid) to service_role;
grant execute on function public.apply_referral(text, uuid)                   to service_role;

-- ----------------------------------------------------------------------------
-- SEED TASKS (idempotent by title)
-- ----------------------------------------------------------------------------
insert into public.tasks (title, description, platform, action_label, action_url, reward_coins, reward_usdt, difficulty, duration_seconds)
select v.title, v.description, v.platform, v.action_label, v.action_url, v.reward_coins, v.reward_usdt, v.difficulty, v.duration_seconds
from (values
  ('Join the Questify Announcement Channel','Stay on top of prize pools, airdrops and new task batches.','telegram','JOIN','https://t.me/questify',250,0.05,'easy',15),
  ('Follow @Questify on X (Twitter)','Follow the official account to unlock the campaign feed.','x','FOLLOW','https://x.com/questify',400,0.08,'easy',20),
  ('Subscribe to Questify TV','Subscribe and turn on notifications for weekly alpha drops.','youtube','SUBSCRIBE','https://youtube.com/@questify',600,0.12,'medium',30),
  ('Star the Questify SDK on GitHub','Star our open-source rewards SDK and get instant credit.','github','STAR','https://github.com/questify',750,0.15,'medium',25),
  ('Follow Questify on TikTok','Follow for task walkthroughs and reward proof-of-payouts.','tiktok','FOLLOW','https://tiktok.com/@questify',350,0.07,'easy',20),
  ('Join r/Questify on Reddit','Join the community and upvote the latest announcement.','reddit','JOIN','https://reddit.com/r/questify',300,0.06,'easy',18),
  ('Repost the $200 USDT Prize Pool Post','Repost and quote-tweet the pinned campaign announcement.','x','REPOST','https://x.com/questify',500,0.10,'medium',25),
  ('Boost the Questify Community','Boost the group to unlock server perks for everyone.','telegram','BOOST','https://t.me/questify',1200,0.25,'hard',45),
  ('Fork the Questify starter repo','Fork the repo, deploy it, and screenshot your build.','github','FORK','https://github.com/questify/starter',1500,0.32,'hard',60),
  ('Watch ''How to Earn Daily on Questify''','Watch the full 3-minute walkthrough to claim the bonus.','youtube','WATCH','https://youtube.com/watch?v=questify-guide',450,0.09,'easy',180),
  ('Join the Questify Discord','Join the discord and introduce yourself in #general.','discord','JOIN','https://discord.gg/questify',350,0.07,'easy',25),
  ('Duet the Questify payout reel','Post a duet showcasing your daily Questify earnings.','tiktok','DUET','https://tiktok.com/@questify/video/payout',900,0.20,'hard',90)
) as v(title,description,platform,action_label,action_url,reward_coins,reward_usdt,difficulty,duration_seconds)
where not exists (select 1 from public.tasks t where t.title = v.title);

-- ----------------------------------------------------------------------------
-- IDEMPOTENT MIGRATIONS
-- `create table if not exists` does NOT add new columns to tables that already
-- exist, so explicitly add columns introduced after the initial schema. Safe to
-- re-run against a live database that predates admin/verification support.
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists is_admin          boolean      not null default false;
alter table public.tasks    add column if not exists verification_type text;
alter table public.tasks    add column if not exists verification_target text;
alter table public.tasks    add column if not exists verification_rules  jsonb        default '{}'::jsonb;
alter table public.tasks    add column if not exists updated_at          timestamptz  not null default now();

-- ----------------------------------------------------------------------------
-- ADMIN UTILITIES
-- ----------------------------------------------------------------------------

-- Check if a user is admin (by profile id)
create or replace function public.is_admin_user(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_admin boolean;
begin
  select is_admin into v_admin from public.profiles where id = p_user;
  return coalesce(v_admin, false);
end;
$$;

revoke all on function public.is_admin_user(uuid) from public;
grant execute on function public.is_admin_user(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- ADMIN AUDIT LOGS
-- ----------------------------------------------------------------------------
create table if not exists public.admin_actions (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid references public.profiles (id) on delete set null,
  action       text not null,
  target_type  text not null,
  target_id    text not null,
  details      jsonb,
  ip_address   text,
  user_agent   text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_admin_actions_admin   on public.admin_actions (admin_id, created_at desc);
create index if not exists idx_admin_actions_target  on public.admin_actions (target_type, target_id, created_at desc);

alter table public.admin_actions enable row level security;

drop policy if exists admin_actions_read on public.admin_actions;
create policy admin_actions_read on public.admin_actions for select
  using (false); -- only via service role/admin functions

-- Extend tasks with verification configuration
alter table public.tasks add column if not exists verification_type text;
alter table public.tasks add column if not exists verification_target text;
alter table public.tasks add column if not exists verification_rules jsonb default '{}'::jsonb;
alter table public.tasks add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_tasks_updated_at on public.tasks;
create trigger trg_tasks_updated_at
  before update on public.tasks
  for each row execute procedure public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- ADMIN FUNCTIONS
-- ----------------------------------------------------------------------------

-- Admin: create/update task
create or replace function public.admin_upsert_task(
  p_admin uuid,
  p_task_id uuid default null,
  p_title text default null,
  p_description text default null,
  p_platform text default null,
  p_action_label text default null,
  p_action_url text default null,
  p_reward_coins integer default null,
  p_reward_usdt numeric(18,6) default null,
  p_difficulty text default null,
  p_duration_seconds integer default null,
  p_is_active boolean default null,
  p_verification_type text default null,
  p_verification_target text default null,
  p_verification_rules jsonb default null,
  p_max_completions integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_ok boolean;
  v_task public.tasks;
  v_id uuid;
begin
  v_admin_ok := public.is_admin_user(p_admin);
  if not v_admin_ok then raise exception 'not authorized' using errcode = '42501'; end if;

  if p_task_id is null then
    insert into public.tasks (
      title, description, platform, action_label, action_url,
      reward_coins, reward_usdt, difficulty, duration_seconds, is_active,
      verification_type, verification_target, verification_rules, max_completions
    ) values (
      p_title, p_description, p_platform, p_action_label, p_action_url,
      p_reward_coins, p_reward_usdt, p_difficulty, p_duration_seconds,
      coalesce(p_is_active, true),
      p_verification_type, p_verification_target, coalesce(p_verification_rules, '{}'::jsonb),
      p_max_completions
    ) returning * into v_task;
    v_id := v_task.id;
  else
    update public.tasks set
      title = coalesce(p_title, title),
      description = coalesce(p_description, description),
      platform = coalesce(p_platform, platform),
      action_label = coalesce(p_action_label, action_label),
      action_url = coalesce(p_action_url, action_url),
      reward_coins = coalesce(p_reward_coins, reward_coins),
      reward_usdt = coalesce(p_reward_usdt, reward_usdt),
      difficulty = coalesce(p_difficulty, difficulty),
      duration_seconds = coalesce(p_duration_seconds, duration_seconds),
      is_active = coalesce(p_is_active, is_active),
      verification_type = coalesce(p_verification_type, verification_type),
      verification_target = coalesce(p_verification_target, verification_target),
      verification_rules = coalesce(p_verification_rules, verification_rules),
      max_completions = coalesce(p_max_completions, max_completions),
      updated_at = now()
    where id = p_task_id
    returning * into v_task;
    v_id := v_task.id;
  end if;

  insert into public.admin_actions (admin_id, action, target_type, target_id, details)
  values (p_admin, 'upsert_task', 'task', v_id::text, jsonb_build_object('title', v_task.title));

  return to_jsonb(v_task);
end;
$$;

revoke all on function public.admin_upsert_task(uuid,uuid,text,text,text,text,text,integer,numeric,text,integer,boolean,text,text,jsonb,integer) from public;
grant execute on function public.admin_upsert_task(uuid,uuid,text,text,text,text,text,integer,numeric,text,integer,boolean,text,text,jsonb,integer) to service_role;

-- Admin: delete task
create or replace function public.admin_delete_task(
  p_admin uuid,
  p_task_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_admin_ok boolean;
begin
  v_admin_ok := public.is_admin_user(p_admin);
  if not v_admin_ok then raise exception 'not authorized' using errcode = '42501'; end if;
  delete from public.tasks where id = p_task_id;
  insert into public.admin_actions (admin_id, action, target_type, target_id)
  values (p_admin, 'delete_task', 'task', p_task_id::text);
  return true;
end;
$$;

revoke all on function public.admin_delete_task(uuid,uuid) from public;
grant execute on function public.admin_delete_task(uuid,uuid) to service_role;

-- Admin: update withdrawal status
create or replace function public.admin_update_withdrawal(
  p_admin uuid,
  p_withdrawal_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_ok boolean;
  v_w public.withdrawals;
  v_new_status text;
  v_prof public.profiles;
begin
  v_admin_ok := public.is_admin_user(p_admin);
  if not v_admin_ok then raise exception 'not authorized' using errcode = '42501'; end if;
  v_new_status := lower(p_status);
  if v_new_status not in ('pending','processing','paid','rejected') then
    raise exception 'invalid status';
  end if;

  select * into v_w from public.withdrawals where id = p_withdrawal_id for update;
  if not found then raise exception 'withdrawal not found'; end if;

  -- If rejecting, refund balance (we already debited on request)
  if v_new_status = 'rejected' and v_w.status <> 'rejected' then
    update public.profiles set usdt_balance = usdt_balance + v_w.amount_usdt where id = v_w.user_id;
  end if;

  update public.withdrawals
  set status = v_new_status,
      processed_at = case when v_new_status in ('paid','rejected') then now() else processed_at end
  where id = p_withdrawal_id
  returning * into v_w;

  insert into public.admin_actions (admin_id, action, target_type, target_id, details)
  values (p_admin, 'update_withdrawal', 'withdrawal', p_withdrawal_id::text, jsonb_build_object('status', v_new_status));

  return to_jsonb(v_w);
end;
$$;

revoke all on function public.admin_update_withdrawal(uuid,uuid,text) from public;
grant execute on function public.admin_update_withdrawal(uuid,uuid,text) to service_role;

-- Admin: ban/unban or update user
create or replace function public.admin_update_user(
  p_admin uuid,
  p_user_id uuid,
  p_is_banned boolean default null,
  p_is_admin boolean default null,
  p_trust_score integer default null,
  p_coins bigint default null,
  p_usdt_balance numeric(18,6) default null,
  p_referral_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_ok boolean;
  v_prof public.profiles;
begin
  v_admin_ok := public.is_admin_user(p_admin);
  if not v_admin_ok then raise exception 'not authorized' using errcode = '42501'; end if;

  update public.profiles
  set
    is_banned = coalesce(p_is_banned, is_banned),
    is_admin = coalesce(p_is_admin, is_admin),
    trust_score = coalesce(p_trust_score, trust_score),
    coins = coalesce(p_coins, coins),
    usdt_balance = coalesce(p_usdt_balance, usdt_balance),
    referral_count = coalesce(p_referral_count, referral_count),
    updated_at = now()
  where id = p_user_id
  returning * into v_prof;

  if not found then raise exception 'user not found'; end if;

  insert into public.admin_actions (admin_id, action, target_type, target_id, details)
  values (p_admin, 'update_user', 'user', p_user_id::text, jsonb_build_object('is_banned', v_prof.is_banned, 'is_admin', v_prof.is_admin));

  return to_jsonb(v_prof);
end;
$$;

revoke all on function public.admin_update_user(uuid,uuid,boolean,boolean,integer,bigint,numeric,integer) from public;
grant execute on function public.admin_update_user(uuid,uuid,boolean,boolean,integer,bigint,numeric,integer) to service_role;

-- Grant basic read to service role where needed (we use service role anyway)
grant select on public.admin_actions to service_role;

-- ============================================================================
-- SECTION: MIGRATION SAFETY
-- ----------------------------------------------------------------------------
-- Every statement above is additive and idempotent (`create ... if not exists`,
-- `add column if not exists`, `create or replace`). No migration ever drops or
-- rewrites user balances, ledger history, wallets or auth state. Apply future
-- changes the same way: append, never mutate, and record a version row below.
-- ============================================================================
create table if not exists public.schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);

insert into public.schema_migrations (version) values
  ('0001-foundation'),
  ('0002-admin-and-verification'),
  ('0003-scalability-and-config')
on conflict (version) do nothing;

-- ============================================================================
-- SECTION: PLATFORM SETTINGS (runtime brand/config overrides)
-- ----------------------------------------------------------------------------
-- A public row here lets an operator switch brand/bot/app URL at runtime without
-- a redeploy. Identity and balances live on profiles, so rebranding never
-- touches (or breaks) existing user data.
-- ============================================================================
create table if not exists public.platform_settings (
  key         text primary key,
  value       jsonb not null,
  is_public   boolean not null default false,
  description text,
  updated_at  timestamptz not null default now()
);

alter table public.platform_settings enable row level security;
drop policy if exists platform_settings_read on public.platform_settings;
create policy platform_settings_read on public.platform_settings for select using (is_public);

insert into public.platform_settings (key, value, is_public, description) values
  ('brand_name',          '"Questify"'::jsonb,                              true,  'Display name of the platform'),
  ('bot_username',        '"questify_app_bot"'::jsonb,                      true,  'Telegram bot handle (no @) used for all referral links'),
  ('app_url',             '"https://questify-nine-tau.vercel.app"'::jsonb,  true,  'Canonical Mini App URL'),
  ('min_withdrawal_usdt', '1'::jsonb,                                       true,  'Minimum withdrawal amount in USDT'),
  ('support_username',    'null'::jsonb,                                    true,  'Support contact handle (no @)')
on conflict (key) do nothing;

-- ============================================================================
-- SECTION: BALANCE LEDGER (immutable, zero data-loss audit of every balance move)
-- ----------------------------------------------------------------------------
-- A trigger on profiles records every coin/USDT delta automatically, so no code
-- path (RPC, admin adjustment, future job) can change a balance without leaving
-- an auditable trail. History is never deleted.
-- ============================================================================
create table if not exists public.balance_ledger (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  delta_coins         bigint not null default 0,
  delta_usdt          numeric(18,6) not null default 0,
  balance_coins_after bigint not null,
  balance_usdt_after  numeric(18,6) not null,
  reason              text,
  actor               uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists idx_ledger_user    on public.balance_ledger (user_id, created_at desc);
create index if not exists idx_ledger_created on public.balance_ledger (created_at desc);

alter table public.balance_ledger enable row level security;
drop policy if exists balance_ledger_read on public.balance_ledger;
create policy balance_ledger_read on public.balance_ledger for select using (false); -- service role only

create or replace function public.log_balance_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_dc bigint := coalesce(new.coins, 0) - coalesce(old.coins, 0);
  v_du numeric(18,6) := coalesce(new.usdt_balance, 0) - coalesce(old.usdt_balance, 0);
  v_actor text := current_setting('questify.actor', true);
begin
  if v_dc <> 0 or v_du <> 0 then
    insert into public.balance_ledger (
      user_id, delta_coins, delta_usdt, balance_coins_after, balance_usdt_after, reason, actor
    ) values (
      new.id, v_dc, v_du, new.coins, new.usdt_balance,
      nullif(current_setting('questify.reason', true), ''),
      nullif(v_actor, '')::uuid
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_ledger on public.profiles;
create trigger trg_profiles_ledger after update on public.profiles
  for each row execute function public.log_balance_change();

grant select on public.balance_ledger to service_role;

-- ============================================================================
-- SECTION: CONNECTED ACCOUNTS (real, DB-backed linked accounts)
-- ----------------------------------------------------------------------------
-- Replaces the mock "Linked Accounts" UI. Rows only exist once a provider is
-- actually linked; state is read from here, never hard-coded.
-- ============================================================================
create table if not exists public.connected_accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  provider         text not null check (provider in ('telegram','google','x','github','reddit','discord','youtube','tiktok')),
  provider_user_id text,
  username         text,
  connected_at     timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists idx_connected_user on public.connected_accounts (user_id);

alter table public.connected_accounts enable row level security;
drop policy if exists connected_accounts_read on public.connected_accounts;
-- Service-role only: linked accounts are served to their owner through the
-- authenticated /api/accounts route, never exposed through the anon key.
create policy connected_accounts_read on public.connected_accounts for select using (false);

-- ============================================================================
-- SECTION: SCALABILITY INDEXES
-- ----------------------------------------------------------------------------
-- Covering/partial indexes tuned for the hot read paths at high user counts:
-- leaderboard ordering, admin user search, task feed, per-user history.
-- ============================================================================
create extension if not exists pg_trgm;

-- `username` is citext; gin_trgm_ops needs an explicit ::text cast to build.
create index if not exists idx_profiles_username_trgm on public.profiles using gin (((username)::text) gin_trgm_ops);
create index if not exists idx_profiles_is_admin       on public.profiles (is_admin) where is_admin;
create index if not exists idx_profiles_created_at     on public.profiles (created_at desc);
create index if not exists idx_tasks_active_created    on public.tasks (created_at desc) where is_active;
create index if not exists idx_user_tasks_completed    on public.user_tasks (user_id, completed_at desc) where status = 'completed';
create index if not exists idx_withdrawals_open        on public.withdrawals (created_at desc) where status in ('pending','processing');
create index if not exists idx_referrals_referred      on public.referrals (referred_id);

-- ============================================================================
-- SECTION: ADMIN — manual balance adjustment (ledger-backed)
-- ============================================================================
create or replace function public.admin_adjust_balance(
  p_admin       uuid,
  p_user_id     uuid,
  p_delta_coins bigint        default 0,
  p_delta_usdt  numeric(18,6) default 0,
  p_reason      text          default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_ok boolean;
  v_prof public.profiles;
begin
  v_admin_ok := public.is_admin_user(p_admin);
  if not v_admin_ok then raise exception 'not authorized' using errcode = '42501'; end if;

  -- Tag the ledger entry this update will emit (balance >= 0 checks protect data).
  perform set_config('questify.reason', coalesce(p_reason, 'admin adjustment'), true);
  perform set_config('questify.actor', p_admin::text, true);

  update public.profiles
  set coins        = coins + coalesce(p_delta_coins, 0),
      usdt_balance = usdt_balance + coalesce(p_delta_usdt, 0),
      updated_at   = now()
  where id = p_user_id
  returning * into v_prof;

  if not found then raise exception 'user not found'; end if;

  insert into public.admin_actions (admin_id, action, target_type, target_id, details)
  values (p_admin, 'adjust_balance', 'user', p_user_id::text,
          jsonb_build_object('delta_coins', p_delta_coins, 'delta_usdt', p_delta_usdt, 'reason', p_reason));

  return to_jsonb(v_prof);
end;
$$;

revoke all on function public.admin_adjust_balance(uuid,uuid,bigint,numeric,text) from public;
grant execute on function public.admin_adjust_balance(uuid,uuid,bigint,numeric,text) to service_role;

-- Admin: paginated user lookup (username/telegram_id/referral code).
create or replace function public.admin_search_users(
  p_admin  uuid,
  p_query  text default null,
  p_limit  integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_ok boolean;
  v_rows jsonb;
begin
  v_admin_ok := public.is_admin_user(p_admin);
  if not v_admin_ok then raise exception 'not authorized' using errcode = '42501'; end if;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows
  from (
    select id, telegram_id, username, first_name, photo_url, coins, usdt_balance,
           trust_score, level, referral_code, referral_count, is_premium, is_banned,
           is_admin, created_at
    from public.profiles
    where p_query is null
       or p_query = ''
       or username ilike '%' || p_query || '%'
       or referral_code ilike '%' || p_query || '%'
       or telegram_id::text = p_query
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    offset greatest(0, coalesce(p_offset, 0))
  ) t;

  return v_rows;
end;
$$;

revoke all on function public.admin_search_users(uuid,text,integer,integer) from public;
grant execute on function public.admin_search_users(uuid,text,integer,integer) to service_role;

-- ============================================================================
-- SECTION: TASK VERIFICATION ENGINE (migration 0004)
-- ----------------------------------------------------------------------------
-- A task reward may only be credited after BOTH:
--   (a) the user explicitly started the task server-side (user_tasks.submitted_at),
--       and the task's required duration has elapsed on the SERVER clock — the
--       client countdown is advisory only and cannot be trusted; and
--   (b) any type-specific verification (Telegram channel membership, linked
--       social account) passed in the API layer, which is the only caller of
--       claim_task and the only holder of the service-role key.
-- ============================================================================

-- start_task: idempotent "user opened the action" marker. The FIRST start time
-- is preserved so re-opening the modal cannot reset the duration gate.
drop function if exists public.start_task(uuid, uuid);
create or replace function public.start_task(p_task_id uuid, p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := coalesce(p_user, auth.uid());
  v_task public.tasks;
  v_row  public.user_tasks;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select * into v_task from public.tasks where id = p_task_id and is_active = true;
  if not found then raise exception 'task not found or inactive' using errcode = 'P0002'; end if;

  select * into v_row from public.user_tasks where user_id = v_uid and task_id = p_task_id;
  if found and v_row.status = 'completed' then
    raise exception 'task already completed' using errcode = '23505';
  end if;

  insert into public.user_tasks (user_id, task_id, status, reward_coins, reward_usdt, submitted_at)
  values (v_uid, p_task_id, 'verifying', v_task.reward_coins, v_task.reward_usdt, now())
  on conflict (user_id, task_id) do update
    set status = 'verifying',
        submitted_at = case
          when public.user_tasks.status = 'verifying' and public.user_tasks.submitted_at is not null
            then public.user_tasks.submitted_at
          else now()
        end
  returning * into v_row;

  return jsonb_build_object(
    'submitted_at', v_row.submitted_at,
    'min_seconds', v_task.duration_seconds,
    'verification_type', v_task.verification_type
  );
end;
$$;

revoke all on function public.start_task(uuid, uuid) from public;
grant execute on function public.start_task(uuid, uuid) to service_role;

-- claim_task (redefined): adds the server-side duration gate before crediting.
create or replace function public.claim_task(p_task_id uuid, p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := coalesce(p_user, auth.uid());
  v_task     public.tasks;
  v_existing public.user_tasks;
  v_ref      uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select * into v_task from public.tasks where id = p_task_id and is_active = true;
  if not found then raise exception 'task not found or inactive' using errcode = 'P0002'; end if;

  select * into v_existing from public.user_tasks where user_id = v_uid and task_id = p_task_id;
  if found and v_existing.status = 'completed' then
    raise exception 'task already completed' using errcode = '23505';
  end if;

  -- SERVER-side duration gate. The client must have called start_task and the
  -- required time must have elapsed on the database clock. A forged/instant
  -- client callback cannot pass this.
  if v_task.duration_seconds > 0 then
    if not found
       or v_existing.submitted_at is null
       or now() - v_existing.submitted_at < make_interval(secs => v_task.duration_seconds) then
      raise exception 'verification in progress' using errcode = 'P0001';
    end if;
  end if;

  insert into public.user_tasks (user_id, task_id, status, reward_coins, reward_usdt, submitted_at, completed_at)
  values (v_uid, p_task_id, 'completed', v_task.reward_coins, v_task.reward_usdt, now(), now())
  on conflict (user_id, task_id) do update
    set status = 'completed', reward_coins = excluded.reward_coins,
        reward_usdt = excluded.reward_usdt, completed_at = now();

  update public.tasks set completions = completions + 1 where id = p_task_id;

  update public.profiles
     set coins = coins + v_task.reward_coins,
         usdt_balance = usdt_balance + v_task.reward_usdt,
         trust_score = least(100, trust_score + 1),
         level = greatest(1, floor((coins + v_task.reward_coins) / 1000) + 1)
   where id = v_uid
   returning referred_by into v_ref;

  -- 10% referral commission (coins + USDT) to the referrer
  if v_ref is not null then
    update public.profiles
       set coins = coins + floor(v_task.reward_coins * 0.1),
           usdt_balance = usdt_balance + (v_task.reward_usdt * 0.1)
     where id = v_ref;
  end if;

  return jsonb_build_object(
    'coins', v_task.reward_coins,
    'usdt', v_task.reward_usdt,
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid)
  );
end;
$$;

revoke all on function public.claim_task(uuid, uuid) from public;
grant execute on function public.claim_task(uuid, uuid) to service_role;

insert into public.schema_migrations (version) values ('0004-task-verification-engine')
on conflict (version) do nothing;
