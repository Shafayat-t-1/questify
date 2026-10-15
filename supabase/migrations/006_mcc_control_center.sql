-- ============================================================================
-- 006_mcc_control_center.sql · Questify
-- ----------------------------------------------------------------------------
-- Phase 3A (Master Control Center):
--
--   1. profiles.is_founder — COSMETIC ONLY. Changes a label ("Founder &
--      Supreme Owner"); every authorization check still tests is_admin. Set by
--      the operator with one manual SQL statement; there is NO UI or RPC that
--      grants it. Guarded against client-side escalation like is_admin.
--   2. Ban enforcement at the RPC level for every reward/withdrawal path:
--        · claim_task            — banned users cannot earn task rewards
--        · claim_daily_checkin   — banned users cannot earn check-in rewards
--        · request_withdrawal    — already enforced in 005 (unchanged, asserted)
--      (connected_accounts writes are enforced server-side in the API layer,
--       which is the only writer of that table via the service role.)
--   3. admin_adjust_balance: rejects a BLANK reason. Same signature as the
--      0004/schema.sql definition, so no drop is needed; the body additionally
--      validates the reason BEFORE touching balances. Ledger + admin_actions
--      logging behaviour is unchanged.
--   4. mcc_live_ticks — a tiny heartbeat table (source + timestamp, NO money,
--      NO user ids) written by SECURITY DEFINER triggers on the money tables
--      and readable by anon, so the admin UIs can subscribe client-side to
--      Supabase Realtime (postgres_changes) for live-updating numbers WITHOUT
--      exposing ledger/withdrawal rows through the public anon key. The real
--      numbers are then fetched from cookie-gated admin API routes.
--   5. Adds the money tables + heartbeat table to the supabase_realtime
--      publication (idempotent) so the platform is ready for Phase 3B graphs.
--
-- Idempotent: safe to re-run. Never edits earlier migrations; never drops or
-- rewrites balances, ledger history or wallets.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1 · profiles.is_founder (cosmetic flag, operator-set only)
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists is_founder boolean not null default false;

-- Protect is_founder from client-role escalation exactly like is_admin.
create or replace function public.guard_profiles_protected_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.id             is distinct from old.id
       or new.telegram_id  is distinct from old.telegram_id
       or new.is_admin     is distinct from old.is_admin
       or new.is_founder   is distinct from old.is_founder
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

-- Expose the flag wherever a profile row is already exposed (admin_search_users
-- below adds it explicitly for the MCC user search).
-- No RPC grants is_founder; there is intentionally no self-service path.

-- ----------------------------------------------------------------------------
-- SECTION 2 · Ban enforcement inside the reward RPCs
-- ----------------------------------------------------------------------------
-- 2a. claim_task (same signature as 005) — banned users cannot claim rewards.
--     Full body is re-defined from 005_dual_wallet_referral.sql with ONLY the
--     ban guard added; every money rule is byte-for-byte the same intent.
-- ----------------------------------------------------------------------------
create or replace function public.claim_task(
  p_task_id uuid,
  p_user uuid default null,
  p_idempotency_key text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := coalesce(p_user, auth.uid());
  v_task       public.tasks;
  v_existing   public.user_tasks;
  v_banned     boolean;
  v_ref        uuid;
  v_ref2       uuid;
  v_margin     numeric;
  v_owner_pct  numeric;
  v_mkt_pct    numeric;
  v_owner_amt  numeric;
  v_mkt_amt    numeric;
  v_t1_pct     numeric;
  v_t2_pct     numeric;
  v_pay        numeric;
  v_res        text;
  v_level_size numeric;
  v_trust_up   integer;
  v_trust_cap  integer;
  v_min_tasks  integer;
  v_done       integer;
  v_bonus_c    integer;
  v_bonus_u    numeric;
  v_bonus_claim integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  -- BAN GATE (phase 3A): suspended accounts earn nothing, at the RPC level.
  select is_banned into v_banned from public.profiles where id = v_uid;
  if coalesce(v_banned, false) then
    raise exception 'account suspended' using errcode = '42501';
  end if;

  -- Serialise concurrent claims for the same (user, task) so a double-tap or a
  -- retried request cannot credit the reward twice.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_task_id::text, 0));

  -- Lock the task row so the max_completions check and the increment are atomic.
  select * into v_task from public.tasks where id = p_task_id and is_active = true for update;
  if not found then raise exception 'task not found or inactive' using errcode = 'P0002'; end if;

  select * into v_existing from public.user_tasks where user_id = v_uid and task_id = p_task_id;
  if found and v_existing.status = 'completed' then
    -- Idempotent replay: a retried tap that reuses its idempotency key returns the
    -- original reward without crediting again. A keyless re-claim is rejected.
    if nullif(btrim(coalesce(p_idempotency_key, '')), '') is not null then
      return jsonb_build_object(
        'coins', v_existing.reward_coins,
        'usdt', v_existing.reward_usdt,
        'replayed', true,
        'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid)
      );
    end if;
    raise exception 'task already completed' using errcode = '23505';
  end if;

  -- Enforce the task completion cap. 0 / null means unlimited.
  if coalesce(v_task.max_completions, 0) > 0 and v_task.completions >= v_task.max_completions then
    raise exception 'task completion limit reached' using errcode = 'P0001';
  end if;

  -- SERVER-side duration gate: the client must have called start_task and the
  -- required time must have elapsed on the database clock.
  if v_task.duration_seconds > 0 then
    if not found
       or v_existing.submitted_at is null
       or now() - v_existing.submitted_at < make_interval(secs => v_task.duration_seconds) then
      raise exception 'verification in progress' using errcode = 'P0001';
    end if;
  end if;

  v_level_size := greatest(1, public.setting_numeric('level_coins_per_level', 1000));
  v_trust_up   := public.setting_int('trust_score_task_delta', 1);
  v_trust_cap  := public.setting_int('trust_score_cap', 100);

  insert into public.user_tasks (user_id, task_id, status, reward_coins, reward_usdt, submitted_at, completed_at)
  values (v_uid, p_task_id, 'completed', v_task.reward_coins, v_task.reward_usdt, now(), now())
  on conflict (user_id, task_id) do update
    set status = 'completed', reward_coins = excluded.reward_coins,
        reward_usdt = excluded.reward_usdt, completed_at = now();

  update public.tasks set completions = completions + 1 where id = p_task_id;

  update public.profiles
     set coins = coins + v_task.reward_coins,
         usdt_balance = usdt_balance + v_task.reward_usdt,
         trust_score = least(v_trust_cap, trust_score + v_trust_up),
         level = greatest(1, floor(((coins + v_task.reward_coins)::numeric) / v_level_size)::integer + 1)
   where id = v_uid
   returning referred_by, referred_by_tier2 into v_ref, v_ref2;

  -- Margin split: owner_wallet_split_pct / marketing_wallet_split_pct.
  -- Rounding rule: marketing is rounded to 6dp and the owner takes the exact
  -- remainder, so owner + marketing == margin with no leak.
  v_margin := greatest(0, coalesce(v_task.margin_usdt, 0));
  if v_margin > 0 then
    v_owner_pct := greatest(0, least(1, public.setting_numeric('owner_wallet_split_pct', 0.95)));
    v_mkt_pct   := greatest(0, least(1, public.setting_numeric('marketing_wallet_split_pct', 0.05)));
    if v_owner_pct + v_mkt_pct <= 0 then
      v_owner_pct := 1;
      v_mkt_pct   := 0;
    end if;
    v_mkt_amt   := round(v_margin * v_mkt_pct, 6);
    v_owner_amt := v_margin - v_mkt_amt;

    perform public.owner_wallet_append(
      v_owner_amt, 'task_margin_in', p_task_id, v_uid,
      v_uid::text || ':' || p_task_id::text, 'task margin split (owner)');
    perform public.marketing_wallet_append(
      v_mkt_amt, 'task_margin_in', p_task_id, v_uid,
      v_uid::text || ':' || p_task_id::text, 'task margin split (marketing)');
  end if;

  -- Tier-1 (direct referrer) and Tier-2 (referrer's referrer) lifetime
  -- commission, paid ONLY from the marketing wallet.
  if v_margin > 0 then
    v_t1_pct := greatest(0, public.setting_numeric('referral_tier1_commission_pct', 0.1));
    v_t2_pct := greatest(0, public.setting_numeric('referral_tier2_commission_pct', 0.05));

    if v_ref is not null and v_ref <> v_uid and v_t1_pct > 0 then
      v_pay := round(v_margin * v_t1_pct, 6);
      if v_pay > 0 then
        v_res := public.marketing_wallet_payout(
          v_pay, p_task_id, v_ref, 'tier1:' || v_uid::text || ':' || p_task_id::text,
          'tier-1 referral commission');
        if v_res = 'paid' then
          update public.profiles set usdt_balance = usdt_balance + v_pay where id = v_ref;
        end if;
      end if;
    end if;

    if v_ref2 is not null and v_ref2 <> v_uid and v_ref2 <> coalesce(v_ref, v_uid) and v_t2_pct > 0 then
      v_pay := round(v_margin * v_t2_pct, 6);
      if v_pay > 0 then
        v_res := public.marketing_wallet_payout(
          v_pay, p_task_id, v_ref2, 'tier2:' || v_uid::text || ':' || p_task_id::text,
          'tier-2 referral commission');
        if v_res = 'paid' then
          update public.profiles set usdt_balance = usdt_balance + v_pay where id = v_ref2;
        end if;
      end if;
    end if;
  end if;

  -- Instant referral bonus: fires once, when the referred user reaches
  -- referral_bonus_min_tasks completed tasks (not on signup). Paid from the
  -- marketing wallet; skipped (and left unpaid for a later retry) if it cannot
  -- cover the USDT component.
  if v_ref is not null then
    v_min_tasks := greatest(1, public.setting_int('referral_bonus_min_tasks', 3));
    select count(*) into v_done
      from public.user_tasks where user_id = v_uid and status = 'completed';

    if v_done >= v_min_tasks then
      -- Atomically claim the one-time bonus by flipping referral_bonus_paid_at
      -- from null. A concurrent claim for another task blocks on this row and
      -- then sees the flag set, so the bonus can never be paid twice. The USDT
      -- component is paid from the marketing wallet with a NULL reference (so a
      -- later retry after 'insufficient' cannot collide with the per-wallet
      -- unique reference index); exactly-once is guaranteed by this flag.
      update public.profiles
         set referral_bonus_paid_at = now()
       where id = v_uid and referral_bonus_paid_at is null;
      get diagnostics v_bonus_claim = row_count;

      if v_bonus_claim = 1 then
        v_bonus_c := public.setting_int('referral_instant_bonus_coins', 150);
        v_bonus_u := greatest(0, public.setting_numeric('referral_instant_bonus_usdt', 0.03));

        v_res := 'paid';
        if v_bonus_u > 0 then
          v_res := public.marketing_wallet_payout(
            v_bonus_u, p_task_id, v_ref, null, 'instant referral bonus');
        end if;

        if v_res = 'paid' then
          update public.profiles
             set coins = coins + v_bonus_c,
                 usdt_balance = usdt_balance + v_bonus_u,
                 level = greatest(1, floor(((coins + v_bonus_c)::numeric) / v_level_size)::integer + 1)
           where id = v_ref;
        else
          -- Could not pay yet; release the claim so a later completion retries.
          update public.profiles set referral_bonus_paid_at = null where id = v_uid;
        end if;
      end if;
    end if;
  end if;

  -- Milestone bonuses for the direct referrer (idempotent, self-healing).
  if v_ref is not null then
    perform public.pay_referral_milestones(v_ref, p_task_id);
  end if;

  return jsonb_build_object(
    'coins', v_task.reward_coins,
    'usdt', v_task.reward_usdt,
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid)
  );
