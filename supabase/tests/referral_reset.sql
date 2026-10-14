-- ============================================================================
-- referral_reset.sql · Questify
-- ----------------------------------------------------------------------------
-- DESTRUCTIVE TEST HELPER. For the Supabase SQL Editor only.
--
-- Purpose: make ONE test account look brand new so the referral flow can be
-- re-tested end to end. It removes every row this account owns, removes the
-- referral link that points at it, deletes the profile, and recomputes the
-- former referrer's referral_count so it always equals the number of referral
-- rows those referrers actually have.
--
-- What it will NOT do (it aborts instead):
--   * run while the telegram_id placeholder is still -1;
--   * touch an account whose profile.is_admin = true;
--   * touch an account that is the referrer of anybody else.
--
-- Everything below runs inside ONE transaction (the DO block). Any RAISE
-- EXCEPTION rolls the whole thing back — nothing is half-deleted.
--
-- This file is derived from the REAL schema: supabase/schema.sql,
-- supabase/migrations/001_fix_apply_referral.sql and
-- supabase/migrations/002_referral_hardening.sql.
-- ============================================================================


-- ============================================================================
-- STEP 1 · SET THE TEST ACCOUNT
-- ----------------------------------------------------------------------------
-- Replace the -1 below with the test account's Telegram id, then run the file.
-- ============================================================================
do $referral_reset$
declare
  -- >>> PLACEHOLDER: replace the -1 with the test account's telegram_id <<<
  v_telegram_id    bigint := 7399866319;

  v_uid            uuid;
  v_is_admin       boolean;
  v_referred_by    uuid;          -- former referrer of the test account
  v_ref_tg         bigint;
  v_ref_new_count  integer;

  c_referrals      bigint := 0;
  c_ledger         bigint := 0;
  c_user_tasks     bigint := 0;
  c_checkins       bigint := 0;
  c_connected      bigint := 0;
  c_withdrawals    bigint := 0;
  c_wallets        bigint := 0;
  c_admin_actions  bigint := 0;
  c_pending        bigint := 0;
  c_events         bigint := 0;
  c_profiles       bigint := 0;
  c_auth_users     bigint := 0;

  v_auth_fk        integer;
