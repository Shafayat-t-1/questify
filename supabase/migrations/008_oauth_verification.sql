-- ----------------------------------------------------------------------------
-- 008_oauth_verification.sql
--
-- Phase 4A: real OAuth account linking + honest task verification.
--
--     File numbering: 001, 002, 004, 005, 006, 007 exist (003 is a historical
--     gap) -> this file is 008.
--     schema_migrations already holds 0009 (= file 007) -> the next recorded
--     version is 0010.
--
-- What this migration does:
--   1. oauth_states: server-side CSRF/PKCE records for the OAuth
--      authorization-code flow. Stores ONLY the SHA-256 hash of the state
--      value, the owning user, the provider, the PKCE code_verifier and a
--      10-minute expiry. NEVER stores provider access/refresh tokens.
--   2. A partial UNIQUE index on connected_accounts (provider,
--      provider_user_id) so one external identity (e.g. a GitHub account) can
--      be linked to at most ONE Questify user — two accounts cannot claim the
--      same GitHub/Google/Discord identity.
--   3. A rate-limit window for the OAuth start/callback routes, merged into
--      the existing rate_limits platform_settings row (operator-tunable).
--
-- Idempotent: safe to re-run. Never edits earlier migrations.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- oauth_states
-- ----------------------------------------------------------------------------
create table if not exists public.oauth_states (
  state_hash    text primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  provider      text not null check (provider in ('google','github','discord')),
  code_verifier text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  consumed_at   timestamptz
);

create index if not exists idx_oauth_states_expires_at
  on public.oauth_states (expires_at);

-- service_role only: RLS on, no policies (service_role bypasses RLS), same
-- posture as mcc_magic_tokens. The callback route runs with the service key;
-- no anon/authenticated read path exists.
alter table public.oauth_states enable row level security;
grant select, insert, update, delete on public.oauth_states to service_role;

-- ----------------------------------------------------------------------------
-- connected_accounts: one external identity per provider across all users.
-- (unique (user_id, provider) already exists from schema.sql; this adds the
--  cross-user identity guard.)
-- ----------------------------------------------------------------------------
create unique index if not exists connected_accounts_provider_identity
  on public.connected_accounts (provider, provider_user_id)
  where provider_user_id is not null;

-- ----------------------------------------------------------------------------
-- Rate-limit window for the OAuth start/callback routes, merged into the
-- existing rate_limits row so the operator can tune it from the admin panel.
-- `on conflict` guard: only adds the key when missing, never overwrites an
-- operator-tuned value.
-- ----------------------------------------------------------------------------
update public.platform_settings
   set value = value || '{"oauth":{"max":10,"window_seconds":60}}'::jsonb,
       updated_at = now()
 where key = 'rate_limits'
   and not (value ? 'oauth');

-- ----------------------------------------------------------------------------
-- Record the migration version.
-- ----------------------------------------------------------------------------
insert into public.schema_migrations (version) values ('0010-oauth-verification')
on conflict (version) do nothing;
