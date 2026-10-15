-- ============================================================================
-- 005_dual_wallet_referral.sql · Questify
-- ----------------------------------------------------------------------------
-- Phase 2B: dual (owner + marketing) wallets, tiered referral commission and a
-- real withdrawal-fee deduction.
--
--   1. Two append-only, ledger-backed wallets:
--        owner_wallet_ledger      — the operator's recorded profit.
--        marketing_wallet_ledger  — the referral/marketing reserve.
--      Every row records balance_after, computed inside the same transaction
--      under an advisory lock. Past rows are never updated.
--   2. Each completed task's owner profit margin (tasks.margin_usdt) is split
--      into the two wallets using owner_wallet_split_pct /
--      marketing_wallet_split_pct. The remainder of the split always goes to the
--      owner wallet so the two amounts add up to the margin exactly (no rounding
--      leak).
--   3. Referral payouts (instant bonus, Tier-1 and Tier-2 lifetime commission,
--      milestones) are debited from the MARKETING wallet only. The owner wallet
--      is never touched to cover a referral. If the marketing wallet cannot
--      cover a payout it is skipped and an 'insufficient_marketing_funds' row is
--      written for the operator.
--   4. request_withdrawal actually collects the withdrawal fee: the user is
--      still debited the full requested amount and still sees "you receive X
--      after fee", but the payout recorded is amount - fee and the fee becomes
--      owner_wallet_ledger revenue ('withdrawal_fee_in').
--
-- Idempotent: safe to re-run. Never edits earlier migrations; never drops or
-- rewrites user balances, ledger history or wallets.
-- ============================================================================

-- ============================================================================
-- SECTION 1 · SCHEMA
-- ============================================================================

-- profiles: precompute the referrer-of-the-referrer at apply time so Tier-B
-- lookups never need a recursive query during a commission payout.
alter table public.profiles add column if not exists referred_by_tier2 uuid
  references public.profiles (id) on delete set null;

-- One-time marker: the instant referral bonus may fire at most once per user.
alter table public.profiles add column if not exists referral_bonus_paid_at timestamptz;

create index if not exists idx_profiles_referred_tier2 on public.profiles (referred_by_tier2);

-- tasks: the owner profit margin earned for one completion of this task. It is
-- per-task data (like reward_usdt), editable from the admin panel; default 0
-- means "no margin recorded yet" and therefore no wallet split.
alter table public.tasks add column if not exists margin_usdt numeric(18,6) not null default 0;

-- withdrawals: fee actually collected and the net payout amount. amount_usdt
-- stays the GROSS requested amount so the balance debit and the refund-on-reject
-- path keep working unchanged.
alter table public.withdrawals add column if not exists fee_usdt numeric(18,6) not null default 0;
alter table public.withdrawals add column if not exists net_amount_usdt numeric(18,6);
update public.withdrawals
   set net_amount_usdt = amount_usdt - coalesce(fee_usdt, 0)
 where net_amount_usdt is null;

-- ----------------------------------------------------------------------------
-- owner_wallet_ledger (append-only)
-- ----------------------------------------------------------------------------
create table if not exists public.owner_wallet_ledger (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  type          text not null check (type in
                  ('task_margin_in','withdrawal_fee_in','manual_adjustment')),
  amount_usdt   numeric(18,6) not null,
  task_id       uuid,
  user_id       uuid,
  reference_id  text,
  balance_after numeric(18,6) not null,
  note          text
);

create index if not exists idx_owner_ledger_created on public.owner_wallet_ledger (created_at desc);
-- One ledger row per logical event (split per user+task, fee per withdrawal).
create unique index if not exists uq_owner_ledger_ref
  on public.owner_wallet_ledger (reference_id) where reference_id is not null;

alter table public.owner_wallet_ledger enable row level security;
grant select on public.owner_wallet_ledger to service_role;

-- ----------------------------------------------------------------------------
-- marketing_wallet_ledger (append-only)
-- ----------------------------------------------------------------------------
create table if not exists public.marketing_wallet_ledger (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  type          text not null check (type in
                  ('task_margin_in','referral_payout_out','insufficient_marketing_funds','manual_adjustment')),
  amount_usdt   numeric(18,6) not null,
  task_id       uuid,
  user_id       uuid,
  reference_id  text,
  balance_after numeric(18,6) not null,
  note          text
);

create index if not exists idx_marketing_ledger_created on public.marketing_wallet_ledger (created_at desc);
create unique index if not exists uq_marketing_ledger_ref
  on public.marketing_wallet_ledger (reference_id) where reference_id is not null;