begin
  -- --------------------------------------------------------------------------
  -- 1a · placeholder guard
  -- --------------------------------------------------------------------------
  if v_telegram_id is null or v_telegram_id < 0 then
    raise exception
      'referral_reset ABORTED: the telegram_id placeholder (-1) was not replaced at the top of the script.';
  end if;

  -- --------------------------------------------------------------------------
  -- 1b · locate the profile
  -- --------------------------------------------------------------------------
  select id, is_admin, referred_by
    into v_uid, v_is_admin, v_referred_by
    from public.profiles
   where telegram_id = v_telegram_id;

  if v_uid is null then
    raise exception
      'referral_reset ABORTED: no profile found for telegram_id %.', v_telegram_id;
  end if;

  raise notice 'referral_reset: target profile % (telegram_id %).', v_uid, v_telegram_id;

  -- --------------------------------------------------------------------------
  -- 1c · safety guard: never nuke an admin
  -- --------------------------------------------------------------------------
  if v_is_admin then
    raise exception
      'referral_reset ABORTED: telegram_id % is an admin account.', v_telegram_id;
  end if;

  -- --------------------------------------------------------------------------
  -- 1d · safety guard: never nuke an account that others were referred by
  -- --------------------------------------------------------------------------
  if exists (select 1 from public.profiles  where referred_by  = v_uid)
     or exists (select 1 from public.referrals where referrer_id = v_uid) then
    raise exception
      'referral_reset ABORTED: telegram_id % is the referrer of other users; reset their links first.',
      v_telegram_id;
  end if;

  -- ==========================================================================
  -- STEP 2 · DELETE DEPENDENT ROWS (leaf-first, then the profile)
  -- ==========================================================================

  -- referrals: the link that made this account referred. There is no row where
  -- this account is referrer (guarded above), but the OR is kept explicit.
  delete from public.referrals
   where referred_id = v_uid or referrer_id = v_uid;
  get diagnostics c_referrals = row_count;
  raise notice '  referrals         deleted: %', c_referrals;

  -- balance_ledger (the audit ledger / "transactions"). Rows owned by the
  -- account. Rows in OTHER users' ledgers where this account is the actor are
  -- left in place; their actor FK is nulled automatically by ON DELETE SET NULL.
  delete from public.balance_ledger
   where user_id = v_uid;
  get diagnostics c_ledger = row_count;
  raise notice '  balance_ledger    deleted: %', c_ledger;

  -- user_tasks (task claims).
  delete from public.user_tasks
   where user_id = v_uid;
  get diagnostics c_user_tasks = row_count;
  raise notice '  user_tasks        deleted: %', c_user_tasks;

  -- daily_checkins (check-ins).
  delete from public.daily_checkins
   where user_id = v_uid;
  get diagnostics c_checkins = row_count;
  raise notice '  daily_checkins    deleted: %', c_checkins;

  -- connected_accounts (linked accounts).
  delete from public.connected_accounts
   where user_id = v_uid;
  get diagnostics c_connected = row_count;
  raise notice '  connected_accounts deleted: %', c_connected;

  -- withdrawals.
  delete from public.withdrawals
   where user_id = v_uid;
  get diagnostics c_withdrawals = row_count;
  raise notice '  withdrawals       deleted: %', c_withdrawals;

  -- wallets.
  delete from public.wallets
   where user_id = v_uid;
  get diagnostics c_wallets = row_count;
  raise notice '  wallets           deleted: %', c_wallets;

  -- admin_actions that targeted this account (target_id is text). Rows where
  -- this account was the acting admin get admin_id nulled by ON DELETE SET NULL
  -- when the profile is removed below.
  delete from public.admin_actions
   where target_id = v_uid::text;
  get diagnostics c_admin_actions = row_count;
  raise notice '  admin_actions     deleted: %', c_admin_actions;

  -- pending_referrals / referral_events are keyed on telegram_id (not the
  -- profile id). Removed so the account starts genuinely referral-free.
  delete from public.pending_referrals
   where telegram_id = v_telegram_id;
  get diagnostics c_pending = row_count;
  raise notice '  pending_referrals deleted: %', c_pending;

  delete from public.referral_events
   where telegram_id = v_telegram_id;
  get diagnostics c_events = row_count;
  raise notice '  referral_events   deleted: %', c_events;

  -- the profile itself.
  delete from public.profiles
   where id = v_uid;
  get diagnostics c_profiles = row_count;
  raise notice '  profiles          deleted: %', c_profiles;

  -- --------------------------------------------------------------------------
  -- auth user: only if profiles really references auth.users in this database.
  -- In the shipped schema profiles.id is a standalone gen_random_uuid() with no
  -- auth.users FK (the app uses its own signed sessions), so this is normally
  -- skipped. The check is dynamic so the script stays correct either way.
  -- --------------------------------------------------------------------------
  select count(*)
    into v_auth_fk
    from pg_constraint c
    join pg_class     t  on t.oid  = c.conrelid
    join pg_namespace n  on n.oid  = t.relnamespace
    join pg_class     rt on rt.oid = c.confrelid
    join pg_namespace rn on rn.oid = rt.relnamespace
   where c.contype = 'f'
     and n.nspname = 'public' and t.relname = 'profiles'
     and rn.nspname = 'auth'  and rt.relname = 'users';

  if v_auth_fk > 0 then
    delete from auth.users where id = v_uid;
    get diagnostics c_auth_users = row_count;
    raise notice '  auth.users        deleted: %', c_auth_users;
  else
    raise notice '  auth.users        skipped (profiles.id does not reference auth.users)';
  end if;

  -- ==========================================================================
  -- STEP 3 · RECOMPUTE THE FORMER REFERRER'S referral_count
  -- --------------------------------------------------------------------------
  -- Matches migration 001: referral_count === number of referral rows the
  -- referrer actually has.
  -- ==========================================================================
  if v_referred_by is not null then
    update public.profiles
       set referral_count = (select count(*) from public.referrals where referrer_id = v_referred_by)
     where id = v_referred_by;

    select telegram_id, referral_count
      into v_ref_tg, v_ref_new_count
      from public.profiles
     where id = v_referred_by;

    raise notice '  former referrer telegram_id % -> referral_count recomputed to %',
      v_ref_tg, v_ref_new_count;
  else
    raise notice '  former referrer: none (the account was never referred)';
  end if;

  -- --------------------------------------------------------------------------
  -- summary
  -- --------------------------------------------------------------------------
  raise notice 'referral_reset: DONE. rows removed -> referrals=%, ledger=%, user_tasks=%, checkins=%, connected=%, withdrawals=%, wallets=%, admin_actions=%, pending=%, events=%, profiles=%, auth.users=%',
    c_referrals, c_ledger, c_user_tasks, c_checkins, c_connected,
    c_withdrawals, c_wallets, c_admin_actions, c_pending, c_events, c_profiles, c_auth_users;
end
$referral_reset$;


-- ============================================================================
-- STEP 4 · READ-ONLY VERIFICATION (no writes)
-- ----------------------------------------------------------------------------
-- Replace the -1 with YOUR referrer account's telegram_id, then run these two
-- queries separately. The first must show referral_count == the second count.
-- ============================================================================

-- 4a · my referrer's stored count vs. its actual referral rows
select p.telegram_id,
       p.username,
       p.referral_count                                              as stored_referral_count,
       (select count(*) from public.referrals r where r.referrer_id = p.id) as actual_referral_rows
  from public.profiles p
 where p.telegram_id = 7274012010;   -- <<< replace -1 with YOUR referrer's telegram_id

-- 4b · the whole referrals table (the reset account must no longer appear)
select r.id,
       r.referrer_id,
       r.referred_id,
       r.reward_coins,
       r.reward_usdt,
       r.created_at
  from public.referrals r
 order by r.created_at desc;
