-- ============================================================================
-- 004_money_safety.sql · Questify
-- ----------------------------------------------------------------------------
-- Phase 2: money-safety hardening + admin-configurable economics.
--
--   1. Postgres-backed rate limiter (works across serverless instances).
--   2. Enforce `tasks.max_completions` and require a `tx_hash` before a
--      withdrawal may be marked `paid`.
--   3. Idempotency: serialise concurrent claim_task / request_withdrawal calls
--      and accept an optional withdrawal idempotency key.
--   4. Move hardcoded economics (commission, fees, coin rate, check-in schedule,
--      level size, trust deltas, withdrawal threshold, referral signup bonus)
--      into `platform_settings`, read server-side at request time.
--   5. Audit trail: fill `admin_actions.ip_address` / `user_agent` from the
--      PostgREST request headers on every insert (best-effort).
--
-- Idempotent: safe to re-run. Never edits earlier migrations; never drops or
-- rewrites user balances, ledger history or wallets.
-- ============================================================================

-- ============================================================================
-- SECTION 1 · RATE LIMITER (Postgres-backed, instance-safe)
-- ----------------------------------------------------------------------------
-- `evaluate` in plpgsql: fixed-window counter keyed on (key, window_start).
-- The INSERT ... ON CONFLICT DO UPDATE takes a row lock, so concurrent requests
-- on the same key serialise and the count is exact even across many serverless
-- instances sharing the same database.
-- ============================================================================
create table if not exists public.rate_limits (
  key          text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (key, window_start)
);

create index if not exists idx_rate_limits_window on public.rate_limits (window_start desc);

alter table public.rate_limits enable row level security;
grant select, insert, update, delete on public.rate_limits to service_role;