alter table public.marketing_wallet_ledger enable row level security;
grant select on public.marketing_wallet_ledger to service_role;

-- ----------------------------------------------------------------------------
-- referral_milestones_paid — one row per (referrer, threshold) actually paid.
-- ----------------------------------------------------------------------------
create table if not exists public.referral_milestones_paid (
  referrer_id uuid not null references public.profiles (id) on delete cascade,
  threshold   integer not null,
  bonus_usdt  numeric(18,6) not null,
  created_at  timestamptz not null default now(),
  primary key (referrer_id, threshold)
);

alter table public.referral_milestones_paid enable row level security;
grant select on public.referral_milestones_paid to service_role;

-- ============================================================================
-- SECTION 2 · LEDGER PRIMITIVES (SECURITY DEFINER, service_role only)
-- ============================================================================

create or replace function public.owner_wallet_balance()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount_usdt), 0) from public.owner_wallet_ledger;
$$;

create or replace function public.marketing_wallet_balance()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount_usdt), 0) from public.marketing_wallet_ledger;
$$;

-- owner_wallet_append: add a signed amount to the owner wallet. Returns the new
-- balance, or null when p_reference_id already exists (idempotent replay).
create or replace function public.owner_wallet_append(
  p_amount       numeric,
  p_type         text,
  p_task_id      uuid   default null,
  p_user_id      uuid   default null,
  p_reference_id text   default null,
  p_note         text   default null
) returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_bal   numeric;
  v_after numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('ledger:owner', 0));

  if p_reference_id is not null
     and exists (select 1 from public.owner_wallet_ledger where reference_id = p_reference_id) then
    return null;
  end if;

  select coalesce(sum(amount_usdt), 0) into v_bal from public.owner_wallet_ledger;
  v_after := v_bal + coalesce(p_amount, 0);

  insert into public.owner_wallet_ledger
    (type, amount_usdt, task_id, user_id, reference_id, balance_after, note)
  values
    (p_type, coalesce(p_amount, 0), p_task_id, p_user_id, p_reference_id, v_after, p_note);

  return v_after;
end;
$$;

-- marketing_wallet_append: add a signed amount to the marketing wallet (credits
-- and manual adjustments). Same idempotency contract as the owner wallet.
create or replace function public.marketing_wallet_append(
  p_amount       numeric,
  p_type         text,
  p_task_id      uuid   default null,
  p_user_id      uuid   default null,
  p_reference_id text   default null,
  p_note         text   default null
) returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_bal   numeric;
  v_after numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('ledger:marketing', 0));

  if p_reference_id is not null
     and exists (select 1 from public.marketing_wallet_ledger where reference_id = p_reference_id) then
    return null;
  end if;

  select coalesce(sum(amount_usdt), 0) into v_bal from public.marketing_wallet_ledger;
  v_after := v_bal + coalesce(p_amount, 0);

  insert into public.marketing_wallet_ledger
    (type, amount_usdt, task_id, user_id, reference_id, balance_after, note)
  values
    (p_type, coalesce(p_amount, 0), p_task_id, p_user_id, p_reference_id, v_after, p_note);

  return v_after;
end;
$$;

