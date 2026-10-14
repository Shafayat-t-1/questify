-- ----------------------------------------------------------------------------
-- 002_referral_hardening.sql
--
-- Permanent fix for referrals going missing. Adds:
--   * pending_referrals  — a `/start CODE` seen by the bot, consumed once by
--                          telegram-auth when the Mini App opens without a
--                          start_param (inline web_app buttons never send one).
--   * referral_events    — an audit row for every new-profile login and every
--                          referral attempt (never stores tokens/initData).
--   * source_tag column  — records the untrusted "CODE_suffix" provenance tag.
--   * apply_referral     — eligibility-gated and idempotent, replacing the old
--                          "profile was just created" condition.
--   * claim_pending_referral + v_referral_debug.
--
-- Idempotent: safe to re-run. Never edits earlier migrations.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- pending_referrals
-- ----------------------------------------------------------------------------
create table if not exists public.pending_referrals (
  telegram_id bigint primary key,
  code        text not null,
  created_at  timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists idx_pending_referrals_created
  on public.pending_referrals (created_at desc);

-- service_role only: RLS on, no policies (service_role bypasses RLS).
alter table public.pending_referrals enable row level security;
grant select, insert, update, delete on public.pending_referrals to service_role;

-- ----------------------------------------------------------------------------
-- referral_events (permanent evidence)
-- ----------------------------------------------------------------------------
create table if not exists public.referral_events (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  telegram_id bigint,
  source      text not null check (source in ('init_data','client_param','pending','none')),
  code_raw    text,
  outcome     text not null check (outcome in ('applied','skipped','error')),
  reason      text
);

create index if not exists idx_referral_events_created
  on public.referral_events (created_at desc);
create index if not exists idx_referral_events_tg
  on public.referral_events (telegram_id, created_at desc);

alter table public.referral_events enable row level security;
grant select, insert, update, delete on public.referral_events to service_role;

-- ----------------------------------------------------------------------------
-- referrals.source_tag — the untrusted "CODE_suffix" provenance tag.
-- ----------------------------------------------------------------------------
alter table public.referrals add column if not exists source_tag text;

-- ----------------------------------------------------------------------------
-- claim_pending_referral — atomically consume a pending code (once, within 7d).
-- ----------------------------------------------------------------------------
create or replace function public.claim_pending_referral(p_telegram_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  update public.pending_referrals
     set consumed_at = now()
   where telegram_id = p_telegram_id
     and consumed_at is null
     and created_at > now() - interval '7 days'
  returning code into v_code;
  return v_code;
end;
$$;

revoke all on function public.claim_pending_referral(bigint) from public;
grant execute on function public.claim_pending_referral(bigint) to service_role;

-- ----------------------------------------------------------------------------
-- apply_referral — eligibility-gated, idempotent, suffix-aware.
--
-- Eligibility (replaces "profile was just created"):
--   referred_by is null AND no referral already consumed AND account < 24h old
--   AND zero completed tasks AND zero withdrawals.
-- The `CODE_suffix` form is accepted; the suffix is stored in source_tag and is
-- never used to resolve a referrer.
-- ----------------------------------------------------------------------------
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
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_code is null or length(trim(p_code)) = 0 then return false; end if;

  -- Split "CODE_suffix" on the first underscore. Generated codes are hex and
  -- never contain '_', so this cannot truncate a real code.
  v_sep    := strpos(p_code, '_');
  v_base   := upper(trim(case when v_sep > 0 then split_part(p_code, '_', 1) else p_code end));
  v_suffix := case
                when v_sep > 0 then nullif(trim(substring(p_code from v_sep + 1)), '')
                else null
              end;
  if length(v_base) = 0 or length(v_base) > 32 then return false; end if;
  if v_suffix is not null and length(v_suffix) > 16 then return false; end if;

  -- Lock the target row so two concurrent logins cannot both apply.
  select * into v_prof from public.profiles where id = v_uid for update;
  if not found then return false; end if;

  -- Eligibility gate.
  if v_prof.referred_by is not null then return false; end if;
  if exists (select 1 from public.referrals where referred_id = v_uid) then return false; end if;
  if v_prof.created_at < now() - interval '24 hours' then return false; end if;
  if exists (select 1 from public.user_tasks where user_id = v_uid and status = 'completed') then
    return false;
  end if;
  if exists (select 1 from public.withdrawals where user_id = v_uid) then return false; end if;

  -- Resolve the referrer by base code; never allow self-referral.
  select id into v_ref
    from public.profiles
   where referral_code = v_base
     and id <> v_uid;
  if v_ref is null then return false; end if;

  update public.profiles
     set referred_by = v_ref
   where id = v_uid and referred_by is null;

  insert into public.referrals (referrer_id, referred_id, reward_coins, reward_usdt, source_tag)
  values (v_ref, v_uid, 150, 0.03, v_suffix)
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

-- ----------------------------------------------------------------------------
-- v_referral_debug — the last 50 events, joined to usernames.
-- ----------------------------------------------------------------------------
create or replace view public.v_referral_debug as
  select e.id,
         e.created_at,
         e.telegram_id,
         p.username,
         p.referral_code,
         p.referred_by,
         p.referral_count,
         e.source,
         e.code_raw,
         e.outcome,
         e.reason
    from public.referral_events e
    left join public.profiles p on p.telegram_id = e.telegram_id
   order by e.created_at desc
   limit 50;

revoke all on public.v_referral_debug from public;
grant select on public.v_referral_debug to service_role;

-- ----------------------------------------------------------------------------
-- record migration
-- ----------------------------------------------------------------------------
insert into public.schema_migrations (version) values ('0005-referral-hardening')
on conflict (version) do nothing;
