-- ----------------------------------------------------------------------------
-- 001_fix_apply_referral.sql
--
-- Fix: `referral_count` must increment ONLY when a referral row is actually
-- inserted, and must equal the number of users who joined with this code.
-- The previous version incremented the counter unconditionally, so a duplicate
-- `ON CONFLICT DO NOTHING` could still inflate the count.
--
-- Commission logic (the 10% payout inside claim_task) is intentionally
-- unchanged. This file is idempotent and safe to re-run.
-- ----------------------------------------------------------------------------

create or replace function public.apply_referral(p_code text, p_user uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := coalesce(p_user, auth.uid());
  v_ref uuid;
  v_inserted integer := 0;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  -- Match the referrer case-insensitively; never allow self-referral.
  select id into v_ref
    from public.profiles
   where referral_code = upper(trim(p_code))
     and id <> v_uid;
  if v_ref is null then return false; end if;

  -- A user can only be referred once.
  if exists (select 1 from public.referrals where referred_id = v_uid) then return false; end if;

  update public.profiles
     set referred_by = v_ref
   where id = v_uid and referred_by is null;

  insert into public.referrals (referrer_id, referred_id, reward_coins, reward_usdt)
  values (v_ref, v_uid, 150, 0.03)
  on conflict (referred_id) do nothing;

  -- row_count is 0 when ON CONFLICT skipped the insert.
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    -- referral_count === number of users who joined with this code.
    update public.profiles
       set referral_count = (select count(*) from public.referrals where referrer_id = v_ref)
     where id = v_ref;
  end if;

  return v_inserted > 0;
end;
$$;

-- The RPC trusts `p_user`, so it stays service_role-only (matches schema.sql).
revoke all on function public.apply_referral(text, uuid) from public;
grant execute on function public.apply_referral(text, uuid) to service_role;