-- check_rate_limit: atomically counts one hit against the current window and
-- returns true while the caller is within the limit. Returns true (i.e. does not
-- block) when p_max <= 0, which disables the limit for that key.
create or replace function public.check_rate_limit(
  p_key            text,
  p_max            integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window integer := greatest(1, coalesce(p_window_seconds, 60));
  v_start  timestamptz;
  v_count  integer;
begin
  if p_key is null or length(btrim(p_key)) = 0 then return true; end if;
  if p_max is null or p_max <= 0 then return true; end if;

  v_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / v_window) * v_window);

  insert into public.rate_limits (key, window_start, count)
  values (p_key, v_start, 1)
  on conflict (key, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- Operator/cron helper: prune closed windows. Not called on the hot path.
create or replace function public.prune_rate_limits(p_older_than_seconds integer default 3600)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_deleted integer;
begin
  delete from public.rate_limits
   where window_start < now() - make_interval(secs => greatest(60, coalesce(p_older_than_seconds, 3600)));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_rate_limits(integer) from public;
grant execute on function public.prune_rate_limits(integer) to service_role;

-- ============================================================================
-- SECTION 2 · SETTINGS HELPERS (read platform_settings server-side)
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER so the reward RPCs (which run as the definer) and the
-- service role can read every row regardless of the is_public RLS policy.
-- Every helper fails safe: a missing/invalid row yields the provided default.
-- ============================================================================
create or replace function public.setting_jsonb(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select value from public.platform_settings where key = p_key;
$$;

create or replace function public.setting_numeric(p_key text, p_default numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v      jsonb;
  v_text text;
begin
  v := public.setting_jsonb(p_key);
  if v is null then return p_default; end if;
  v_text := v #>> '{}';
  if v_text is null or btrim(v_text) = '' then return p_default; end if;
  return v_text::numeric;
exception when others then
  return p_default;
end;
$$;

create or replace function public.setting_int(p_key text, p_default integer)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare v numeric;
begin
  v := public.setting_numeric(p_key, p_default::numeric);
  if v is null then return p_default; end if;
  return round(v)::integer;
exception when others then
  return p_default;
end;
$$;

create or replace function public.setting_text(p_key text, p_default text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  v := public.setting_jsonb(p_key);
  if v is null or jsonb_typeof(v) <> 'string' then return p_default; end if;
  return v #>> '{}';
exception when others then
  return p_default;
end;
$$;

create or replace function public.setting_int_array(p_key text, p_default integer[])
returns integer[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  v := public.setting_jsonb(p_key);
  if v is null or jsonb_typeof(v) <> 'array' then return p_default; end if;
  return array(select e::integer from jsonb_array_elements_text(v) e);
exception when others then
  return p_default;
end;
$$;

revoke all on function public.setting_jsonb(text) from public;
revoke all on function public.setting_numeric(text, numeric) from public;
revoke all on function public.setting_int(text, integer) from public;
revoke all on function public.setting_text(text, text) from public;
revoke all on function public.setting_int_array(text, integer[]) from public;
grant execute on function public.setting_jsonb(text) to service_role;
grant execute on function public.setting_numeric(text, numeric) to service_role;
grant execute on function public.setting_int(text, integer) to service_role;
grant execute on function public.setting_text(text, text) to service_role;
grant execute on function public.setting_int_array(text, integer[]) to service_role;

-- ============================================================================
-- SECTION 3 · REQUEST HEADERS → ADMIN AUDIT TRAIL
-- ----------------------------------------------------------------------------
-- PostgREST exposes the originating request headers to the database session via
-- the `request.headers` GUC. A BEFORE INSERT trigger fills ip_address/user_agent
-- on every admin_actions row, so no admin RPC signature has to change and every
-- current or future audit insert is covered. Best-effort: absent headers leave
-- the columns null.
-- ============================================================================
create or replace function public.request_header(p_name text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare v_json jsonb;
begin
  begin
    v_json := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_json := null;
  end;
  if v_json is null then return null; end if;
  return nullif(btrim(v_json ->> lower(p_name)), '');
end;
$$;

create or replace function public.request_ip()
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    nullif(btrim(split_part(public.request_header('x-forwarded-for'), ',', 1)), ''),
    public.request_header('x-real-ip'),
    public.request_header('cf-connecting-ip')
  );
$$;

create or replace function public.request_user_agent()
returns text
language sql
stable
set search_path = public
as $$
  select public.request_header('user-agent');
$$;

create or replace function public.fill_admin_action_request_meta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ip_address is null then new.ip_address := public.request_ip(); end if;
  if new.user_agent is null then new.user_agent := public.request_user_agent(); end if;
  return new;
end;
$$;

drop trigger if exists trg_admin_actions_request_meta on public.admin_actions;
create trigger trg_admin_actions_request_meta
  before insert on public.admin_actions
  for each row execute function public.fill_admin_action_request_meta();

-- Backfill-ability: keep the trigger function executable by the insert owner.
grant execute on function public.request_header(text) to service_role;
grant execute on function public.request_ip() to service_role;
grant execute on function public.request_user_agent() to service_role;

-- ============================================================================
-- SECTION 4 · SEED ADMIN-EDITABLE ECONOMICS (idempotent)
-- ----------------------------------------------------------------------------
-- Public rows are readable by the client (via /api/config) for display; private
-- rows are server-only. Changing any value here changes behaviour with no code
-- change and no redeploy. Existing rows are never overwritten (on conflict).
-- ============================================================================
insert into public.platform_settings (key, value, is_public, description) values
  ('referral_commission_pct',          '0.1'::jsonb,       false, 'Referrer commission as a fraction of a task reward (0.1 = 10%)'),
  ('referral_signup_reward_coins',     '150'::jsonb,       false, 'Coins granted to the referrer when a new user joins with their code'),
  ('referral_signup_reward_usdt',      '0.03'::jsonb,      false, 'USDT granted to the referrer when a new user joins with their code'),
  ('coin_to_usdt_rate',                '0.0002'::jsonb,    true,  'Indicative value of one coin in USDT (display only)'),
  ('withdrawal_fee_bep20',             '1'::jsonb,         true,  'Flat fee in USDT for a BEP-20 withdrawal'),
  ('withdrawal_fee_ton',               '0.5'::jsonb,       true,  'Flat fee in USDT for a TON withdrawal'),
  ('checkin_reward_schedule',          '[100,150,220,320,450,600,1000]'::jsonb, true, 'Coins granted for each of the 7 daily check-in streak days'),
  ('checkin_multiplier_schedule',      '[1.0,1.1,1.2,1.4,1.6,1.8,2.5]'::jsonb,   true, 'Display multiplier shown for each check-in streak day'),
  ('level_coins_per_level',            '1000'::jsonb,      true,  'Coins required per character level'),
  ('trust_score_task_delta',           '1'::jsonb,         true,  'Trust score gained per completed task'),
  ('trust_score_checkin_delta',        '2'::jsonb,         true,  'Trust score gained per daily check-in'),
  ('trust_score_cap',                  '100'::jsonb,       true,  'Maximum trust score'),
  ('trust_threshold_for_withdrawal',   '30'::jsonb,        true,  'Minimum trust score required to request a withdrawal'),
  ('rate_limits',                       '{"claim_task":{"max":30,"window_seconds":60},"checkin":{"max":5,"window_seconds":60},"withdraw":{"max":5,"window_seconds":300},"accounts":{"max":20,"window_seconds":60},"broadcast":{"max":3,"window_seconds":60},"notify":{"max":60,"window_seconds":60},"referral":{"max":30,"window_seconds":60}}'::jsonb, false, 'Per-action rate-limit windows (max hits / window_seconds)'),
  ('leaderboard_season_label',         '"Season 1"'::jsonb,        true, 'Season title shown on the leaderboard'),
  ('leaderboard_reset_label',          '"resets in 6 days"'::jsonb, true, 'Reset note shown beside the season title'),
  ('leaderboard_reward_note',          '"Top 100 rewarded"'::jsonb, true, 'Reward note badge shown on the leaderboard'),
  ('min_withdrawal_usdt',              '1'::jsonb,         true,  'Minimum withdrawal amount in USDT')
on conflict (key) do nothing;

-- ============================================================================
-- SECTION 5 · WITHDRAWAL IDEMPOTENCY KEY
-- ============================================================================
alter table public.withdrawals add column if not exists idempotency_key text;

-- One row per (user, key). Partial index ignores legacy rows with no key.
create unique index if not exists uq_withdrawals_user_idem
  on public.withdrawals (user_id, idempotency_key)
  where idempotency_key is not null;

-- ============================================================================
-- SECTION 6 · claim_task — enforce max_completions, settings-driven economics,
--                              double-submit safe
-- ============================================================================
drop function if exists public.claim_task(uuid, uuid);

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
  v_ref        uuid;
  v_commission numeric;
  v_level_size numeric;
  v_trust_up   integer;
  v_trust_cap  integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  -- Serialise concurrent claims for the same (user, task) so a double-tap or a
  -- retried request cannot credit the reward twice.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_task_id::text, 0));

  -- Lock the task row so the max_completions check and the increment are atomic.
  select * into v_task from public.tasks where id = p_task_id and is_active = true for update;
  if not found then raise exception 'task not found or inactive' using errcode = 'P0002'; end if;

  select * into v_existing from public.user_tasks where user_id = v_uid and task_id = p_task_id;
  if found and v_existing.status = 'completed' then
    -- Idempotent replay: a retried tap that reuses its idempotency key returns the
    -- original reward without crediting again (the task may only be completed
    -- once). A keyless re-claim is still rejected.
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

  v_commission := public.setting_numeric('referral_commission_pct', 0.1);
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
   returning referred_by into v_ref;

  -- Referrer commission (coins + USDT), fraction comes from settings.
  if v_ref is not null and v_commission > 0 then
    update public.profiles
       set coins = coins + floor(v_task.reward_coins * v_commission),
           usdt_balance = usdt_balance + (v_task.reward_usdt * v_commission)
     where id = v_ref;
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

-- ============================================================================
-- SECTION 7 · claim_daily_checkin — settings-driven schedule + trust/level
-- ============================================================================
create or replace function public.claim_daily_checkin(p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := coalesce(p_user, auth.uid());
  v_last_date  date;
  v_next_day   integer := 1;
  v_rewards    integer[];
  v_reward     integer;
  v_trust_up   integer;
  v_trust_cap  integer;
  v_level_size numeric;
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

-- ============================================================================
-- SECTION 8 · request_withdrawal — settings minimum/threshold + idempotency
-- ----------------------------------------------------------------------------
-- Signature changes (new p_idempotency_key), so drop the old 4-arg function to
-- avoid an ambiguous overload.
-- ============================================================================
drop function if exists public.request_withdrawal(numeric, text, text, uuid);

create or replace function public.request_withdrawal(
  p_amount          numeric,
  p_network         text,
  p_address         text,
  p_user            uuid default null,
  p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := coalesce(p_user, auth.uid());
  v_prof       public.profiles;
  v_row        public.withdrawals;
  v_min        numeric;
  v_trust_min  integer;
  v_key        text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  -- Serialise every withdrawal for a user so a double-submit cannot queue twice.
  perform pg_advisory_xact_lock(hashtextextended('withdrawal:' || v_uid::text, 0));

  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  if v_key is not null then
    select * into v_row from public.withdrawals
     where user_id = v_uid and idempotency_key = v_key;
    if found then
      -- Replay: return the original withdrawal instead of creating a new one.
      return to_jsonb(v_row);
    end if;
  end if;

  v_min := public.setting_numeric('min_withdrawal_usdt', 1);
  if p_amount is null or p_amount < v_min then
    raise exception 'minimum withdrawal is % USDT', v_min using errcode = 'P0001';
  end if;
  if p_network not in ('BEP20','TON') then
    raise exception 'unsupported network' using errcode = 'P0001';
  end if;
  if p_address is null or length(trim(p_address)) < 10 then
    raise exception 'invalid wallet address' using errcode = 'P0001';
  end if;

  v_trust_min := public.setting_int('trust_threshold_for_withdrawal', 30);

  select * into v_prof from public.profiles where id = v_uid for update;
  if not found then raise exception 'profile not found' using errcode = 'P0002'; end if;
  if v_prof.is_banned then raise exception 'account suspended' using errcode = '42501'; end if;
  if v_prof.trust_score < v_trust_min then
    raise exception 'trust score too low' using errcode = '42501';
  end if;
  if v_prof.usdt_balance < p_amount then
    raise exception 'insufficient balance' using errcode = 'P0001';
  end if;

  update public.profiles set usdt_balance = usdt_balance - p_amount where id = v_uid;

  insert into public.withdrawals (user_id, amount_usdt, network, address, status, idempotency_key)
  values (v_uid, p_amount, p_network, trim(p_address), 'pending', v_key)
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.request_withdrawal(numeric, text, text, uuid, text) from public;
grant execute on function public.request_withdrawal(numeric, text, text, uuid, text) to service_role;

-- ============================================================================
-- SECTION 9 · admin_update_withdrawal — require tx_hash before "paid"
-- ----------------------------------------------------------------------------
-- Signature changes (new p_tx_hash), so drop the old 3-arg function.
-- ============================================================================
drop function if exists public.admin_update_withdrawal(uuid, uuid, text);

create or replace function public.admin_update_withdrawal(
  p_admin        uuid,
  p_withdrawal_id uuid,
  p_status       text,
  p_tx_hash      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_ok boolean;
  v_w        public.withdrawals;
  v_new_status text;
  v_tx       text;
begin
  v_admin_ok := public.is_admin_user(p_admin);
  if not v_admin_ok then raise exception 'not authorized' using errcode = '42501'; end if;
  v_new_status := lower(p_status);
  if v_new_status not in ('pending','processing','paid','rejected') then
    raise exception 'invalid status';
  end if;

  select * into v_w from public.withdrawals where id = p_withdrawal_id for update;
  if not found then raise exception 'withdrawal not found'; end if;

  -- Money safety: paid/rejected are terminal. Re-opening a finalised withdrawal
  -- would let a second rejection refund the same debit twice (minting USDT).
  if v_w.status in ('paid','rejected') and v_new_status <> v_w.status then
    raise exception 'withdrawal is already % and cannot be changed', v_w.status
      using errcode = 'P0001';
  end if;

  v_tx := nullif(btrim(coalesce(p_tx_hash, '')), '');
  if v_tx is null then
    v_tx := nullif(btrim(coalesce(v_w.tx_hash, '')), '');
  end if;

  -- Real money: a withdrawal may only be marked paid once a tx hash proves the
  -- on-chain payout was broadcast. Reject empty/whitespace hashes.
  if v_new_status = 'paid' and v_tx is null then
    raise exception 'a tx_hash is required before marking a withdrawal paid';
  end if;

  -- If rejecting an open request, refund balance exactly once (it was debited on
  -- request). Terminal states are guarded above, so this cannot run twice.
  if v_new_status = 'rejected' and v_w.status in ('pending','processing') then
    update public.profiles set usdt_balance = usdt_balance + v_w.amount_usdt where id = v_w.user_id;
  end if;

  update public.withdrawals
  set status = v_new_status,
      tx_hash = coalesce(v_tx, tx_hash),
      processed_at = case when v_new_status in ('paid','rejected') then now() else processed_at end
  where id = p_withdrawal_id
  returning * into v_w;

  insert into public.admin_actions (admin_id, action, target_type, target_id, details)
  values (p_admin, 'update_withdrawal', 'withdrawal', p_withdrawal_id::text,
          jsonb_build_object('status', v_new_status, 'tx_hash', v_w.tx_hash));

  return to_jsonb(v_w);
end;
$$;

revoke all on function public.admin_update_withdrawal(uuid, uuid, text, text) from public;
grant execute on function public.admin_update_withdrawal(uuid, uuid, text, text) to service_role;

-- ============================================================================
-- SECTION 10 · apply_referral — settings-driven signup bonus (keeps the Phase 1B
--            referral_count fix: the counter equals actual referral rows)
-- ============================================================================
create or replace function public.apply_referral(p_code text, p_user uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := coalesce(p_user, auth.uid());
  v_base      text;
  v_suffix    text;
  v_sep       integer;
  v_ref       uuid;
  v_prof      public.profiles;
  v_inserted  integer := 0;
  v_reward_c  integer;
  v_reward_u  numeric;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_code is null or length(trim(p_code)) = 0 then return false; end if;

  v_sep    := strpos(p_code, '_');
  v_base   := upper(trim(case when v_sep > 0 then split_part(p_code, '_', 1) else p_code end));
  v_suffix := case
                when v_sep > 0 then nullif(trim(substring(p_code from v_sep + 1)), '')
                else null
              end;
  if length(v_base) = 0 or length(v_base) > 32 then return false; end if;
  if v_suffix is not null and length(v_suffix) > 16 then return false; end if;

  select * into v_prof from public.profiles where id = v_uid for update;
  if not found then return false; end if;

  if v_prof.referred_by is not null then return false; end if;
  if exists (select 1 from public.referrals where referred_id = v_uid) then return false; end if;
  if v_prof.created_at < now() - interval '24 hours' then return false; end if;
  if exists (select 1 from public.user_tasks where user_id = v_uid and status = 'completed') then
    return false;
  end if;
  if exists (select 1 from public.withdrawals where user_id = v_uid) then return false; end if;

  select id into v_ref
    from public.profiles
   where referral_code = v_base
     and id <> v_uid;
  if v_ref is null then return false; end if;

  v_reward_c := public.setting_int('referral_signup_reward_coins', 150);
  v_reward_u := public.setting_numeric('referral_signup_reward_usdt', 0.03);

  update public.profiles
     set referred_by = v_ref
   where id = v_uid and referred_by is null;

  insert into public.referrals (referrer_id, referred_id, reward_coins, reward_usdt, source_tag)
  values (v_ref, v_uid, v_reward_c, v_reward_u, v_suffix)
  on conflict (referred_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    -- referral_count === number of referral rows the referrer actually has.
    update public.profiles
       set referral_count = (select count(*) from public.referrals where referrer_id = v_ref)
     where id = v_ref;
  end if;

  return v_inserted > 0;
end;
$$;

revoke all on function public.apply_referral(text, uuid) from public;
grant execute on function public.apply_referral(text, uuid) to service_role;

-- ============================================================================
-- SECTION 11 · admin_set_setting — admin-only, audited write to platform_settings
-- ----------------------------------------------------------------------------
-- The economics/RateLimit rows above are read server-side at request time, so
-- changing one takes effect without a redeploy. Only an admin may write, and
-- every change is recorded in admin_actions.
-- ============================================================================
create or replace function public.admin_set_setting(
  p_admin uuid,
  p_key   text,
  p_value jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.platform_settings;
begin
  if not public.is_admin_user(p_admin) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_key is null or length(btrim(p_key)) = 0 or length(p_key) > 64 then
    raise exception 'invalid setting key' using errcode = 'P0001';
  end if;
  if p_value is null then
    raise exception 'invalid setting value' using errcode = 'P0001';
  end if;

  insert into public.platform_settings (key, value, updated_at)
  values (btrim(p_key), p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now()
  returning * into v_row;

  insert into public.admin_actions (admin_id, action, target_type, target_id, details)
  values (p_admin, 'set_setting', 'setting', btrim(p_key),
          jsonb_build_object('value', p_value));

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.admin_set_setting(uuid, text, jsonb) from public;
grant execute on function public.admin_set_setting(uuid, text, jsonb) to service_role;

-- ============================================================================
-- record migration
-- ============================================================================
insert into public.schema_migrations (version) values ('0006-money-safety')
on conflict (version) do nothing;