-- marketing_wallet_payout: debit the marketing wallet, but never below zero.
-- Returns:
--   'paid'         — debited; caller may credit the user.
--   'insufficient' — skipped; an 'insufficient_marketing_funds' row was written
--                    (with p_reference_id when provided) for the operator.
--   'duplicate'    — this reference was already processed, do not pay again.
--   'noop'         — nothing to do (non-positive amount).
-- The owner wallet is never touched here.
create or replace function public.marketing_wallet_payout(
  p_amount       numeric,
  p_task_id      uuid   default null,
  p_user_id      uuid   default null,
  p_reference_id text   default null,
  p_note         text   default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_bal numeric;
begin
  if p_amount is null or p_amount <= 0 then return 'noop'; end if;

  perform pg_advisory_xact_lock(hashtextextended('ledger:marketing', 0));

  if p_reference_id is not null and exists (
       select 1 from public.marketing_wallet_ledger
        where reference_id = p_reference_id
          and type in ('referral_payout_out','insufficient_marketing_funds')) then
    return 'duplicate';
  end if;

  select coalesce(sum(amount_usdt), 0) into v_bal from public.marketing_wallet_ledger;

  if v_bal >= p_amount then
    insert into public.marketing_wallet_ledger
      (type, amount_usdt, task_id, user_id, reference_id, balance_after, note)
    values
      ('referral_payout_out', -p_amount, p_task_id, p_user_id, p_reference_id, v_bal - p_amount, p_note);
    return 'paid';
  end if;

  insert into public.marketing_wallet_ledger
    (type, amount_usdt, task_id, user_id, reference_id, balance_after, note)
  values
    ('insufficient_marketing_funds', 0, p_task_id, p_user_id, p_reference_id, v_bal,
     coalesce(p_note, '') || ' | needed ' || p_amount || ', available ' || v_bal);
  return 'insufficient';
end;
$$;

-- pay_referral_milestones: pay any configured milestone at or below the
-- referrer's current referral_count that has not been paid yet. Idempotent via
-- referral_milestones_paid. Returns how many milestones were paid this call.
create or replace function public.pay_referral_milestones(
  p_referrer uuid,
  p_task_id  uuid default null
) returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count    integer;
  v_rules    jsonb;
  v_rule     jsonb;
  v_thresh   integer;
  v_bonus    numeric;
  v_res      text;
  v_paid     integer := 0;
begin
  if p_referrer is null then return 0; end if;

  select referral_count into v_count from public.profiles where id = p_referrer;
  if v_count is null then return 0; end if;

  v_rules := public.setting_jsonb('referral_milestone_rules');
  if v_rules is null or jsonb_typeof(v_rules) <> 'array' then return 0; end if;

  for v_rule in select value from jsonb_array_elements(v_rules) loop
    begin
      v_thresh := (v_rule ->> 'referral_count')::integer;
      v_bonus  := (v_rule ->> 'bonus_usdt')::numeric;
    exception when others then
      v_thresh := null;
      v_bonus  := null;
    end;

    if v_thresh is null or v_bonus is null or v_bonus <= 0 then continue; end if;
    if v_count < v_thresh then continue; end if;
    if exists (select 1 from public.referral_milestones_paid
                where referrer_id = p_referrer and threshold = v_thresh) then
      continue;
    end if;

    v_res := public.marketing_wallet_payout(v_bonus, p_task_id, p_referrer, null,
              'milestone ' || v_thresh || ' referrals');

    if v_res = 'paid' then
      update public.profiles
         set usdt_balance = usdt_balance + v_bonus
       where id = p_referrer;
      insert into public.referral_milestones_paid (referrer_id, threshold, bonus_usdt)
      values (p_referrer, v_thresh, v_bonus)
      on conflict (referrer_id, threshold) do nothing;
      v_paid := v_paid + 1;
    end if;
  end loop;

  return v_paid;
end;
$$;

revoke all on function public.owner_wallet_balance() from public;
revoke all on function public.marketing_wallet_balance() from public;
revoke all on function public.owner_wallet_append(numeric, text, uuid, uuid, text, text) from public;
revoke all on function public.marketing_wallet_append(numeric, text, uuid, uuid, text, text) from public;
revoke all on function public.marketing_wallet_payout(numeric, uuid, uuid, text, text) from public;
revoke all on function public.pay_referral_milestones(uuid, uuid) from public;

grant execute on function public.owner_wallet_balance() to service_role;
grant execute on function public.marketing_wallet_balance() to service_role;
grant execute on function public.owner_wallet_append(numeric, text, uuid, uuid, text, text) to service_role;
grant execute on function public.marketing_wallet_append(numeric, text, uuid, uuid, text, text) to service_role;
grant execute on function public.marketing_wallet_payout(numeric, uuid, uuid, text, text) to service_role;
grant execute on function public.pay_referral_milestones(uuid, uuid) to service_role;

-- ============================================================================
-- SECTION 3 · SEED DUAL-WALLET / TIERED-REFERRAL SETTINGS (idempotent)
-- ============================================================================
insert into public.platform_settings (key, value, is_public, description) values
  ('owner_wallet_split_pct',        '0.95'::jsonb, false, 'Owner share of each task margin (must sum to 1 with marketing_wallet_split_pct)'),
  ('marketing_wallet_split_pct',    '0.05'::jsonb, false, 'Marketing/referral reserve share of each task margin'),
  ('referral_tier1_commission_pct', '0.03'::jsonb, false, 'Tier-1 (direct referrer) commission as a fraction of task margin (keep tier1+tier2 <= marketing_wallet_split_pct so the reserve stays solvent)'),
  ('referral_tier2_commission_pct', '0.02'::jsonb, false, 'Tier-2 (referrer of the referrer) commission as a fraction of task margin'),
  ('referral_instant_bonus_coins',  '150'::jsonb,  false, 'Coins granted to the referrer when the referred user crosses referral_bonus_min_tasks'),
  ('referral_instant_bonus_usdt',   '0.03'::jsonb, false, 'USDT granted to the referrer when the referred user crosses referral_bonus_min_tasks'),
  ('referral_bonus_min_tasks',      '3'::jsonb,    false, 'Completed tasks the referred user must reach before the instant bonus fires'),
  ('referral_milestone_rules',      '[{"referral_count":5,"bonus_usdt":1},{"referral_count":25,"bonus_usdt":5}]'::jsonb, false, 'Milestone bonuses: array of {referral_count, bonus_usdt}')
on conflict (key) do nothing;

-- ============================================================================
-- SECTION 4 · apply_referral — store Tier-2 referrer + pay milestones
-- ----------------------------------------------------------------------------
-- Keeps the Phase 1B eligibility gate and the Phase 2 settings-driven metadata;
-- adds referred_by_tier2 (the referrer's own referrer) and milestone payouts.
-- ============================================================================
create or replace function public.apply_referral(p_code text, p_user uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := coalesce(p_user, auth.uid());
  v_base      text;
  v_suffix    text;
  v_sep       integer;
  v_ref       uuid;
  v_ref2      uuid;
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

  -- Precompute the referrer-of-the-referrer so Tier-B never needs recursion.
  select referred_by into v_ref2 from public.profiles where id = v_ref;

  v_reward_c := public.setting_int('referral_signup_reward_coins', 150);
  v_reward_u := public.setting_numeric('referral_signup_reward_usdt', 0.03);

  update public.profiles
     set referred_by = v_ref,
         referred_by_tier2 = v_ref2
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

    -- Pay any newly-crossed milestone from the marketing wallet (idempotent).
    perform public.pay_referral_milestones(v_ref, null);
  end if;

  return v_inserted > 0;
end;
$$;

revoke all on function public.apply_referral(text, uuid) from public;
grant execute on function public.apply_referral(text, uuid) to service_role;

-- ============================================================================
-- SECTION 5 · claim_task — margin split + tiered referral payouts from marketing
-- ----------------------------------------------------------------------------
-- Keeps every Phase 2 guarantee (advisory lock, max_completions, duration gate,
-- idempotent replay). Replaces the old flat 10% single-wallet commission.
-- ============================================================================
drop function if exists public.claim_task(uuid, uuid);
drop function if exists public.claim_task(uuid, uuid, text);

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

  -- --------------------------------------------------------------------------
  -- Margin split: owner_wallet_split_pct / marketing_wallet_split_pct.
  -- Rounding rule: marketing is rounded to 6dp and the owner takes the exact
  -- remainder, so owner + marketing == margin with no leak.
  -- --------------------------------------------------------------------------
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

  -- --------------------------------------------------------------------------
  -- Tier-1 (direct referrer) and Tier-2 (referrer's referrer) lifetime
  -- commission, paid ONLY from the marketing wallet.
  -- --------------------------------------------------------------------------
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

  -- --------------------------------------------------------------------------
  -- Instant referral bonus: fires once, when the referred user reaches
  -- referral_bonus_min_tasks completed tasks (not on signup). Paid from the
  -- marketing wallet; skipped (and left unpaid for a later retry) if it cannot
  -- cover the USDT component.
  -- --------------------------------------------------------------------------
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

-- ============================================================================
-- SECTION 6 · request_withdrawal — collect the fee into the owner wallet
-- ----------------------------------------------------------------------------
-- The user is still debited the FULL requested amount and the user-facing
-- "you receive X after fee" is unchanged; the payout recorded is the net amount
-- and the fee becomes owner-wallet revenue.
-- ============================================================================
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
  v_fee        numeric;
  v_net        numeric;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  -- Serialise every withdrawal for a user so a double-submit cannot queue twice.
  perform pg_advisory_xact_lock(hashtextextended('withdrawal:' || v_uid::text, 0));

  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  if v_key is not null then
    select * into v_row from public.withdrawals
     where user_id = v_uid and idempotency_key = v_key;
    if found then
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

  v_fee := greatest(0, case
    when p_network = 'BEP20' then public.setting_numeric('withdrawal_fee_bep20', 1)
    else public.setting_numeric('withdrawal_fee_ton', 0.5)
  end);
  v_net := p_amount - v_fee;
  if v_net <= 0 then
    raise exception 'amount does not cover the withdrawal fee' using errcode = 'P0001';
  end if;

  -- Debit the FULL requested amount (unchanged behaviour).
  update public.profiles set usdt_balance = usdt_balance - p_amount where id = v_uid;

  insert into public.withdrawals
    (user_id, amount_usdt, network, address, status, idempotency_key, fee_usdt, net_amount_usdt)
  values
    (v_uid, p_amount, p_network, trim(p_address), 'pending', v_key, v_fee, v_net)
  returning * into v_row;

  -- Collect the fee as owner-wallet revenue (idempotent per withdrawal).
  if v_fee > 0 then
    perform public.owner_wallet_append(
      v_fee, 'withdrawal_fee_in', null, v_uid, 'fee:' || v_row.id::text, 'withdrawal fee');
  end if;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.request_withdrawal(numeric, text, text, uuid, text) from public;
grant execute on function public.request_withdrawal(numeric, text, text, uuid, text) to service_role;

-- ============================================================================
-- SECTION 7 · admin_upsert_task — accept the per-task owner margin
-- ----------------------------------------------------------------------------
-- Signature changes (new p_margin_usdt), so drop the old 16-arg function to
-- avoid an ambiguous overload.
-- ============================================================================
drop function if exists public.admin_upsert_task(uuid,uuid,text,text,text,text,text,integer,numeric,text,integer,boolean,text,text,jsonb,integer);

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
  p_max_completions integer default null,
  p_margin_usdt numeric(18,6) default null
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
      verification_type, verification_target, verification_rules, max_completions, margin_usdt
    ) values (
      p_title, p_description, p_platform, p_action_label, p_action_url,
      p_reward_coins, p_reward_usdt, p_difficulty, p_duration_seconds,
      coalesce(p_is_active, true),
      p_verification_type, p_verification_target, coalesce(p_verification_rules, '{}'::jsonb),
      p_max_completions, coalesce(p_margin_usdt, 0)
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
      margin_usdt = coalesce(p_margin_usdt, margin_usdt),
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

revoke all on function public.admin_upsert_task(uuid,uuid,text,text,text,text,text,integer,numeric,text,integer,boolean,text,text,jsonb,integer,numeric) from public;
grant execute on function public.admin_upsert_task(uuid,uuid,text,text,text,text,text,integer,numeric,text,integer,boolean,text,text,jsonb,integer,numeric) to service_role;

-- ============================================================================
-- SECTION 8 · admin_set_setting — enforce that wallet splits sum to 1
-- ----------------------------------------------------------------------------
-- Every other key is written unchanged. Editing either split validates both.
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
  v_row       public.platform_settings;
  v_key       text;
  v_val       numeric;
  v_other_key text;
  v_other     numeric;
begin
  if not public.is_admin_user(p_admin) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_key := btrim(coalesce(p_key, ''));
  if v_key = '' or length(v_key) > 64 then
    raise exception 'invalid setting key' using errcode = 'P0001';
  end if;
  if p_value is null then
    raise exception 'invalid setting value' using errcode = 'P0001';
  end if;

  if v_key in ('owner_wallet_split_pct', 'marketing_wallet_split_pct') then
    begin
      v_val := (p_value #>> '{}')::numeric;
    exception when others then
      raise exception 'wallet split must be a number' using errcode = 'P0001';
    end;
    if v_val < 0 or v_val > 1 then
      raise exception 'wallet split must be between 0 and 1' using errcode = 'P0001';
    end if;

    v_other_key := case when v_key = 'owner_wallet_split_pct'
                        then 'marketing_wallet_split_pct'
                        else 'owner_wallet_split_pct' end;
    begin
      v_other := (public.setting_jsonb(v_other_key) #>> '{}')::numeric;
    exception when others then
      v_other := null;
    end;

    -- When the counterpart exists, the two must sum to 1 (within fp tolerance).
    if v_other is not null and abs((v_val + v_other) - 1) > 0.000001 then
      raise exception 'owner_wallet_split_pct and marketing_wallet_split_pct must sum to 1'
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.platform_settings (key, value, updated_at)
  values (v_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now()
  returning * into v_row;

  insert into public.admin_actions (admin_id, action, target_type, target_id, details)
  values (p_admin, 'set_setting', 'setting', v_key,
          jsonb_build_object('value', p_value));

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.admin_set_setting(uuid, text, jsonb) from public;
grant execute on function public.admin_set_setting(uuid, text, jsonb) to service_role;

-- ============================================================================
-- record migration
-- ============================================================================
insert into public.schema_migrations (version) values ('0007-dual-wallet-referral')
on conflict (version) do nothing;