end;
$$;

revoke all on function public.claim_task(uuid, uuid, text) from public;
grant execute on function public.claim_task(uuid, uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 2b. claim_daily_checkin (same signature as 004) — banned users cannot earn
--     check-in rewards. Body re-defined from 004_money_safety.sql with ONLY
--     the ban guard added.
-- ----------------------------------------------------------------------------
create or replace function public.claim_daily_checkin(p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := coalesce(p_user, auth.uid());
  v_banned     boolean;
  v_last_date  date;
  v_next_day   integer := 1;
  v_rewards    integer[];
  v_reward     integer;
  v_trust_up   integer;
  v_trust_cap  integer;
  v_level_size numeric;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  -- BAN GATE (phase 3A): suspended accounts earn nothing, at the RPC level.
  select is_banned into v_banned from public.profiles where id = v_uid;
  if coalesce(v_banned, false) then
    raise exception 'account suspended' using errcode = '42501';
  end if;

  select max(streak_date) into v_last_date from public.daily_checkins where user_id = v_uid;

  if v_last_date = current_date then
    raise exception 'already checked in today' using errcode = '23505';
  end if;

  if v_last_date = current_date - 1 then
    select coalesce(max(day_index), 0) + 1 into v_next_day
      from public.daily_checkins where user_id = v_uid;
    if v_next_day > 7 then v_next_day := 1; end if;
  end if;

  v_rewards := public.setting_int_array(
    'checkin_reward_schedule',
    array[100, 150, 220, 320, 450, 600, 1000]
  );
  if v_rewards is null or array_length(v_rewards, 1) is null then
    v_rewards := array[100, 150, 220, 320, 450, 600, 1000];
  end if;
  v_reward := coalesce(v_rewards[least(v_next_day, array_length(v_rewards, 1))], v_rewards[1]);

  v_trust_up   := public.setting_int('trust_score_checkin_delta', 2);
  v_trust_cap  := public.setting_int('trust_score_cap', 100);
  v_level_size := greatest(1, public.setting_numeric('level_coins_per_level', 1000));

  insert into public.daily_checkins (user_id, day_index, reward_coins)
  values (v_uid, v_next_day, v_reward)
  on conflict (user_id, streak_date) do nothing;

  update public.profiles
     set coins = coins + v_reward,
         trust_score = least(v_trust_cap, trust_score + v_trust_up),
         level = greatest(1, floor(((coins + v_reward)::numeric) / v_level_size)::integer + 1)
   where id = v_uid;

  return jsonb_build_object(
    'coins', v_reward,
    'usdt', 0,
    'day', v_next_day,
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid)
  );
end;
$$;

revoke all on function public.claim_daily_checkin(uuid) from public;
grant execute on function public.claim_daily_checkin(uuid) to service_role;

-- (2c) request_withdrawal already raises 'account suspended' for banned users
--      in 005_dual_wallet_referral.sql — no change needed here.

-- ----------------------------------------------------------------------------
-- SECTION 3 · admin_adjust_balance — reject a blank reason
-- ----------------------------------------------------------------------------
-- Same signature as the schema.sql definition (uuid,uuid,bigint,numeric,text),
-- so CREATE OR REPLACE is enough. Everything else (ledger tagging via
-- set_config, the admin_actions audit row) is unchanged.
-- ----------------------------------------------------------------------------
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

  -- Phase 3A: an adjustment without an audit reason is rejected outright.
  if p_reason is null or length(btrim(p_reason)) < 1 then
    raise exception 'reason is required' using errcode = 'P0001';
  end if;

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

-- ----------------------------------------------------------------------------
-- SECTION 4 · admin_search_users — expose the fields the MCC user manager needs
-- ----------------------------------------------------------------------------
-- Same signature; the projection gains is_founder and the referral chain ids so
-- the /mcc user detail view can show them without a second privileged query.
-- ----------------------------------------------------------------------------
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
           is_admin, is_founder, referred_by, referred_by_tier2, created_at
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

-- ----------------------------------------------------------------------------
-- SECTION 5 · mcc_live_ticks — realtime heartbeat (no money, no user ids)
-- ----------------------------------------------------------------------------
-- One row per signal source, updated in the same transaction as the money
-- movement by SECURITY DEFINER triggers. Readable by anon so a browser can
-- subscribe with the public anon key and learn "something happened" — then
-- fetch the real numbers through the cookie-gated admin API. The row payload
-- is only (source, at); nothing sensitive ever crosses the public channel.
-- ----------------------------------------------------------------------------
create table if not exists public.mcc_live_ticks (
  source text primary key check (source in
            ('owner_wallet','marketing_wallet','task_completed','withdrawal')),
  at     timestamptz not null default now()
);

alter table public.mcc_live_ticks enable row level security;

drop policy if exists mcc_live_ticks_read on public.mcc_live_ticks;
create policy mcc_live_ticks_read on public.mcc_live_ticks for select
  to anon, authenticated using (true);
-- No insert/update/delete policy: only SECURITY DEFINER triggers write here.

create or replace function public.mcc_touch_tick(p_source text)
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.mcc_live_ticks (source, at)
  values (p_source, now())
  on conflict (source) do update set at = excluded.at;
  return new;
end;
$$;

drop trigger if exists trg_mcc_tick_owner on public.owner_wallet_ledger;
create trigger trg_mcc_tick_owner after insert on public.owner_wallet_ledger
  for each row execute function public.mcc_touch_tick('owner_wallet');

drop trigger if exists trg_mcc_tick_marketing on public.marketing_wallet_ledger;
create trigger trg_mcc_tick_marketing after insert on public.marketing_wallet_ledger
  for each row execute function public.mcc_touch_tick('marketing_wallet');

drop trigger if exists trg_mcc_tick_tasks on public.user_tasks;
create trigger trg_mcc_tick_tasks after insert or update on public.user_tasks
  for each row when (new.status = 'completed')
  execute function public.mcc_touch_tick('task_completed');

drop trigger if exists trg_mcc_tick_withdrawals on public.withdrawals;
create trigger trg_mcc_tick_withdrawals after insert or update on public.withdrawals
  for each row execute function public.mcc_touch_tick('withdrawal');

grant select on public.mcc_live_ticks to anon, authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 6 · Realtime publication (idempotent)
-- ----------------------------------------------------------------------------
-- Postgres logical replication (which Supabase Realtime is built on) only
-- delivers changes for tables explicitly added to the supabase_realtime
-- publication. RLS still applies per subscriber role: the money tables keep
-- their locked-down policies (no anon reads), the heartbeat table is readable.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  begin
    create publication supabase_realtime;
  exception
    when duplicate_object then null; -- already exists (normal on Supabase)
  end;

  foreach t in array array[
    'owner_wallet_ledger', 'marketing_wallet_ledger',
    'user_tasks', 'withdrawals', 'mcc_live_ticks'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Record the migration version.
--     File numbering: 001, 002, 004, 005 exist → this file is 006.
--     schema_migrations already holds 0001..0007 (0007 = file 005) → the next
--     recorded version is 0008.
-- ----------------------------------------------------------------------------
insert into public.schema_migrations (version) values ('0008-mcc-control-center')
on conflict (version) do nothing;
