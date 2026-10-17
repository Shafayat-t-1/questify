-- ----------------------------------------------------------------------------
-- 007_mcc_magic_tokens.sql
--
-- Phase 3A-FIX: bot-initiated magic-link login for /mcc (primary path).
-- The bot's `/login` command replies with a single-use link
-- (`/mcc/magic?token=...`) whose raw token is a short-lived signed JWT
-- (purpose 'mcc_magic', 5 minutes, see lib/mcc-magic.ts). Only the SHA-256
-- HASH of that raw token is stored here, so a database read alone can never
-- mint a session — the JWT signature must also verify against
-- QUESTIFY_JWT_SECRET.
--
--     File numbering: 001, 002, 004, 005, 006 exist (003 is a historical
--     gap) -> this file is 007.
--     schema_migrations already holds 0008 (= file 006) -> the next recorded
--     version is 0009.
--
-- Idempotent: safe to re-run. Never edits earlier migrations.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- mcc_magic_tokens
-- ----------------------------------------------------------------------------
create table if not exists public.mcc_magic_tokens (
  token_hash text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

create index if not exists idx_mcc_magic_tokens_expires_at
  on public.mcc_magic_tokens (expires_at);

-- service_role only: RLS on, no policies (service_role bypasses RLS), same
-- posture as pending_referrals. No anon/authenticated read path exists.
alter table public.mcc_magic_tokens enable row level security;
grant select, insert, update, delete on public.mcc_magic_tokens to service_role;

-- ----------------------------------------------------------------------------
-- Record the migration version.
-- ----------------------------------------------------------------------------
insert into public.schema_migrations (version) values ('0009-mcc-magic-tokens')
on conflict (version) do nothing;
